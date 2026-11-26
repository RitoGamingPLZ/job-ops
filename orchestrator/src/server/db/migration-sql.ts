/**
 * Turns numbered `.sql` migration files into `PortableMigration`s.
 * Pure (no Node imports) so it can run inside the Cloudflare Durable Object bundle too.
 */

import type { PortableMigration } from "./portable-migrations";

const FILE_NAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/**
 * Splits one migration file into statements on `--> statement-breakpoint` lines (the marker
 * drizzle-kit uses). Line endings are normalised first: a CRLF checkout
 * (git autocrlf on Windows) must not change a statement's content, because the recorded checksum
 * is computed over it.
 */
export function parseMigrationSql(sqlText: string): string[] {
  return sqlText
    .replace(/\r\n?/g, "\n")
    .split(/^--> statement-breakpoint[ \t]*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Builds the ordered migration list from `{ "0001_name.sql": "<file text>" }`.
 * Throws on anything that would make ordering ambiguous: bad names, duplicate or skipped ids,
 * or an empty file.
 */
export function buildMigrations(files: Readonly<Record<string, string>>): PortableMigration[] {
  const migrations = Object.keys(files)
    .sort()
    .map((fileName): PortableMigration => {
      const match = FILE_NAME_PATTERN.exec(fileName);
      if (!match) {
        throw new Error(
          `Invalid migration file name "${fileName}" (expected NNNN_snake_case_name.sql)`,
        );
      }
      const statements = parseMigrationSql(files[fileName] ?? "");
      if (statements.length === 0) {
        throw new Error(`Migration file "${fileName}" contains no statements`);
      }
      return { id: match[1] as string, name: fileName.replace(/\.sql$/, ""), statements };
    });

  migrations.forEach((migration, index) => {
    const expected = String(index + 1).padStart(4, "0");
    if (migration.id !== expected) {
      throw new Error(
        `Migration ids must be contiguous from 0001: expected ${expected}, found ${migration.id} (${migration.name})`,
      );
    }
  });

  return migrations;
}
