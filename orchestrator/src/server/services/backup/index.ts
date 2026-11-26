/**
 * Database Backup Service
 *
 * Manages automatic and manual database backups as portable gzipped JSON snapshots
 * stored in the configured BlobStore (`backups/` prefix: Cloudflare R2 in Worker/DO
 * deployments, or local filesystem directory on self-hosted installs).
 */

import { type BlobStore, getBlobStore, LocalBlobStore, R2BlobStore } from "@infra/blob-store";
import { logger } from "@infra/logger";
import { getTenantId } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { db, schema } from "@server/db/index";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import { calculateNextTime, createScheduler } from "@server/utils/scheduler";
import type { BackupInfo, BackupStorageInfo } from "@shared/types";
import { eq, inArray } from "drizzle-orm";
import { exportDatabaseSnapshot, serializeBackupSnapshot } from "./snapshot";

const BACKUP_KEY_PREFIX = "backups/";
const BACKUP_EXTENSION = ".json.gz";
const AUTO_BACKUP_PREFIX = "jobs_";
const MANUAL_BACKUP_PREFIX = "jobs_manual_";
const AUTO_BACKUP_PATTERN = /^jobs_\d{4}_\d{2}_\d{2}\.(json\.gz|db)$/;
const MANUAL_BACKUP_PATTERN =
  /^jobs_manual_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}(?:_\d+)?\.(json\.gz|db)$/;

const AUTO_BACKUP_REGEX = /^jobs_(\d{4})_(\d{2})_(\d{2})\.(json\.gz|db)$/;
const MANUAL_BACKUP_REGEX =
  /^jobs_manual_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})(?:_\d+)?\.(json\.gz|db)$/;

const BACKUP_SETTING_KEYS = ["backupEnabled", "backupHour", "backupMaxCount"] as const;

export interface BackupSettings {
  enabled: boolean;
  hour: number;
  maxCount: number;
}

export interface BackupDownloadPayload {
  filename: string;
  body: Uint8Array;
  size: number;
  contentType: string;
}

let currentSettings: BackupSettings = {
  enabled: false,
  hour: 2,
  maxCount: 5,
};

let customBackupBlobStore: BlobStore | null = null;
let customBackupStorageInfo: BackupStorageInfo | null = null;
const reservedBackupKeys = new Set<string>();

const scheduler = createScheduler("backup", async () => {
  await createBackup("auto");
  await cleanupOldBackups();
});

/**
 * Overrides the BlobStore used for database backups (for example a dedicated R2 bucket
 * or test store). Pass null to restore default `BACKUP_DIR` / `getBlobStore()` routing.
 */
export function setBackupBlobStore(store: BlobStore | null, info?: BackupStorageInfo | null): void {
  customBackupBlobStore = store;
  customBackupStorageInfo = store ? (info ?? null) : null;
}

function getBackupBlobStore(): BlobStore {
  if (customBackupBlobStore) {
    return customBackupBlobStore;
  }
  const backupDir = process.env.BACKUP_DIR?.trim();
  if (backupDir) {
    return new LocalBlobStore(backupDir);
  }
  return getBlobStore();
}

export function getBackupStorageInfo(): BackupStorageInfo {
  if (customBackupStorageInfo) {
    return customBackupStorageInfo;
  }
  if (customBackupBlobStore instanceof R2BlobStore) {
    return { kind: "r2", label: "Cloudflare R2 (backups/)" };
  }
  if (customBackupBlobStore) {
    return { kind: "local", label: "Custom backup storage (backups/)" };
  }
  if (process.env.BACKUP_DIR?.trim()) {
    return { kind: "local", label: "Custom backup directory (backups/)" };
  }
  if (getBlobStore() instanceof R2BlobStore) {
    return { kind: "r2", label: "Cloudflare R2 (backups/)" };
  }
  return { kind: "local", label: "Local data storage (backups/)" };
}

export function isValidBackupFilename(filename: string): boolean {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return false;
  }
  return AUTO_BACKUP_PATTERN.test(filename) || MANUAL_BACKUP_PATTERN.test(filename);
}

function toBackupKey(filename: string): string {
  return `${BACKUP_KEY_PREFIX}${filename}`;
}

function generateBackupFilename(type: "auto" | "manual", now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  if (type === "auto") {
    return `${AUTO_BACKUP_PREFIX}${year}_${month}_${day}${BACKUP_EXTENSION}`;
  }

  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  return `${MANUAL_BACKUP_PREFIX}${year}_${month}_${day}_${hours}_${minutes}_${seconds}${BACKUP_EXTENSION}`;
}

