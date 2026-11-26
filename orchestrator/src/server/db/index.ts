/**
 * Database connection and initialization.
 */

import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleDurable } from "drizzle-orm/durable-sqlite";
import { getDataDir } from "../config/dataDir";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DurableObjectStorageLike {
  sql: {
    exec: (query: string, ...bindings: unknown[]) => unknown;
  };
  transactionSync: <T>(callback: () => T) => T;
}

interface BetterSqliteDatabaseLike {
  pragma: (source: string) => unknown;
  exec: (source: string) => unknown;
  prepare: (source: string) => {
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => unknown;
  };
  close: () => unknown;
}

let defaultSqlite: BetterSqliteDatabaseLike | null = null;
let defaultDb: AppDatabase | null = null;
let isClosed = false;
let activeDb: AppDatabase | null = null;

function getOrCreateDefaultDb(): AppDatabase {
  if (defaultDb) {
    return defaultDb;
  }

  const requireBase = import.meta.url.startsWith("file:")
    ? import.meta.url
    : join(process.cwd(), "package.json");
  const nodeRequire = createRequire(requireBase);
  const Database = nodeRequire("better-sqlite3") as new (
    filename: string,
  ) => BetterSqliteDatabaseLike;
  const { drizzle } = nodeRequire("drizzle-orm/better-sqlite3") as {
    drizzle: (client: BetterSqliteDatabaseLike, config: { schema: typeof schema }) => AppDatabase;
  };

  // Database path - can be overridden via env for Docker
  const dbPath = join(getDataDir(), "jobs.db");

  // Ensure data directory exists
  const dataDir = dirname(dbPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  defaultSqlite = sqlite;
  defaultDb = drizzle(sqlite, { schema });
  return defaultDb;
}

type RunResult = { changes: number; lastInsertRowid: number | bigint };
type PreparedQueryLike = { run: (placeholderValues?: unknown) => unknown };

/**
 * drizzle's durable-sqlite `run()` returns `undefined`, while better-sqlite3 returns
 * `{ changes, lastInsertRowid }`. App code reads `.changes` from `.run()` and from awaited
 * insert/update/delete builders, so make the Durable Object driver return the same shape.
 */
function patchRunResult(doDb: unknown, storage: DurableObjectStorageLike): void {
  const session = (
    doDb as {
      session: { prepareQuery: (...args: unknown[]) => PreparedQueryLike };
    }
  ).session;
  const prepareQuery = session.prepareQuery.bind(session);
  session.prepareQuery = (...args) => {
    const prepared = prepareQuery(...args);
    const run = prepared.run.bind(prepared);
    prepared.run = (placeholderValues) => {
      run(placeholderValues);
      return readRunResult(storage);
    };
    return prepared;
  };
}

function readRunResult(storage: DurableObjectStorageLike): RunResult {
  const cursor = storage.sql.exec("SELECT changes() AS changes, last_insert_rowid() AS id") as {
    one: () => { changes: number; id: number | bigint };
  };
  const row = cursor.one();
  return { changes: Number(row.changes), lastInsertRowid: row.id };
}

/**
 * Creates a Drizzle database instance backed by Cloudflare Durable Object SQLite storage.
 * Wraps `transaction()` so synchronous callbacks return their value (working around
 * drizzle-orm@0.38.2 SQLiteDOSession returning `{}`).
 */
export function createDurableObjectDrizzleDb(storage: DurableObjectStorageLike): AppDatabase {
  const doDb = drizzleDurable(storage as Parameters<typeof drizzleDurable>[0], {
    schema,
  });
  patchRunResult(doDb, storage);
  const originalTransaction = doDb.transaction.bind(doDb);
  (
    doDb as unknown as {
      transaction: <T>(fn: (tx: AppDatabase) => T, config?: unknown) => T;
    }
  ).transaction = (fn, config) => {
    let captured!: ReturnType<typeof fn>;
    let hasCaptured = false;
    originalTransaction((tx) => {
      captured = fn(tx as unknown as AppDatabase);
      hasCaptured = true;
      return captured;
    }, config as never);
    return hasCaptured ? captured : (undefined as ReturnType<typeof fn>);
  };
  return doDb as unknown as AppDatabase;
}

/**
 * Returns the active Drizzle database instance (defaulting to the lazy local better-sqlite3 proxy).
 */
export function getDb(): AppDatabase {
  return activeDb ?? db;
}

function getUnderlyingDb(): AppDatabase {
  return activeDb ?? getOrCreateDefaultDb();
}

export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, prop) {
    const current = getUnderlyingDb();
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
  set(_target, prop, value) {
    const current = getUnderlyingDb();
    return Reflect.set(current, prop, value, current);
  },
  defineProperty(_target, prop, attributes) {
    return Reflect.defineProperty(getUnderlyingDb(), prop, attributes);
  },
  has(_target, prop) {
    return Reflect.has(getUnderlyingDb(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getUnderlyingDb());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const current = getUnderlyingDb();
    const desc = Reflect.getOwnPropertyDescriptor(current, prop);
    if (desc) {
      return { ...desc, configurable: true };
    }
    if (prop in current) {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: Reflect.get(current, prop, current),
      };
    }
    return undefined;
  },
});

