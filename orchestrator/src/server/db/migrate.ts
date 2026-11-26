/**
 * Applies database migrations. Run on every deploy (`npm run db:migrate`, container entrypoints).
 *
 *  1. `runLegacyUpgrade`: frozen; brings a database from before numbered migrations up to the
 *     baseline. A no-op on every boot after the first.
 *  2. `runPortableMigrations`: applies the numbered `.sql` files in `./migrations` that this
 *     database has not recorded yet. This is where all new schema changes go.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { getDataDir } from "../config/dataDir";
import { runLegacyUpgrade } from "./legacy-upgrade";
import { runPortableMigrations } from "./portable-migrations";

// Database path - can be overridden via env for Docker
const DB_PATH = join(getDataDir(), "jobs.db");

const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

console.log("🔧 Running database migrations...");
const sqlite = new Database(DB_PATH);
try {
  runLegacyUpgrade(sqlite);

  const { applied, skipped } = runPortableMigrations(sqlite);
  for (const id of skipped) console.log(`↩️ ${id} already applied`);
  for (const id of applied) console.log(`✅ ${id} applied`);
} catch (error) {
  console.error("❌ Migration failed:", error);
  process.exit(1);
} finally {
  sqlite.close();
}
console.log("🎉 Database migrations complete!");
