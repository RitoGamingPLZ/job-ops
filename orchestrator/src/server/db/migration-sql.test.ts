import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildMigrations, parseMigrationSql } from "./migration-sql";
import { computeMigrationChecksum, PORTABLE_MIGRATIONS } from "./portable-migrations";

describe("parseMigrationSql", () => {
  it("splits on statement breakpoints and trims", () => {
    expect(
      parseMigrationSql(
        "CREATE TABLE a (id text);\n--> statement-breakpoint\n\nCREATE INDEX i ON a (id);\n",
      ),
    ).toEqual(["CREATE TABLE a (id text);", "CREATE INDEX i ON a (id);"]);
  });

  it("returns the same statements for CRLF and LF files", () => {
    const lf = "CREATE TABLE a (\n  id text\n);\n--> statement-breakpoint\nDROP TABLE b;\n";
    expect(parseMigrationSql(lf.replace(/\n/g, "\r\n"))).toEqual(parseMigrationSql(lf));
  });

  it("does not split on the marker text inside a statement", () => {
    expect(parseMigrationSql("INSERT INTO t VALUES ('x --> statement-breakpoint y');")).toEqual([
      "INSERT INTO t VALUES ('x --> statement-breakpoint y');",
    ]);
  });
});

describe("buildMigrations", () => {
  const sql = "SELECT 1;";

  it("orders by id and derives id and name from the file name", () => {
    const migrations = buildMigrations({ "0002_b.sql": sql, "0001_a.sql": sql });
    expect(migrations.map((m) => [m.id, m.name])).toEqual([
      ["0001", "0001_a"],
      ["0002", "0002_b"],
    ]);
  });

  it("rejects badly named files", () => {
    expect(() => buildMigrations({ "1_a.sql": sql })).toThrow(/Invalid migration file name/);
    expect(() => buildMigrations({ "0001_A.sql": sql })).toThrow(/Invalid migration file name/);
  });

  it("rejects gaps, duplicate ids and empty files", () => {
    expect(() => buildMigrations({ "0001_a.sql": sql, "0003_c.sql": sql })).toThrow(/contiguous/);
    expect(() => buildMigrations({ "0001_a.sql": sql, "0001_b.sql": sql })).toThrow(/contiguous/);
    expect(() => buildMigrations({ "0001_a.sql": "\n  \n" })).toThrow(/no statements/);
  });
});

describe("shipped migration files", () => {
  it("loads every .sql file in migrations/ as a contiguous series", () => {
    const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
    expect(PORTABLE_MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files.sort());
  });

  // These checksums are stored in every database that has run the migration. A change here means
  // a shipped migration was edited (or its parsing changed) and existing databases would throw
  // "checksum mismatch". Fix forward with a new migration instead of updating these values.
  it("keeps the checksums of shipped migrations unchanged", () => {
    const shipped: Record<string, string> = {
      "0001_baseline": "1c2d1517",
      "0002_default_tenant": "191c9ae2",
      "0003_drop_removed_tables": "50d6985c",
      "0004_company_ratings": "71e93517",
      "0005_user_permissions_and_invitations": "d2d7f12e",
    };
    for (const [name, checksum] of Object.entries(shipped)) {
      const migration = PORTABLE_MIGRATIONS.find((m) => m.name === name);
      expect(migration, name).toBeDefined();
      expect(computeMigrationChecksum(migration?.statements ?? []), name).toBe(checksum);
    }
  });
});
