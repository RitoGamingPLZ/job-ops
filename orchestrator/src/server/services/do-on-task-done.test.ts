import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DurableObjectStorageLike } from "../db/index";
import { runPortableMigrations } from "../db/portable-migrations";
import { handleDurableObjectTaskDone } from "./do-on-task-done";

function createTestDoStorage(sqlite: Database.Database): DurableObjectStorageLike {
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const trimmed = query.trim();
        if (/^(SELECT|PRAGMA|WITH)\b/i.test(trimmed) || /\bRETURNING\b/i.test(trimmed)) {
          const rows = sqlite.prepare(query).all(...bindings);
          return {
            toArray: () => rows,
            [Symbol.iterator]: () => rows[Symbol.iterator](),
          };
        }
        if (bindings.length > 0) {
          sqlite.prepare(query).run(...bindings);
        } else {
          sqlite.exec(query);
        }
        return {
          toArray: () => [],
          [Symbol.iterator]: () => [][Symbol.iterator](),
        };
      },
    },
    transactionSync<T>(callback: () => T): T {
      return sqlite.transaction(callback)();
    },
  };
}

describe("handleDurableObjectTaskDone", () => {
  it("inserts postings, deduplicates per tenant/user, and isolates tenants", () => {
    const sqlite = new Database(":memory:");
    try {
      runPortableMigrations(sqlite);
      sqlite
        .prepare("INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)")
        .run("tenant_b", "Tenant B", "tenant-b");
      sqlite.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run("user-1", "alice");

      const storage = createTestDoStorage(sqlite);

      const resA1 = handleDurableObjectTaskDone(storage, {
        taskId: "t-1",
        tenantId: "tenant_default",
        userId: "user-1",
        source: "indeed",
        outcome: "completed",
        postings: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Backend Engineer",
            employer: "Acme",
          },
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Backend Engineer",
            employer: "Acme",
          },
        ],
      });
      expect(resA1).toEqual({
        inserted: 1,
        skipped: 1,
        tenantId: "tenant_default",
        pipelineRunId: null,
      });

      const resB = handleDurableObjectTaskDone(storage, {
        taskId: "t-2",
        tenantId: "tenant_b",
        userId: "user-1",
        source: "indeed",
        outcome: "completed",
        postings: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Backend Engineer",
            employer: "Acme",
          },
        ],
      });
      expect(resB).toEqual({
        inserted: 1,
        skipped: 0,
        tenantId: "tenant_b",
        pipelineRunId: null,
      });

      const countRows = sqlite
        .prepare(
          "SELECT tenant_id, COUNT(*) as cnt FROM jobs GROUP BY tenant_id ORDER BY tenant_id",
        )
        .all() as Array<{ tenant_id: string; cnt: number }>;
      expect(countRows).toEqual([
        { tenant_id: "tenant_b", cnt: 1 },
        { tenant_id: "tenant_default", cnt: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("updates pipeline_runs counters and marks completed or partial when all tasks finish", () => {
    const sqlite = new Database(":memory:");
    try {
      runPortableMigrations(sqlite);
      sqlite
        .prepare(
          `INSERT INTO pipeline_runs (id, tenant_id, status, tasks_total, tasks_done, tasks_failed, tasks_cached, jobs_discovered, started_at)
           VALUES (?, ?, 'running', 2, 0, 0, 0, 0, datetime('now'))`,
        )
        .run("run-1", "tenant_default");

      const storage = createTestDoStorage(sqlite);

      handleDurableObjectTaskDone(storage, {
        taskId: "t-1",
        tenantId: "tenant_default",
        pipelineRunId: "run-1",
        source: "gradcracker",
        outcome: "completed",
        postings: [
          {
            jobUrl: "https://example.com/jobs/10",
            title: "Grad SWE",
            employer: "Beta",
          },
        ],
      });

      let run = sqlite
        .prepare(
          "SELECT status, jobs_discovered, tasks_done, tasks_failed FROM pipeline_runs WHERE id = ?",
        )
        .get("run-1") as {
        status: string;
        jobs_discovered: number;
        tasks_done: number;
        tasks_failed: number;
      };
      expect(run).toEqual({
        status: "running",
        jobs_discovered: 1,
        tasks_done: 1,
        tasks_failed: 0,
      });

      handleDurableObjectTaskDone(storage, {
        taskId: "t-2",
        tenantId: "tenant_default",
        pipelineRunId: "run-1",
        source: "gradcracker",
        outcome: "failed",
        postings: [],
      });

      run = sqlite
        .prepare(
          "SELECT status, jobs_discovered, tasks_done, tasks_failed FROM pipeline_runs WHERE id = ?",
        )
        .get("run-1") as {
        status: string;
        jobs_discovered: number;
        tasks_done: number;
        tasks_failed: number;
      };
      expect(run).toEqual({
        status: "partial",
        jobs_discovered: 1,
        tasks_done: 1,
        tasks_failed: 1,
      });
    } finally {
      sqlite.close();
    }
  });
});
