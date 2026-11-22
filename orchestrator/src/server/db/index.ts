/**
 * Database connection and initialization.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDataDir } from "../config/dataDir";
import * as schema from "./schema";

// Database path - can be overridden via env for Docker
const DB_PATH = join(getDataDir(), "jobs.db");

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
let isClosed = false;

export const db = drizzle(sqlite, { schema });

export type AppDatabase = typeof db;

let activeDb: AppDatabase = db;

/**
 * Returns the active Drizzle database instance (defaulting to local better-sqlite3).
 */
export function getDb(): AppDatabase {
  return activeDb;
}

/**
 * Overrides the active Drizzle database instance (e.g. for Durable Object SQLite or tests).
 * Pass null to restore the default better-sqlite3 instance.
 */
export function setDb(customDb: AppDatabase | null): void {
  activeDb = customDb ?? db;
}

/**
 * Runs a synchronous database transaction with no `await` inside.
 * Matches Cloudflare Durable Object `transactionSync` semantics.
 */
export function runTransactionSync<T>(fn: (tx: AppDatabase) => T): T {
  const currentDb = getDb();
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
  const currentDb = getDb();
  if (currentDb === db) {
    sqlite.exec(sqlText);
    return;
  }
  const client = (
    currentDb as { $client?: { exec?: (sql: string) => unknown } }
  ).$client;
  if (client && typeof client.exec === "function") {
    client.exec(sqlText);
    return;
  }
  currentDb.run(sql.raw(sqlText));
}

export { schema };

export function closeDb() {
  if (isClosed) return;
  sqlite.close();
  isClosed = true;
}
