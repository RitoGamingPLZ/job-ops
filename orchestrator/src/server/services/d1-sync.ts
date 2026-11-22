import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { getDataDir } from "@server/config/dataDir";
import Database from "better-sqlite3";

export interface D1TableSchema {
  name: string;
  columns: string[];
  pkColumns: string[];
}

export interface D1UpsertBatch {
  table: string;
  columns: string[];
  rows: unknown[][];
}

export interface D1DeleteBatch {
  table: string;
  pkColumns: string[];
  keys: unknown[][];
}

export interface D1ChangesPayload {
  upserts: D1UpsertBatch[];
  deletes: D1DeleteBatch[];
}

export interface PdfFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

const baselineByDbPath = new Map<
  string,
  Map<string, Map<string, { rowJson: string; pkValues: unknown[] }>>
>();

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function openSqlite(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return new Database(dbPath);
}

export function getDefaultSyncDbPath(): string {
  return join(getDataDir(), "jobs.db");
}

function getOrCreateBaseline(
  dbPath: string,
): Map<string, Map<string, { rowJson: string; pkValues: unknown[] }>> {
  let map = baselineByDbPath.get(dbPath);
  if (!map) {
    map = new Map();
    baselineByDbPath.set(dbPath, map);
  }
  return map;
}

export function resetD1SyncBaseline(dbPath = getDefaultSyncDbPath()): void {
  baselineByDbPath.delete(dbPath);
}

export function getContainerHydrationState(dbPath = getDefaultSyncDbPath()): {
  hydrated: boolean;
  userCount: number;
} {
  const sqlite = openSqlite(dbPath);
  let userCount = 0;
  try {
    const row = sqlite.prepare('SELECT COUNT(*) as n FROM "users"').get() as
      | { n?: number }
      | undefined;
    userCount = Number(row?.n ?? 0);
  } catch {
    userCount = 0;
  } finally {
    sqlite.close();
  }

  if (userCount > 0 && !baselineByDbPath.has(dbPath)) {
    const schemas = getD1SyncSchema(dbPath);
    const baseline = getOrCreateBaseline(dbPath);
    const snapDb = openSqlite(dbPath);
    try {
      for (const schema of schemas) {
        const rows = snapDb.prepare(`SELECT * FROM ${quoteIdent(schema.name)}`).all() as Array<
          Record<string, unknown>
        >;
        baseline.set(schema.name, buildRowSnapshot(schema, rows));
      }
    } finally {
      snapDb.close();
    }
  }

  return { hydrated: userCount > 0, userCount };
}

export function getD1SyncSchema(dbPath = getDefaultSyncDbPath()): D1TableSchema[] {
  const sqlite = openSqlite(dbPath);
  try {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    return tables.map((table) => {
      const colRows = sqlite
        .prepare(`PRAGMA table_info(${quoteIdent(table.name)})`)
        .all() as Array<{ name: string; pk: number }>;

      const columns = colRows.map((c) => c.name);
      let pkColumns = colRows
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      if (pkColumns.length === 0) {
        const indexes = sqlite
          .prepare(`PRAGMA index_list(${quoteIdent(table.name)})`)
          .all() as Array<{ name: string; unique: number }>;
        const uniqueIdx = indexes.find((idx) => idx.unique === 1);
        if (uniqueIdx) {
          const idxCols = sqlite
            .prepare(`PRAGMA index_info(${quoteIdent(uniqueIdx.name)})`)
            .all() as Array<{ name: string | null }>;
          pkColumns = idxCols
            .map((c) => c.name)
            .filter((name): name is string => typeof name === "string");
        }
      }

      if (pkColumns.length === 0) {
        pkColumns = [...columns];
      }

      return {
        name: table.name,
        columns,
        pkColumns,
      };
    });
  } finally {
    sqlite.close();
  }
}

function buildRowSnapshot(
  schema: D1TableSchema,
  rows: Array<Record<string, unknown>>,
): Map<string, { rowJson: string; pkValues: unknown[] }> {
  const snapshot = new Map<string, { rowJson: string; pkValues: unknown[] }>();
  for (const row of rows) {
    const pkValues = schema.pkColumns.map((col) => row[col] ?? null);
    const pkKey = JSON.stringify(pkValues);
    const orderedRow = schema.columns.map((col) => row[col] ?? null);
    snapshot.set(pkKey, {
      rowJson: JSON.stringify(orderedRow),
      pkValues,
    });
  }
  return snapshot;
}

