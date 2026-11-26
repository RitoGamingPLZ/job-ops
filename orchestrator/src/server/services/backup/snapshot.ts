import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { isDatabaseAvailable, queryRawSql, runTransactionSync } from "@server/db/index";

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function computeTableChecksum(rows: Record<string, unknown>[]): string {
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

  if (!isPlainRecord(parsed)) {
    throw new Error("Backup snapshot must be a JSON object");
  }
  if (parsed.format !== "job-ops-backup" || parsed.version !== 1) {
    throw new Error("Unsupported backup snapshot format or version");
  }
  if (typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt))) {
    throw new Error("Invalid backup snapshot createdAt timestamp");
  }
  if (parsed.type !== "auto" && parsed.type !== "manual") {
    throw new Error("Invalid backup snapshot type");
  }
  if (
    !isPlainRecord(parsed.tables) ||
    !isPlainRecord(parsed.rowCounts) ||
    !isPlainRecord(parsed.checksums)
  ) {
    throw new Error("Backup snapshot is missing tables, rowCounts, or checksums");
  }

  const tables = parsed.tables;
  const rowCounts = parsed.rowCounts;
  const checksums = parsed.checksums;

  for (const tableName of new Set([
    ...Object.keys(tables),
    ...Object.keys(rowCounts),
    ...Object.keys(checksums),
  ])) {
    const rows = tables[tableName];
    if (!Array.isArray(rows) || !rows.every(isPlainRecord)) {
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
