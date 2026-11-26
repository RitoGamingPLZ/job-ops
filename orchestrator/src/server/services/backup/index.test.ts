import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalBlobStore, R2BlobStore, type R2BucketLike, setBlobStore } from "@infra/blob-store";
import { runWithRequestContext } from "@infra/request-context";
import {
  createDurableObjectDrizzleDb,
  type DurableObjectStorageLike,
  schema,
  setDb,
} from "@server/db/index";
import { runPortableMigrations } from "@server/db/portable-migrations";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as backup from "./index";
import { parseAndVerifyBackupSnapshot } from "./snapshot";

function createInMemoryR2Bucket(): R2BucketLike {
  const objects = new Map<string, { body: Uint8Array; contentType?: string; uploaded: Date }>();

  return {
    async get(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.body.byteLength,
        uploaded: entry.uploaded,
        httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
        async arrayBuffer() {
          return entry.body.slice().buffer;
        },
      };
    },
    async put(key, value, options) {
      const body =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value);
      objects.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date(),
      });
    },
    async delete(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        objects.delete(key);
      }
    },
    async list(options) {
      const prefix = options?.prefix ?? "";
      const matching = Array.from(objects.entries())
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      return {
        objects: matching.map(([key, entry]) => ({
          key,
          size: entry.body.byteLength,
          uploaded: entry.uploaded,
        })),
        truncated: false,
      };
    },
    async head(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return { key, size: entry.body.byteLength };
    },
  };
}

function createFakeDoStorage(sqlite: Database.Database): DurableObjectStorageLike {
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const statement = sqlite.prepare(query);
        const rows = statement.reader ? statement.raw(false).all(...bindings) : [];
        if (!statement.reader) {
          statement.run(...bindings);
        }
        return {
          toArray: () => rows,
          one: () => rows[0],
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      },
    },
    transactionSync: <T>(callback: () => T) => sqlite.transaction(callback)(),
  };
}