export function importTablesFromD1(
  tablesPayload: Record<string, Array<Record<string, unknown>>>,
  dbPathOrOptions: string | { dbPath?: string; append?: boolean } = {},
): { importedTables: number; importedRows: number } {
  const dbPath =
    typeof dbPathOrOptions === "string"
      ? dbPathOrOptions
      : (dbPathOrOptions.dbPath ?? getDefaultSyncDbPath());
  const append = typeof dbPathOrOptions === "string" ? false : Boolean(dbPathOrOptions.append);
  const schemas = getD1SyncSchema(dbPath);
  const schemaByName = new Map(schemas.map((s) => [s.name, s]));
  const sqlite = openSqlite(dbPath);
  const baseline = getOrCreateBaseline(dbPath);

  let importedTables = 0;
  let importedRows = 0;

  try {
    sqlite.pragma("foreign_keys = OFF");
    const runImport = sqlite.transaction(() => {
      for (const schema of schemas) {
        const incomingRows = tablesPayload[schema.name];
        if (!Array.isArray(incomingRows)) continue;

        if (!append) {
          sqlite.prepare(`DELETE FROM ${quoteIdent(schema.name)}`).run();
        }

        if (incomingRows.length > 0 && schema.columns.length > 0) {
          const placeholders = schema.columns.map(() => "?").join(", ");
          const colList = schema.columns.map(quoteIdent).join(", ");
          const insertStmt = sqlite.prepare(
            `INSERT OR REPLACE INTO ${quoteIdent(schema.name)} (${colList}) VALUES (${placeholders})`,
          );

          for (const row of incomingRows) {
            const values = schema.columns.map((col) => row[col] ?? null);
            insertStmt.run(...values);
          }
        }

        const currentRows = sqlite
          .prepare(`SELECT * FROM ${quoteIdent(schema.name)}`)
          .all() as Array<Record<string, unknown>>;
        baseline.set(schema.name, buildRowSnapshot(schema, currentRows));
        importedTables += 1;
        importedRows += incomingRows.length;
      }

      // Initialize baseline for any local table not included in payload
      for (const [name, schema] of schemaByName) {
        if (!baseline.has(name)) {
          const currentRows = sqlite.prepare(`SELECT * FROM ${quoteIdent(name)}`).all() as Array<
            Record<string, unknown>
          >;
          baseline.set(name, buildRowSnapshot(schema, currentRows));
        }
      }
    });

    runImport();
  } finally {
    sqlite.pragma("foreign_keys = ON");
    sqlite.close();
  }

  return { importedTables, importedRows };
}

export function collectD1Changes(dbPath = getDefaultSyncDbPath()): D1ChangesPayload {
  const schemas = getD1SyncSchema(dbPath);
  const sqlite = openSqlite(dbPath);
  const baseline = getOrCreateBaseline(dbPath);

  const upserts: D1UpsertBatch[] = [];
  const deletes: D1DeleteBatch[] = [];

  try {
    for (const schema of schemas) {
      const currentRows = sqlite.prepare(`SELECT * FROM ${quoteIdent(schema.name)}`).all() as Array<
        Record<string, unknown>
      >;
      const currentSnapshot = buildRowSnapshot(schema, currentRows);
      const prevSnapshot = baseline.get(schema.name) ?? new Map();

      const changedRows: unknown[][] = [];
      for (const row of currentRows) {
        const pkValues = schema.pkColumns.map((col) => row[col] ?? null);
        const pkKey = JSON.stringify(pkValues);
        const currentEntry = currentSnapshot.get(pkKey);
        const prevEntry = prevSnapshot.get(pkKey);
        if (!prevEntry || prevEntry.rowJson !== currentEntry?.rowJson) {
          changedRows.push(schema.columns.map((col) => row[col] ?? null));
        }
      }

      const deletedKeys: unknown[][] = [];
      for (const [pkKey, prevEntry] of prevSnapshot.entries()) {
        if (!currentSnapshot.has(pkKey)) {
          deletedKeys.push(prevEntry.pkValues);
        }
      }

      if (changedRows.length > 0) {
        upserts.push({
          table: schema.name,
          columns: schema.columns,
          rows: changedRows,
        });
      }

      if (deletedKeys.length > 0) {
        deletes.push({
          table: schema.name,
          pkColumns: schema.pkColumns,
          keys: deletedKeys,
        });
      }

      baseline.set(schema.name, currentSnapshot);
    }
  } finally {
    sqlite.close();
  }

  return { upserts, deletes };
}

function getPdfsRootDir(dataDir = getDataDir()): string {
  return resolve(join(dataDir, "pdfs"));
}

function resolveSafePdfPath(relativePath: string, dataDir = getDataDir()): string {
  const root = getPdfsRootDir(dataDir);
  const normalized = relativePath.replace(/^\/+/, "");
  const target = resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid PDF path outside pdfs directory");
  }
  return target;
}

export function listPdfFiles(dataDir = getDataDir()): PdfFileEntry[] {
  const root = getPdfsRootDir(dataDir);
  if (!existsSync(root)) return [];

  const entries: PdfFileEntry[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const stats = statSync(fullPath);
        entries.push({
          path: relative(root, fullPath).split(sep).join("/"),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        });
      }
    }
  };

  walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function readPdfFile(relativePath: string, dataDir = getDataDir()): Buffer | null {
  const target = resolveSafePdfPath(relativePath, dataDir);
  if (!existsSync(target)) return null;
  return readFileSync(target);
}

export function writePdfFile(relativePath: string, content: Buffer, dataDir = getDataDir()): void {
  const target = resolveSafePdfPath(relativePath, dataDir);
  const parent = dirname(target);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(target, content);
}