function parseBackupDate(filename: string): Date | null {
  const autoMatch = filename.match(AUTO_BACKUP_REGEX);
  if (autoMatch) {
    const [, year, month, day] = autoMatch;
    return buildUtcDate(year, month, day, "0", "0", "0");
  }

  const manualMatch = filename.match(MANUAL_BACKUP_REGEX);
  if (manualMatch) {
    const [, year, month, day, hours, minutes, seconds] = manualMatch;
    return buildUtcDate(year, month, day, hours, minutes, seconds);
  }

  return null;
}

function buildUtcDate(
  yearRaw: string,
  monthRaw: string,
  dayRaw: string,
  hourRaw: string,
  minuteRaw: string,
  secondRaw: string,
): Date | null {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date;
}

function getBackupType(filename: string): "auto" | "manual" | null {
  if (AUTO_BACKUP_PATTERN.test(filename)) return "auto";
  if (MANUAL_BACKUP_PATTERN.test(filename)) return "manual";
  return null;
}

export async function createBackup(type: "auto" | "manual"): Promise<string> {
  const snapshot = exportDatabaseSnapshot(type);
  const payload = serializeBackupSnapshot(snapshot);
  const store = getBackupBlobStore();
  const baseFilename = generateBackupFilename(type, new Date(snapshot.createdAt));

  let filename = baseFilename;
  let reservedKey = "";

  if (type === "auto") {
    const candidateKey = toBackupKey(baseFilename);
    if (reservedBackupKeys.has(candidateKey) || (await store.exists(candidateKey))) {
      logger.info("Automatic backup already exists for current day", {
        filename: baseFilename,
        type,
      });
      return baseFilename;
    }
    reservedBackupKeys.add(candidateKey);
    reservedKey = candidateKey;
  } else {
    const baseName = baseFilename.slice(0, -BACKUP_EXTENSION.length);
    for (let sequence = 0; sequence <= 100; sequence += 1) {
      const candidate =
        sequence === 0 ? baseFilename : `${baseName}_${sequence}${BACKUP_EXTENSION}`;
      const candidateKey = toBackupKey(candidate);
      if (!reservedBackupKeys.has(candidateKey) && !(await store.exists(candidateKey))) {
        reservedBackupKeys.add(candidateKey);
        filename = candidate;
        reservedKey = candidateKey;
        break;
      }
    }

    if (!reservedKey) {
      throw new Error("Failed to create unique manual backup filename");
    }
  }

  try {
    const putResult = await store.put(reservedKey, payload, {
      contentType: "application/gzip",
    });

    logger.info("Created database backup", {
      filename,
      type,
      size: putResult.size,
      storageKind: getBackupStorageInfo().kind,
      tableCount: Object.keys(snapshot.tables).length,
    });

    return filename;
  } finally {
    reservedBackupKeys.delete(reservedKey);
  }
}

export async function listBackups(): Promise<BackupInfo[]> {
  const entries = await getBackupBlobStore().list({ prefix: BACKUP_KEY_PREFIX });
  const backups: BackupInfo[] = [];

  for (const entry of entries) {
    if (!entry.key.startsWith(BACKUP_KEY_PREFIX)) continue;
    const filename = entry.key.slice(BACKUP_KEY_PREFIX.length);
    if (!filename || filename.includes("/")) continue;

    const type = getBackupType(filename);
    const createdAt = parseBackupDate(filename);
    if (type && createdAt) {
      backups.push({
        filename,
        type,
        size: entry.size,
        createdAt: createdAt.toISOString(),
      });
    }
  }

  backups.sort((a, b) => {
    const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return diff !== 0 ? diff : b.filename.localeCompare(a.filename);
  });

  return backups;
}

export async function readBackup(filename: string): Promise<BackupDownloadPayload | null> {
  if (!isValidBackupFilename(filename)) {
    throw new Error("Invalid backup filename");
  }

  const blob = await getBackupBlobStore().get(toBackupKey(filename));
  if (!blob) {
    return null;
  }

  return {
    filename,
    body: blob.body,
    size: blob.size,
    contentType:
      blob.contentType ??
      (filename.endsWith(BACKUP_EXTENSION) ? "application/gzip" : "application/octet-stream"),
  };
}

export async function deleteBackup(filename: string): Promise<void> {
  if (!isValidBackupFilename(filename)) {
    throw new Error("Invalid backup filename");
  }

  const store = getBackupBlobStore();
  const key = toBackupKey(filename);

  if (!(await store.exists(key))) {
    throw new Error(`Backup not found: ${filename}`);
  }

  await store.delete(key);
  logger.info("Deleted database backup", {
    filename,
    storageKind: getBackupStorageInfo().kind,
  });
}