describe("Backup Service", () => {
  let tempDir: string;
  let dbPath: string;
  let sqlite: Database.Database | null = null;
  const originalDataDir = process.env.DATA_DIR;
  const originalBackupDir = process.env.BACKUP_DIR;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "backup-test-"));
    dbPath = path.join(tempDir, "jobs.db");
    process.env.DATA_DIR = tempDir;
    delete process.env.BACKUP_DIR;

    sqlite = new Database(dbPath);
    sqlite.exec(
      [
        "PRAGMA journal_mode = DELETE;",
        "CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
        "DELETE FROM test_items;",
        "INSERT INTO test_items (name) VALUES ('alpha');",
      ].join("\n"),
    );

    setDb(drizzle(sqlite, { schema }));
    setBlobStore(new LocalBlobStore(tempDir));
    backup.setBackupBlobStore(null);
    backup.setBackupSettings({ enabled: false, hour: 2, maxCount: 5 });
    backup.stopBackupScheduler();
  });

  afterEach(async () => {
    backup.stopBackupScheduler();
    backup.setBackupBlobStore(null);
    setBlobStore(null);
    setDb(null);
    if (sqlite) {
      sqlite.close();
      sqlite = null;
    }

    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }

    if (originalBackupDir === undefined) {
      delete process.env.BACKUP_DIR;
    } else {
      process.env.BACKUP_DIR = originalBackupDir;
    }

    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("createBackup", () => {
    it("creates a verified portable automatic backup under backups/ without putting files in DATA_DIR root", async () => {
      const filename = await backup.createBackup("auto");

      expect(filename).toMatch(/^jobs_\d{4}_\d{2}_\d{2}\.json\.gz$/);
      expect(fs.existsSync(path.join(tempDir, filename))).toBe(false);

      const backupPath = path.join(tempDir, "backups", filename);
      expect(fs.existsSync(backupPath)).toBe(true);

      const downloaded = await backup.readBackup(filename);
      expect(downloaded).not.toBeNull();
      const snapshot = parseAndVerifyBackupSnapshot(downloaded!.body);
      expect(snapshot.type).toBe("auto");
      expect(snapshot.tables.test_items).toEqual([{ id: 1, name: "alpha" }]);
      expect(snapshot.rowCounts.test_items).toBe(1);
      expect(snapshot.checksums.test_items).toMatch(/^[0-9a-f]{64}$/);
    });

    it("skips duplicate automatic backups on the same UTC day", async () => {
      const first = await backup.createBackup("auto");
      const second = await backup.createBackup("auto");

      expect(second).toBe(first);
      expect(await backup.listBackups()).toHaveLength(1);
    });

    it("creates a manual backup with UTC timestamp and collision suffix regardless of local TZ", async () => {
      const prevTz = process.env.TZ;
      process.env.TZ = "America/New_York";
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-01-15T12:30:45.000Z"));

        const first = await backup.createBackup("manual");
        const second = await backup.createBackup("manual");

        expect(first).toBe("jobs_manual_2026_01_15_12_30_45.json.gz");
        expect(second).toBe("jobs_manual_2026_01_15_12_30_45_1.json.gz");
        expect(fs.existsSync(path.join(tempDir, "backups", second))).toBe(true);

        const listed = await backup.listBackups();
        expect(listed[0]?.createdAt).toBe("2026-01-15T12:30:45.000Z");
      } finally {
        vi.useRealTimers();
        if (prevTz === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = prevTz;
        }
      }
    });

    it("creates, reads, lists, and deletes backups inside Cloudflare DO SQLite + R2BlobStore", async () => {
      const doSqlite = new Database(":memory:");
      try {
        runPortableMigrations(doSqlite);
        doSqlite
          .prepare(
            "INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
          )
          .run("tenant_default", "Default", "default");
        doSqlite
          .prepare("INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?)")
          .run("tenant_default", "backupEnabled", "1");

        const doDb = createDurableObjectDrizzleDb(createFakeDoStorage(doSqlite));
        const r2Store = new R2BlobStore(createInMemoryR2Bucket());
        setDb(doDb);
        setBlobStore(r2Store);
        backup.setBackupBlobStore(null);

        expect(backup.getBackupStorageInfo()).toEqual({
          kind: "r2",
          label: "Cloudflare R2 (backups/)",
        });

        const filename = await backup.createBackup("manual");
        expect(filename).toMatch(/^jobs_manual_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.json\.gz$/);
        expect(await r2Store.exists(`backups/${filename}`)).toBe(true);

        const listed = await backup.listBackups();
        expect(listed).toHaveLength(1);
        expect(listed[0]?.filename).toBe(filename);

        const downloaded = await backup.readBackup(filename);
        expect(downloaded?.contentType).toBe("application/gzip");
        const snapshot = parseAndVerifyBackupSnapshot(downloaded!.body);
        expect(snapshot.schemaVersion).toBeTruthy();
        expect(snapshot.tables.settings).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: "backupEnabled", value: "1" })]),
        );

        await backup.deleteBackup(filename);
        expect(await backup.listBackups()).toHaveLength(0);
      } finally {
        setDb(null);
        doSqlite.close();
      }
    });

    it("routes backups to BACKUP_DIR or custom setBackupBlobStore when configured", async () => {
      const customDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "backup-custom-"));
      try {
        process.env.BACKUP_DIR = customDir;
        expect(backup.getBackupStorageInfo()).toEqual({
          kind: "local",
          label: "Custom backup directory (backups/)",
        });

        const filename = await backup.createBackup("manual");
        expect(fs.existsSync(path.join(customDir, "backups", filename))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, "backups", filename))).toBe(false);

        const dedicatedR2 = new R2BlobStore(createInMemoryR2Bucket());
        backup.setBackupBlobStore(dedicatedR2, {
          kind: "r2",
          label: "Dedicated R2 backup bucket (backups/)",
        });
        expect(backup.getBackupStorageInfo()).toEqual({
          kind: "r2",
          label: "Dedicated R2 backup bucket (backups/)",
        });
        const r2File = await backup.createBackup("auto");
        expect(await dedicatedR2.exists(`backups/${r2File}`)).toBe(true);
      } finally {
        backup.setBackupBlobStore(null);
        delete process.env.BACKUP_DIR;
        await fs.promises.rm(customDir, { recursive: true, force: true });
      }
    });

    it("throws error if database is unavailable", async () => {
      setDb(null);
      if (sqlite) {
        sqlite.close();
        sqlite = null;
      }
      await fs.promises.unlink(dbPath);

      await expect(backup.createBackup("auto")).rejects.toThrow("Database is not available");
    });
  });

  describe("listBackups", () => {
    it("should return empty array when no backups exist", async () => {
      const backups = await backup.listBackups();
      expect(backups).toEqual([]);
    });

    it("should list all backups with metadata", async () => {
      await backup.createBackup("auto");
      await backup.createBackup("manual");

      const backups = await backup.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0]).toHaveProperty("filename");
      expect(backups[0]).toHaveProperty("type");
      expect(backups[0]).toHaveProperty("size");
      expect(backups[0]).toHaveProperty("createdAt");
    });

    it("should sort backups by date (newest first)", async () => {
      const backupsDir = path.join(tempDir, "backups");
      await fs.promises.mkdir(backupsDir, { recursive: true });
      await fs.promises.writeFile(path.join(backupsDir, "jobs_2026_01_01.json.gz"), "old");
      await fs.promises.writeFile(path.join(backupsDir, "jobs_2026_01_15.json.gz"), "new");

      const backups = await backup.listBackups();

      expect(backups[0]?.filename).toBe("jobs_2026_01_15.json.gz");
      expect(backups[1]?.filename).toBe("jobs_2026_01_01.json.gz");
    });

    it("should ignore non-backup files and include legacy .db and suffixed backups", async () => {
      const backupsDir = path.join(tempDir, "backups");
      await fs.promises.mkdir(backupsDir, { recursive: true });
      await backup.createBackup("auto");
      await fs.promises.writeFile(path.join(backupsDir, "random.txt"), "text");
      await fs.promises.writeFile(path.join(backupsDir, "jobs.db"), "db");
      await fs.promises.writeFile(
        path.join(backupsDir, "jobs_manual_2026_01_01_12_00_00_2.db"),
        "manual",
      );

      const backups = await backup.listBackups();

      expect(backups).toHaveLength(2);
      const legacy = backups.find((b) => b.filename === "jobs_manual_2026_01_01_12_00_00_2.db");
      expect(legacy).toMatchObject({
        type: "manual",
        createdAt: "2026-01-01T12:00:00.000Z",
      });
    });
  });

  describe("readBackup & snapshot verification", () => {
    it("rejects invalid filenames and tampered snapshot checksums", async () => {
      await expect(backup.readBackup("../secret.json.gz")).rejects.toThrow(
        "Invalid backup filename",
      );
      expect(await backup.readBackup("jobs_2026_01_01.json.gz")).toBeNull();

      const filename = await backup.createBackup("manual");
      const loaded = await backup.readBackup(filename);
      expect(loaded).not.toBeNull();

      const tampered = Uint8Array.from(loaded!.body);
      tampered[tampered.length - 1] ^= 0xff;
      expect(() => parseAndVerifyBackupSnapshot(tampered)).toThrow();
    });
  });

  describe("deleteBackup", () => {
    it("should delete a backup file", async () => {
      const filename = await backup.createBackup("auto");
      const backupPath = path.join(tempDir, "backups", filename);

      expect(fs.existsSync(backupPath)).toBe(true);

      await backup.deleteBackup(filename);

      expect(fs.existsSync(backupPath)).toBe(false);
    });

    it("should throw error for invalid filename", async () => {
      await expect(backup.deleteBackup("../../../etc/passwd")).rejects.toThrow(
        "Invalid backup filename",
      );
      await expect(backup.deleteBackup("random.txt")).rejects.toThrow("Invalid backup filename");
    });

    it("should throw error if backup does not exist", async () => {
      await expect(backup.deleteBackup("jobs_2026_01_01.json.gz")).rejects.toThrow(
        "Backup not found",
      );
    });

    it("should delete a suffixed manual backup", async () => {
      const backupsDir = path.join(tempDir, "backups");
      await fs.promises.mkdir(backupsDir, { recursive: true });
      const filename = "jobs_manual_2026_01_01_12_00_00_1.json.gz";
      await fs.promises.writeFile(path.join(backupsDir, filename), "manual");

      await backup.deleteBackup(filename);

      expect(fs.existsSync(path.join(backupsDir, filename))).toBe(false);
    });
  });

  describe("cleanupOldBackups", () => {
    it("should delete oldest automatic backups when exceeding max count", async () => {
      const backupsDir = path.join(tempDir, "backups");
      await fs.promises.mkdir(backupsDir, { recursive: true });
      for (let i = 1; i <= 7; i++) {
        const filename = `jobs_2026_01_${String(i).padStart(2, "0")}.json.gz`;
        await fs.promises.writeFile(path.join(backupsDir, filename), "data");
      }

      backup.setBackupSettings({ maxCount: 5 });
      await backup.cleanupOldBackups();

      const remaining = await backup.listBackups();
      expect(remaining).toHaveLength(5);
      const filenames = remaining.map((b) => b.filename);
      expect(filenames).toContain("jobs_2026_01_03.json.gz");
      expect(filenames).toContain("jobs_2026_01_07.json.gz");
      expect(filenames).not.toContain("jobs_2026_01_01.json.gz");
      expect(filenames).not.toContain("jobs_2026_01_02.json.gz");
    });

    it("should not delete manual backups", async () => {
      const backupsDir = path.join(tempDir, "backups");
      await fs.promises.mkdir(backupsDir, { recursive: true });
      for (let i = 1; i <= 7; i++) {
        const filename = `jobs_2026_01_${String(i).padStart(2, "0")}.json.gz`;
        await fs.promises.writeFile(path.join(backupsDir, filename), "data");
      }

      await fs.promises.writeFile(
        path.join(backupsDir, "jobs_manual_2026_01_01_12_00_00.json.gz"),
        "manual",
      );
      await fs.promises.writeFile(
        path.join(backupsDir, "jobs_manual_2026_01_02_12_00_00.json.gz"),
        "manual",
      );

      backup.setBackupSettings({ maxCount: 5 });
      await backup.cleanupOldBackups();

      const remaining = await backup.listBackups();
      const autoBackups = remaining.filter((b) => b.type === "auto");
      const manualBackups = remaining.filter((b) => b.type === "manual");

      expect(autoBackups).toHaveLength(5);
      expect(manualBackups).toHaveLength(2);
    });

    it("should not delete if count is within limit", async () => {
      const backupsDir = path.join(tempDir, "backups");
      await fs.promises.mkdir(backupsDir, { recursive: true });
      for (let i = 1; i <= 3; i++) {
        const filename = `jobs_2026_01_${String(i).padStart(2, "0")}.json.gz`;
        await fs.promises.writeFile(path.join(backupsDir, filename), "data");
      }

      backup.setBackupSettings({ maxCount: 5 });
      await backup.cleanupOldBackups();

      const remaining = await backup.listBackups();
      expect(remaining).toHaveLength(3);
    });
  });

  describe("hydrateBackupSettingsFromDb", () => {
    it("hydrates settings from an admin workspace and ignores non-admin workspace overrides", async () => {
      const migratedSqlite = new Database(":memory:");
      try {
        runPortableMigrations(migratedSqlite);
        migratedSqlite
          .prepare("INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)")
          .run("admin-tenant-1", "Admin Workspace", "admin-ws");
        migratedSqlite
          .prepare("INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)")
          .run("guest-tenant-1", "Guest Workspace", "guest-ws");
        migratedSqlite
          .prepare("INSERT INTO users (id, username, is_system_admin) VALUES (?, ?, ?)")
          .run("admin-user", "admin", 1);
        migratedSqlite
          .prepare("INSERT INTO users (id, username, is_system_admin) VALUES (?, ?, ?)")
          .run("guest-user", "guest", 0);
        migratedSqlite
          .prepare(
            "INSERT INTO tenant_memberships (id, user_id, tenant_id, role) VALUES (?, ?, ?, ?)",
          )
          .run("m-admin", "admin-user", "admin-tenant-1", "owner");
        migratedSqlite
          .prepare(
            "INSERT INTO tenant_memberships (id, user_id, tenant_id, role) VALUES (?, ?, ?, ?)",
          )
          .run("m-guest", "guest-user", "guest-tenant-1", "owner");

        migratedSqlite
          .prepare(
            "INSERT INTO settings (tenant_id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("admin-tenant-1", "admin-user", "backupEnabled", "1", "2026-01-15T01:00:00.000Z");
        migratedSqlite
          .prepare(
            "INSERT INTO settings (tenant_id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("admin-tenant-1", "admin-user", "backupHour", "6", "2026-01-15T01:00:00.000Z");
        migratedSqlite
          .prepare(
            "INSERT INTO settings (tenant_id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("admin-tenant-1", "admin-user", "backupMaxCount", "3", "2026-01-15T01:00:00.000Z");

        // Non-admin row with newer timestamp must be ignored.
        migratedSqlite
          .prepare(
            "INSERT INTO settings (tenant_id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("guest-tenant-1", "guest-user", "backupEnabled", "0", "2026-01-16T01:00:00.000Z");
        migratedSqlite
          .prepare(
            "INSERT INTO settings (tenant_id, user_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("guest-tenant-1", "guest-user", "backupHour", "22", "2026-01-16T01:00:00.000Z");

        setDb(drizzle(migratedSqlite, { schema }));

        const hydrated = await runWithRequestContext({}, () =>
          backup.hydrateBackupSettingsFromDb({ startScheduler: false }),
        );

        expect(hydrated).toEqual({ enabled: true, hour: 6, maxCount: 3 });
        expect(backup.isBackupSchedulerRunning()).toBe(false);
        expect(backup.getNextBackupTime()).not.toBeNull();
      } finally {
        setDb(null);
        migratedSqlite.close();
      }
    });
  });

  describe("setBackupSettings", () => {
    it("should update settings", () => {
      backup.setBackupSettings({ enabled: true, hour: 4, maxCount: 3 });

      const settings = backup.getBackupSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.hour).toBe(4);
      expect(settings.maxCount).toBe(3);
    });

    it("should merge partial settings", () => {
      backup.setBackupSettings({ hour: 6 });

      const settings = backup.getBackupSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.hour).toBe(6);
      expect(settings.maxCount).toBe(5);
    });
  });

  describe("scheduler integration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should start scheduler when enabled", () => {
      const now = new Date("2026-01-15T10:00:00Z");
      vi.setSystemTime(now);

      expect(backup.isBackupSchedulerRunning()).toBe(false);

      backup.setBackupSettings({ enabled: true, hour: 14 });

      expect(backup.isBackupSchedulerRunning()).toBe(true);
      expect(backup.getNextBackupTime()).not.toBeNull();
    });

    it("should stop scheduler when disabled", () => {
      backup.setBackupSettings({ enabled: true, hour: 14 });
      expect(backup.isBackupSchedulerRunning()).toBe(true);

      backup.setBackupSettings({ enabled: false });
      expect(backup.isBackupSchedulerRunning()).toBe(false);
      expect(backup.getNextBackupTime()).toBeNull();
    });

    it("should restart scheduler when hour changes", () => {
      const now = new Date("2026-01-15T10:00:00Z");
      vi.setSystemTime(now);

      backup.setBackupSettings({ enabled: true, hour: 14 });
      const firstRun = backup.getNextBackupTime();

      backup.setBackupSettings({ hour: 16 });
      const secondRun = backup.getNextBackupTime();

      expect(secondRun).not.toBe(firstRun);
      expect(secondRun).not.toBeNull();
      expect(firstRun).not.toBeNull();
      if (secondRun && firstRun) {
        expect(new Date(secondRun).getTime()).toBeGreaterThan(new Date(firstRun).getTime());
      }
    });
  });
});
