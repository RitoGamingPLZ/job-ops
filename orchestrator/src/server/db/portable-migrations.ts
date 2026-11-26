/**
 * Portable ordered SQL migrations usable by both better-sqlite3 and Cloudflare Durable Object SqlStorage.
 *
 * The migrations themselves are the numbered files in `./migrations` (see its README). This module
 * is the runner: it applies the ones not yet recorded in `_portable_migrations` and refuses to
 * continue if a recorded one has changed.
 *
 * Its only import is `migration-files`, which the Durable Object build swaps for an inlined copy,
 * so nothing Node-specific ends up in the Workers bundle.
 */

import { PORTABLE_MIGRATIONS } from "./migration-files";

export { PORTABLE_MIGRATIONS };

export interface PortableSqlExecutor {
  exec(sqlText: string): void;
  query<T = Record<string, unknown>>(sqlText: string, params?: unknown[]): T[];
  run(sqlText: string, params?: unknown[]): void;
}

export interface BetterSqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

export interface DoSqlStorageLike {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): Iterable<T> & { toArray?: () => T[] };
}

export type PortableMigrationTarget = PortableSqlExecutor | BetterSqliteLike | DoSqlStorageLike;

export interface PortableMigration {
  id: string;
  name: string;
  statements: readonly string[];
}

export interface PortableMigrationResult {
  applied: string[];
  skipped: string[];
  total: number;
}

function createBetterSqliteExecutor(sqlite: BetterSqliteLike): PortableSqlExecutor {
  return {
    exec(sqlText: string) {
      sqlite.exec(sqlText);
    },
    query<T = Record<string, unknown>>(sqlText: string, params: unknown[] = []): T[] {
      return sqlite.prepare(sqlText).all(...params) as T[];
    },
    run(sqlText: string, params: unknown[] = []) {
      sqlite.prepare(sqlText).run(...params);
    },
  };
}

function createDoSqlStorageExecutor(sqlStorage: DoSqlStorageLike): PortableSqlExecutor {
  return {
    exec(sqlText: string) {
      sqlStorage.exec(sqlText);
    },
    query<T = Record<string, unknown>>(sqlText: string, params: unknown[] = []): T[] {
      const cursor = sqlStorage.exec<T>(sqlText, ...params);
      if (typeof cursor.toArray === "function") {
        return cursor.toArray();
      }
      return Array.from(cursor);
    },
    run(sqlText: string, params: unknown[] = []) {
      sqlStorage.exec(sqlText, ...params);
    },
  };
}

function toPortableSqlExecutor(target: PortableMigrationTarget): PortableSqlExecutor {
  if (
    "query" in target &&
    typeof target.query === "function" &&
    "run" in target &&
    typeof target.run === "function"
  ) {
    return target;
  }
  if ("prepare" in target && typeof target.prepare === "function") {
    return createBetterSqliteExecutor(target);
  }
  return createDoSqlStorageExecutor(target as DoSqlStorageLike);
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function computeMigrationChecksum(statements: readonly string[]): string {
  return fnv1aHex(statements.join("\n"));
}

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`. Treat adding a column that is already there as done,
 * so a database that already has the column (built by the legacy upgrade, or a retry after a
 * crash that landed mid-migration) can still adopt the migration.
 */
function isAlreadyAppliedAddColumn(statement: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i.test(statement) &&
    /duplicate column name/i.test(message)
  );
}

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "_portable_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" text NOT NULL DEFAULT (datetime('now'))
);`;

/**
 * Runs ordered portable SQL migrations against better-sqlite3 or Cloudflare DO SqlStorage.
 * Tracks applied migrations in `_portable_migrations` and is idempotent across repeated runs.
 */
export function runPortableMigrations(
  target: PortableMigrationTarget,
  migrations: readonly PortableMigration[] = PORTABLE_MIGRATIONS,
): PortableMigrationResult {
  const executor = toPortableSqlExecutor(target);
  executor.exec(MIGRATIONS_TABLE_SQL);

  const existingRows = executor.query<{ id: string; checksum: string }>(
    'SELECT "id", "checksum" FROM "_portable_migrations"',
  );
  const appliedMap = new Map(existingRows.map((row) => [row.id, row.checksum]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const checksum = computeMigrationChecksum(migration.statements);
    const existingChecksum = appliedMap.get(migration.id);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${migration.id} (${migration.name})`);
      }
      skipped.push(migration.id);
      continue;
    }

    for (const statement of migration.statements) {
      try {
        executor.exec(statement);
      } catch (error) {
        if (!isAlreadyAppliedAddColumn(statement, error)) throw error;
      }
    }

    executor.run('INSERT INTO "_portable_migrations" ("id", "name", "checksum") VALUES (?, ?, ?)', [
      migration.id,
      migration.name,
      checksum,
    ]);
    appliedMap.set(migration.id, checksum);
    applied.push(migration.id);
  }

  return {
    applied,
    skipped,
    total: migrations.length,
  };
}
