import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { internalD1SyncRouter } from "../api/routes/internal-d1-sync";
import {
  collectD1Changes,
  getD1SyncSchema,
  importTablesFromD1,
  listPdfFiles,
  readPdfFile,
  resetD1SyncBaseline,
  writePdfFile,
} from "./d1-sync";

function createTestDb(dbPath: string): void {
  const sqlite = new Database(dbPath);
  try {
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        is_system_admin INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE settings (
        tenant_id TEXT NOT NULL,
        user_id TEXT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        UNIQUE(tenant_id, user_id, key)
      );
    `);
  } finally {
    sqlite.close();
  }
}

describe("d1-sync service", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "jobops-d1-sync-"));
    dbPath = join(tempDir, "jobs.db");
    createTestDb(dbPath);
    resetD1SyncBaseline(dbPath);
  });

  afterEach(() => {
    resetD1SyncBaseline(dbPath);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers tables and primary or unique keys", () => {
    const schema = getD1SyncSchema(dbPath);
    expect(schema).toEqual([
      {
        name: "settings",
        columns: ["tenant_id", "user_id", "key", "value"],
        pkColumns: ["tenant_id", "user_id", "key"],
      },
      {
        name: "users",
        columns: ["id", "username", "is_system_admin"],
        pkColumns: ["id"],
      },
    ]);
  });

  it("imports D1 tables and collects only subsequent inserts, updates, and deletes", () => {
    const imported = importTablesFromD1(
      {
        users: [{ id: "u1", username: "admin-test", is_system_admin: 1 }],
        settings: [
          {
            tenant_id: "t1",
            user_id: null,
            key: "theme",
            value: "dark",
          },
        ],
      },
      dbPath,
    );

    expect(imported).toEqual({ importedTables: 2, importedRows: 2 });

    // No local mutations yet -> empty diff
    expect(collectD1Changes(dbPath)).toEqual({ upserts: [], deletes: [] });

    // Mutate local SQLite: insert u2, update setting, delete u1
    const sqlite = new Database(dbPath);
    try {
      sqlite
        .prepare("INSERT INTO users (id, username, is_system_admin) VALUES (?, ?, ?)")
        .run("u2", "alan", 0);
      sqlite.prepare("UPDATE settings SET value = ? WHERE key = ?").run("light", "theme");
      sqlite.prepare("DELETE FROM users WHERE id = ?").run("u1");
    } finally {
      sqlite.close();
    }

    const changes = collectD1Changes(dbPath);
    expect(changes.upserts).toEqual([
      {
        table: "settings",
        columns: ["tenant_id", "user_id", "key", "value"],
        rows: [["t1", null, "theme", "light"]],
      },
      {
        table: "users",
        columns: ["id", "username", "is_system_admin"],
        rows: [["u2", "alan", 0]],
      },
    ]);
    expect(changes.deletes).toEqual([
      {
        table: "users",
        pkColumns: ["id"],
        keys: [["u1"]],
      },
    ]);

    // Subsequent collect has no further changes
    expect(collectD1Changes(dbPath)).toEqual({ upserts: [], deletes: [] });
  });

  it("writes, lists, and reads PDF files while rejecting path traversal", () => {
    writePdfFile("tenant-1/resume.pdf", Buffer.from("%PDF-1.4"), tempDir);
    const listed = listPdfFiles(tempDir);
    expect(listed.map((f) => f.path)).toEqual(["tenant-1/resume.pdf"]);
    expect(readPdfFile("tenant-1/resume.pdf", tempDir)?.toString()).toBe("%PDF-1.4");
    expect(() => readPdfFile("../../etc/passwd", tempDir)).toThrow(/Invalid PDF path/);
  });
});

describe("internal-d1-sync router auth", () => {
  const originalSecret = process.env.INTERNAL_SYNC_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_SYNC_SECRET;
    } else {
      process.env.INTERNAL_SYNC_SECRET = originalSecret;
    }
  });

  it("rejects missing or invalid x-internal-sync-secret and allows valid secret", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/internal/d1-sync", internalD1SyncRouter);

    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected numeric port");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      delete process.env.INTERNAL_SYNC_SECRET;
      const unconfigured = await fetch(`${baseUrl}/api/internal/d1-sync/files`);
      expect(unconfigured.status).toBe(403);

      process.env.INTERNAL_SYNC_SECRET = "test-sync-secret";
      const wrong = await fetch(`${baseUrl}/api/internal/d1-sync/files`, {
        headers: { "x-internal-sync-secret": "wrong" },
      });
      expect(wrong.status).toBe(401);

      const valid = await fetch(`${baseUrl}/api/internal/d1-sync/files`, {
        headers: { "x-internal-sync-secret": "test-sync-secret" },
      });
      expect(valid.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