export async function cleanupOldBackups(): Promise<void> {
  const backups = await listBackups();
  const autoBackups = backups.filter((b) => b.type === "auto");

  autoBackups.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const maxCount = currentSettings.maxCount;
  if (autoBackups.length > maxCount) {
    const toDelete = autoBackups.slice(0, autoBackups.length - maxCount);

    for (const backup of toDelete) {
      try {
        await deleteBackup(backup.filename);
      } catch (error) {
        logger.error("Failed to delete old automatic backup", {
          filename: backup.filename,
          error: sanitizeUnknown(error),
        });
      }
    }

    logger.info("Cleaned up old automatic backups", {
      deletedCount: toDelete.length,
      maxCount,
    });
  }
}

export async function hydrateBackupSettingsFromDb(
  options: { startScheduler?: boolean } = {},
): Promise<BackupSettings> {
  const [settingRows, adminMemberships] = await Promise.all([
    db
      .select({
        tenantId: schema.settings.tenantId,
        key: schema.settings.key,
        value: schema.settings.value,
        updatedAt: schema.settings.updatedAt,
      })
      .from(schema.settings)
      .where(inArray(schema.settings.key, [...BACKUP_SETTING_KEYS])),
    db
      .select({ tenantId: schema.tenantMemberships.tenantId })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.tenantMemberships.userId, schema.users.id))
      .where(eq(schema.users.isSystemAdmin, true)),
  ]);

  const activeTenantId = getTenantId();
  const allowedTenantIds = new Set<string>([DEFAULT_TENANT_ID]);
  if (activeTenantId) {
    allowedTenantIds.add(activeTenantId);
  }
  for (const membership of adminMemberships) {
    allowedTenantIds.add(membership.tenantId);
  }

  const pickSettingValue = (key: (typeof BACKUP_SETTING_KEYS)[number]): string | null => {
    const matching = settingRows.filter(
      (row) => row.key === key && allowedTenantIds.has(row.tenantId),
    );
    if (matching.length === 0) return null;

    if (activeTenantId) {
      const activeRows = matching
        .filter((row) => row.tenantId === activeTenantId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (activeRows[0]) {
        return activeRows[0].value;
      }
    }

    matching.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return matching[0]?.value ?? null;
  };

  const backupEnabled = pickSettingValue("backupEnabled");
  const backupHour = pickSettingValue("backupHour");
  const backupMaxCount = pickSettingValue("backupMaxCount");

  const parsedHour = backupHour ? Number.parseInt(backupHour, 10) : Number.NaN;
  const parsedMaxCount = backupMaxCount ? Number.parseInt(backupMaxCount, 10) : Number.NaN;

  const parsed: BackupSettings = {
    enabled: backupEnabled === "true" || backupEnabled === "1",
    hour: Number.isNaN(parsedHour) ? 2 : Math.min(23, Math.max(0, parsedHour)),
    maxCount: Number.isNaN(parsedMaxCount) ? 5 : Math.min(5, Math.max(1, parsedMaxCount)),
  };

  if (options.startScheduler) {
    setBackupSettings(parsed);
    if (parsed.enabled && !scheduler.isRunning()) {
      scheduler.start(parsed.hour);
    }
  } else {
    currentSettings = parsed;
  }

  return { ...currentSettings };
}

export function setBackupSettings(settings: Partial<BackupSettings>): void {
  const oldEnabled = currentSettings.enabled;
  const oldHour = currentSettings.hour;

  currentSettings = { ...currentSettings, ...settings };

  logger.info("Backup settings updated", currentSettings);

  if (currentSettings.enabled) {
    if (!oldEnabled || oldHour !== currentSettings.hour) {
      scheduler.start(currentSettings.hour);
    }
  } else if (oldEnabled && !currentSettings.enabled) {
    scheduler.stop();
  }
}

export function getBackupSettings(): BackupSettings {
  return { ...currentSettings };
}

export function getNextBackupTime(): string | null {
  if (scheduler.isRunning()) {
    return scheduler.getNextRun();
  }
  if (currentSettings.enabled) {
    return calculateNextTime(currentSettings.hour).toISOString();
  }
  return null;
}

export function isBackupSchedulerRunning(): boolean {
  return scheduler.isRunning();
}

export function startBackupScheduler(): void {
  if (currentSettings.enabled) {
    scheduler.start(currentSettings.hour);
  }
}

export function stopBackupScheduler(): void {
  scheduler.stop();
}
