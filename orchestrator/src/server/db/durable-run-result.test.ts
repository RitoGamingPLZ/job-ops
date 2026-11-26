import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDurableObjectDrizzleDb,
  type DurableObjectStorageLike,
  isDatabaseAvailable,
  queryRawSql,
  runTransactionSync,
  setDb,
} from "./index";
import { settings } from "./schema";

/** Minimal Durable Object SQL storage backed by better-sqlite3, mirroring `ctx.storage`. */
function createFakeStorage(sqlite: Database.Database): DurableObjectStorageLike {
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const statement = sqlite.prepare(query);
        const rows = statement.reader ? statement.raw(false).all(...bindings) : [];
        if (!statement.reader) statement.run(...bindings);
        return { toArray: () => rows, one: () => rows[0] };
      },
    },
    transactionSync: <T>(callback: () => T) => sqlite.transaction(callback)(),
  };
}

describe("Durable Object drizzle db", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof createDurableObjectDrizzleDb>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(
      `CREATE TABLE settings (
        tenant_id TEXT NOT NULL,
        user_id TEXT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    );
    db = createDurableObjectDrizzleDb(createFakeStorage(sqlite));
  });

  afterEach(() => {
    setDb(null);
    sqlite.close();
  });

  const row = (key: string) => ({ tenantId: "t", userId: "u", key, value: "v" });

  it("returns the affected row count from run() like better-sqlite3", () => {
    db.insert(settings)
      .values([row("a"), row("b"), row("c")])
      .run();

    const updated = db.update(settings).set({ value: "x" }).where(eq(settings.key, "a")).run();
    expect(updated.changes).toBe(1);

    const none = db.delete(settings).where(eq(settings.key, "missing")).run();
    expect(none.changes).toBe(0);

    const deleted = db.delete(settings).run();
    expect(deleted.changes).toBe(3);
  });

  it("returns changes from awaited builders without .run()", async () => {
    db.insert(settings)
      .values([row("a"), row("b")])
      .run();

    const result = (await db.delete(settings).where(eq(settings.key, "a"))) as unknown as {
      changes: number;
    };
    expect(result.changes).toBe(1);
  });

  it("returns lastInsertRowid from inserts", () => {
    const result = db.insert(settings).values(row("a")).run();
    expect(result.changes).toBe(1);
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });

  it("keeps transaction return values", () => {
    const value = db.transaction((tx) => {
      tx.insert(settings).values(row("a")).run();
      return tx.delete(settings).run().changes;
    });
    expect(value).toBe(1);
  });

  it("supports queryRawSql and isDatabaseAvailable inside DO transactionSync", () => {
    setDb(db);
    expect(isDatabaseAvailable()).toBe(true);

    db.insert(settings)
      .values([row("alpha"), row("beta")])
      .run();

    const rows = runTransactionSync(() =>
      queryRawSql<{ key: string; value: string }>(
        "SELECT key, value FROM settings WHERE key = ? ORDER BY key ASC",
        ["alpha"],
      ),
    );
    expect(rows).toEqual([{ key: "alpha", value: "v" }]);
  });
});
