/**
 * Loads the numbered SQL migrations from `./migrations` (Node: server, tests, scripts).
 *
 * The Cloudflare Durable Object bundle cannot read the filesystem, so `scripts/build-do-entry.mjs`
 * swaps this module for one with the same files inlined at build time. Keep the export identical.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMigrations } from "./migration-sql";
import type { PortableMigration } from "./portable-migrations";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

export const PORTABLE_MIGRATIONS: readonly PortableMigration[] = buildMigrations(
  Object.fromEntries(
    readdirSync(MIGRATIONS_DIR)
      .filter((fileName) => fileName.endsWith(".sql"))
      .map((fileName) => [fileName, readFileSync(join(MIGRATIONS_DIR, fileName), "utf8")]),
  ),
);
