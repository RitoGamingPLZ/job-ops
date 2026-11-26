import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { asRecord } from "@shared/utils/type-conversion";
import {
  execRawSql,
  isDatabaseAvailable,
  queryRawSql,
  runRawSql,
  runTransactionSync,
} from "@server/db/index";

export interface DatabaseBackupSnapshot {
  format: "job-ops-backup";
  version: 1;
  createdAt: string;
  type: "auto" | "manual";
  schemaVersion: string | null;
  tables: Record<string, Record<string, unknown>[]>;
  rowCounts: Record<string, number>;
  checksums: Record<string, string>;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function normalizeCellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof ArrayBuffer) {
    return {
      __backupType: "bytes",
      base64: Buffer.from(new Uint8Array(value)).toString("base64"),
    };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      __backupType: "bytes",
      base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    };
  }
  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeCellValue(value);
  }
  return normalized;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

function computeTableChecksum(rows: Record<string, unknown>[]): string {
  const payload = rows.map((row) => canonicalJson(row)).join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

function isMissingRowidError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column:\s*rowid/i.test(message);
}

function readTableRows(tableName: string): Record<string, unknown>[] {
  const quoted = quoteIdent(tableName);
  let rows: Record<string, unknown>[];
  try {
    rows = queryRawSql<Record<string, unknown>>(`SELECT * FROM ${quoted} ORDER BY rowid ASC`);
  } catch (error) {
    if (!isMissingRowidError(error)) {
      throw error;
    }
    rows = queryRawSql<Record<string, unknown>>(`SELECT * FROM ${quoted}`);
  }
  return rows.map(normalizeRow);
}

function extractSchemaVersion(tables: Record<string, Record<string, unknown>[]>): string | null {
  const migrationRows = tables._portable_migrations;
  if (!Array.isArray(migrationRows) || migrationRows.length === 0) {
    return null;
  }
  const ids = migrationRows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  return ids.at(-1) ?? null;
}

/**
 * Reads all user tables inside a single synchronous transaction to produce a consistent
 * point-in-time snapshot with per-table SHA-256 checksums compatible with `/_cf/do/import`.
 */
export function exportDatabaseSnapshot(
  type: "auto" | "manual",
  now = new Date(),
): DatabaseBackupSnapshot {
  if (!isDatabaseAvailable()) {
    throw new Error("Database is not available for backup");
  }

  const tables = runTransactionSync(() => {
    const tableRows = queryRawSql<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY name ASC`,
    );

    const exported: Record<string, Record<string, unknown>[]> = {};
    for (const { name } of tableRows) {
      exported[name] = readTableRows(name);
    }
    return exported;
  });

  const rowCounts: Record<string, number> = {};
  const checksums: Record<string, string> = {};
  for (const [tableName, rows] of Object.entries(tables)) {
    rowCounts[tableName] = rows.length;
    checksums[tableName] = computeTableChecksum(rows);
  }

  return {
    format: "job-ops-backup",
    version: 1,
    createdAt: now.toISOString(),
    type,
    schemaVersion: extractSchemaVersion(tables),
    tables,
    rowCounts,
    checksums,
  };
}

/** Migration bookkeeping tables describe the live schema, so a restore never touches them. */
const RESTORE_EXCLUDED_TABLES = new Set([
  "_portable_migrations",
  "app_data_migrations",
  "__drizzle_migrations",
]);

export interface RestoreSnapshotResult {
  tableCount: number;
  rowCount: number;
}

function decodeCellValue(value: unknown): unknown {
  const record = asRecord(value);
  if (record && record.__backupType === "bytes" && typeof record.base64 === "string") {
    return Buffer.from(record.base64, "base64");
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

function readCurrentSchemaVersion(): string | null {
  try {
    const rows = queryRawSql<{ id: unknown }>("SELECT id FROM _portable_migrations");
    const ids = rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    return ids.at(-1) ?? null;
  } catch {
    return null;
  }
}

/**
 * Replaces the contents of every user table with the snapshot's rows in one synchronous
 * transaction, so a failure leaves the live database untouched. Tables and columns the
 * snapshot knows nothing about are cleared or defaulted; tables and columns that no longer
 * exist in the live schema are skipped. Callers must block concurrent writers while it runs.
 */
export function restoreDatabaseSnapshot(snapshot: DatabaseBackupSnapshot): RestoreSnapshotResult {
  if (!isDatabaseAvailable()) {
    throw new Error("Database is not available for restore");
  }

  const currentVersion = readCurrentSchemaVersion();
  if (
    snapshot.schemaVersion &&
    currentVersion &&
    snapshot.schemaVersion.localeCompare(currentVersion) > 0
  ) {
    throw new Error(
      "This backup was created by a newer version of the app. Update the app before restoring it.",
    );
  }

  return runTransactionSync(() => {
    // Defer FK checks to commit so tables can be emptied and refilled in any order.
    try {
      execRawSql("PRAGMA defer_foreign_keys = ON");
    } catch {
      // Not supported by every backend; ordering then relies on the backup being consistent.
    }

    const liveTables = queryRawSql<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
       ORDER BY name ASC`,
    )
      .map((row) => row.name)
      .filter((name) => !RESTORE_EXCLUDED_TABLES.has(name));

    for (const tableName of liveTables) {
      runRawSql(`DELETE FROM ${quoteIdent(tableName)}`);
    }

    let tableCount = 0;
    let rowCount = 0;
    for (const tableName of liveTables) {
      const rows = snapshot.tables[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const columns = new Set(
        queryRawSql<{ name: string }>(`PRAGMA table_info(${quoteIdent(tableName)})`).map(
          (column) => column.name,
        ),
      );

      const statements = new Map<string, string>();
      for (const row of rows) {
        const keys = Object.keys(row).filter((key) => columns.has(key));
        if (keys.length === 0) continue;
        const cacheKey = keys.join("\u0000");
        let statement = statements.get(cacheKey);
        if (!statement) {
          statement = `INSERT INTO ${quoteIdent(tableName)} (${keys.map(quoteIdent).join(", ")}) VALUES (${keys
            .map(() => "?")
            .join(", ")})`;
          statements.set(cacheKey, statement);
        }
        runRawSql(
          statement,
          keys.map((key) => decodeCellValue(row[key])),
        );
        rowCount += 1;
      }
      tableCount += 1;
    }

    return { tableCount, rowCount };
  });
}