/**
 * Overrides the active Drizzle database instance (e.g. for Durable Object SQLite or tests).
 * Pass null to restore the default better-sqlite3 instance.
 */
export function setDb(customDb: AppDatabase | null): void {
  activeDb = customDb ?? null;
}

/**
 * Runs a synchronous database transaction with no `await` inside.
 * Matches Cloudflare Durable Object `transactionSync` semantics.
 */
export function runTransactionSync<T>(fn: (tx: AppDatabase) => T): T {
  const currentDb = getUnderlyingDb();
  return currentDb.transaction((tx) => {
    const result = fn(tx as unknown as AppDatabase);
    if (
      result !== null &&
      typeof result === "object" &&
      "then" in result &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      throw new Error(
        "runTransactionSync callback must be synchronous and must not return a Promise",
      );
    }
    return result;
  });
}

/**
 * Executes raw SQL statements against the active database backend.
 */
export function execRawSql(sqlText: string): void {
  const currentDb = getUnderlyingDb();
  if (defaultSqlite && currentDb === defaultDb) {
    defaultSqlite.exec(sqlText);
    return;
  }
  const client = (
    currentDb as {
      $client?: {
        exec?: (sql: string) => unknown;
        sql?: { exec?: (sql: string) => unknown };
      };
    }
  ).$client;
  if (client && typeof client.exec === "function") {
    client.exec(sqlText);
    return;
  }
  if (client?.sql && typeof client.sql.exec === "function") {
    client.sql.exec(sqlText);
    return;
  }
  currentDb.run(sql.raw(sqlText));
}

/**
 * Returns true when an active database connection (e.g. DO SQLite or open local SQLite file)
 * is ready to be queried without creating an empty database file on disk.
 */
export function isDatabaseAvailable(): boolean {
  if (activeDb !== null) {
    return true;
  }
  if (defaultSqlite !== null) {
    return !isClosed;
  }
  return existsSync(join(getDataDir(), "jobs.db"));
}

/**
 * Executes a read-only raw SQL query against the active database backend (local better-sqlite3
 * or Cloudflare DO SqlStorage) and returns all result rows as plain objects.
 */
export function queryRawSql<T = Record<string, unknown>>(
  sqlText: string,
  params: unknown[] = [],
): T[] {
  const currentDb = getUnderlyingDb();
  if (defaultSqlite && currentDb === defaultDb) {
    return defaultSqlite.prepare(sqlText).all(...params) as T[];
  }
  const client = (
    currentDb as {
      $client?: {
        prepare?: (sql: string) => { all: (...p: unknown[]) => unknown[] };
        sql?: {
          exec: (sql: string, ...p: unknown[]) => Iterable<T> & { toArray?: () => T[] };
        };
      };
    }
  ).$client;
  if (client && typeof client.prepare === "function") {
    return client.prepare(sqlText).all(...params) as T[];
  }
  if (client?.sql && typeof client.sql.exec === "function") {
    const cursor = client.sql.exec(sqlText, ...params);
    return typeof cursor.toArray === "function" ? cursor.toArray() : Array.from(cursor);
  }
  if (params.length === 0) {
    return currentDb.all(sql.raw(sqlText)) as T[];
  }
  throw new Error("Active database client does not support parameterized raw SQL queries");
}

export { schema };

export function closeDb() {
  if (isClosed || !defaultSqlite) return;
  defaultSqlite.close();
  isClosed = true;
}
