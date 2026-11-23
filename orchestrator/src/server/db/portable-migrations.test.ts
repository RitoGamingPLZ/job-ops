import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { db, execRawSql, getDb, runTransactionSync, schema, setDb } from "./index";
import {
  type DoSqlStorageLike,
  PORTABLE_MIGRATIONS,
  type PortableMigration,
  runPortableMigrations,
} from "./portable-migrations";
import { reconcileLegacyDoSchema } from "./reconcile-legacy-do-schema";

function createFakeDoSqlStorage(sqlite: Database.Database): DoSqlStorageLike {
  return {
    exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]) {
      const trimmed = query.trim();
      const upper = trimmed.toUpperCase();
      if (upper.startsWith("SELECT") || upper.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(trimmed).all(...bindings) as T[];
        return {
          [Symbol.iterator]() {
            return rows[Symbol.iterator]();
          },
          toArray() {
            return rows;
          },
        };
      }
      if (bindings.length > 0) {
        sqlite.prepare(trimmed).run(...bindings);
      } else {
        sqlite.exec(trimmed);
      }
      const empty: T[] = [];
      return {
        [Symbol.iterator]() {
          return empty[Symbol.iterator]();
        },
        toArray() {
          return empty;
        },
      };
    },
  };
}

describe("portable-migrations", () => {
  afterEach(() => {
    setDb(null);
  });

  it("applies baseline migrations to better-sqlite3 and is idempotent", () => {
    const sqlite = new Database(":memory:");
    try {
      const first = runPortableMigrations(sqlite);
      expect(first.applied).toEqual(["0001", "0002", "0003"]);
      expect(first.skipped).toEqual([]);
      expect(first.total).toBe(PORTABLE_MIGRATIONS.length);

      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((row) => row.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("tenants");
      expect(tableNames).toContain("jobs");
      expect(tableNames).toContain("pipeline_runs");
      expect(tableNames).toContain("_portable_migrations");

      const defaultTenant = sqlite
        .prepare("SELECT id, name, slug FROM tenants WHERE id = ?")
        .get("tenant_default") as { id: string; name: string; slug: string };
      expect(defaultTenant).toEqual({
        id: "tenant_default",
        name: "JobOps",
        slug: "default",
      });

      const second = runPortableMigrations(sqlite);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(["0001", "0002", "0003"]);
    } finally {
      sqlite.close();
    }
  });

  it("works with Cloudflare DO SqlStorage-compatible executor", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec("CREATE TABLE tracer_links (id TEXT PRIMARY KEY);");
      sqlite.exec("CREATE TABLE tracer_click_events (id TEXT PRIMARY KEY);");
      const doSql = createFakeDoSqlStorage(sqlite);
      const first = runPortableMigrations(doSql);
      expect(first.applied).toEqual(["0001", "0002", "0003"]);
      expect(first.skipped).toEqual([]);

      const remaining = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tracer_links', 'tracer_click_events')",
        )
        .all();
      expect(remaining).toEqual([]);

      const second = runPortableMigrations(doSql);
      expect(second.applied).toEqual([]);
      expect(second.skipped).toEqual(["0001", "0002", "0003"]);
    } finally {
      sqlite.close();
    }
  });

  it("reconciles a legacy jobs table without posting_id and preserves both jobs for one user", () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec(`CREATE TABLE jobs (
        id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, job_url TEXT,
        status TEXT, discovered_at TEXT
      );
      INSERT INTO jobs VALUES ('j1', 'tenant_default', 'u1', 'https://example.com/1', 'applied', '2026-01-01');
      INSERT INTO jobs VALUES ('j2', 'tenant_default', 'u1', 'https://example.com/2', 'ready', '2026-01-02');`);
      const sql = createFakeDoSqlStorage(sqlite);
      reconcileLegacyDoSchema(sql);
      expect(runPortableMigrations(sql).applied).toEqual(["0001", "0002", "0003"]);
      expect(sqlite.prepare("SELECT id, status, posting_id FROM jobs ORDER BY id").all()).toEqual([
        { id: "j1", status: "applied", posting_id: null },
        { id: "j2", status: "ready", posting_id: null },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("applies incremental migrations and detects checksum drift", () => {
    const sqlite = new Database(":memory:");
    try {
      const m1: PortableMigration = {
        id: "0001",
        name: "create_items",
        statements: ['CREATE TABLE IF NOT EXISTS "items" ("id" text PRIMARY KEY NOT NULL);'],
      };
      const m2: PortableMigration = {
        id: "0002",
        name: "add_item_name",
        statements: ['ALTER TABLE "items" ADD COLUMN "name" text;'],
      };

      const res1 = runPortableMigrations(sqlite, [m1]);
      expect(res1.applied).toEqual(["0001"]);

      const res2 = runPortableMigrations(sqlite, [m1, m2]);
      expect(res2.applied).toEqual(["0002"]);
      expect(res2.skipped).toEqual(["0001"]);

      const tamperedM1: PortableMigration = {
        id: "0001",
        name: "create_items",
        statements: [
          'CREATE TABLE IF NOT EXISTS "items" ("id" text PRIMARY KEY NOT NULL, "extra" text);',
        ],
      };
      expect(() => runPortableMigrations(sqlite, [tamperedM1, m2])).toThrow(/checksum mismatch/i);
    } finally {
      sqlite.close();
    }
  });

  it("supports getDb/setDb, runTransactionSync, and execRawSql in db/index.ts", () => {
    const sqlite = new Database(":memory:");
    try {
      const customDb = drizzle(sqlite, { schema });
      setDb(customDb);
      expect(getDb()).toBe(customDb);

      execRawSql(
        'CREATE TABLE IF NOT EXISTS "tenants" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "slug" text NOT NULL UNIQUE, "created_at" text NOT NULL DEFAULT (datetime(\'now\')), "updated_at" text NOT NULL DEFAULT (datetime(\'now\')));',
      );

      const inserted = runTransactionSync((tx) => {
        tx.insert(schema.tenants)
          .values({
            id: "tenant_custom",
            name: "Custom",
            slug: "custom",
          })
          .run();
        return tx.select().from(schema.tenants).all();
      });

      expect(inserted).toHaveLength(1);
      expect(inserted[0]?.id).toBe("tenant_custom");

      expect(() =>
        runTransactionSync(async () => {
          return "not-allowed";
        }),
      ).toThrow(/must be synchronous/i);

      setDb(null);
      expect(getDb()).toBe(db);
    } finally {
      sqlite.close();
    }
  });
});