export function serializeBackupSnapshot(snapshot: DatabaseBackupSnapshot): Uint8Array {
  const compressed = gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"), { level: 6 });
  return new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength);
}

export function parseAndVerifyBackupSnapshot(compressed: Uint8Array): DatabaseBackupSnapshot {
  if (!(compressed instanceof Uint8Array) || compressed.byteLength === 0) {
    throw new Error("Backup archive is empty");
  }

  let parsed: unknown;
  try {
    const jsonText = gunzipSync(compressed).toString("utf8");
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Failed to decompress or parse backup snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const snapshotRecord = asRecord(parsed);
  if (!snapshotRecord) {
    throw new Error("Backup snapshot must be a JSON object");
  }
  if (snapshotRecord.format !== "job-ops-backup" || snapshotRecord.version !== 1) {
    throw new Error("Unsupported backup snapshot format or version");
  }
  if (
    typeof snapshotRecord.createdAt !== "string" ||
    Number.isNaN(Date.parse(snapshotRecord.createdAt))
  ) {
    throw new Error("Invalid backup snapshot createdAt timestamp");
  }
  if (snapshotRecord.type !== "auto" && snapshotRecord.type !== "manual") {
    throw new Error("Invalid backup snapshot type");
  }
  const tables = asRecord(snapshotRecord.tables);
  const rowCounts = asRecord(snapshotRecord.rowCounts);
  const checksums = asRecord(snapshotRecord.checksums);
  if (!tables || !rowCounts || !checksums) {
    throw new Error("Backup snapshot is missing tables, rowCounts, or checksums");
  }

  for (const tableName of new Set([
    ...Object.keys(tables),
    ...Object.keys(rowCounts),
    ...Object.keys(checksums),
  ])) {
    const rows = tables[tableName];
    if (!Array.isArray(rows) || !rows.every((row) => asRecord(row) !== null)) {
      throw new Error(`Invalid row array for table ${tableName}`);
    }
    if (rowCounts[tableName] !== rows.length) {
      throw new Error(
        `Row count mismatch for table ${tableName}: expected ${String(rowCounts[tableName])}, got ${rows.length}`,
      );
    }
    const actualChecksum = computeTableChecksum(rows);
    if (checksums[tableName] !== actualChecksum) {
      throw new Error(`SHA-256 checksum mismatch for table ${tableName}`);
    }
  }

  return parsed as unknown as DatabaseBackupSnapshot;
}
