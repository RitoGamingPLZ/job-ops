import { randomUUID } from "node:crypto";
import type { DurableObjectStorageLike } from "../db/index";

export interface OnTaskDonePosting {
  postingId?: string;
  jobUrl: string;
  title: string;
  employer: string;
  location?: string | null;
  salary?: string | null;
  datePosted?: string | null;
  description?: string | null;
  extractedJson?: string | null;
}

export interface OnTaskDonePayload {
  taskId: string;
  tenantId: string;
  userId?: string | null;
  pipelineRunId?: string | null;
  source: string;
  outcome: "completed" | "failed" | "cached";
  postings?: OnTaskDonePosting[];
}

export interface OnTaskDoneResult {
  inserted: number;
  skipped: number;
  tenantId: string;
  pipelineRunId: string | null;
}

function readCursorRows<T>(cursor: unknown): T[] {
  if (!cursor || typeof cursor !== "object") {
    return [];
  }
  const maybeToArray = (cursor as { toArray?: () => T[] }).toArray;
  if (typeof maybeToArray === "function") {
    return maybeToArray.call(cursor);
  }
  if (Symbol.iterator in cursor) {
    return Array.from(cursor as Iterable<T>);
  }
  return [];
}

/**
 * Persists discovered scrape postings and updates pipeline run counters inside
 * a Cloudflare Durable Object SQLite transaction, scoped by tenant and user.
 */
export function handleDurableObjectTaskDone(
  storage: DurableObjectStorageLike,
  payload: OnTaskDonePayload,
): OnTaskDoneResult {
  const tenantId = payload.tenantId || "tenant_default";
  const userId = payload.userId ?? null;
  const pipelineRunId = payload.pipelineRunId ?? null;
  const postings = Array.isArray(payload.postings) ? payload.postings : [];

  let inserted = 0;
  let skipped = 0;

  storage.transactionSync(() => {
    for (const posting of postings) {
      const existing = readCursorRows<{ id: string }>(
        storage.sql.exec(
          `SELECT id FROM jobs
           WHERE tenant_id = ? AND coalesce(user_id, '') = ? AND job_url = ?
           LIMIT 1`,
          tenantId,
          userId ?? "",
          posting.jobUrl,
        ),
      );

      if (existing.length > 0) {
        skipped += 1;
        continue;
      }

      const id = randomUUID();
      storage.sql.exec(
        `INSERT INTO jobs (
          id, tenant_id, user_id, posting_id, source, date_posted,
          title, employer, job_url, salary, location, job_description,
          status, discovered_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'), datetime('now'))`,
        id,
        tenantId,
        userId,
        posting.postingId ?? null,
        payload.source,
        posting.datePosted ?? null,
        posting.title,
        posting.employer,
        posting.jobUrl,
        posting.salary ?? null,
        posting.location ?? null,
        posting.description ?? null,
      );
      inserted += 1;
    }

    if (pipelineRunId) {
      const doneInc = payload.outcome === "completed" ? 1 : 0;
      const failedInc = payload.outcome === "failed" ? 1 : 0;
      const cachedInc = payload.outcome === "cached" ? 1 : 0;

      storage.sql.exec(
        `UPDATE pipeline_runs
         SET jobs_discovered = jobs_discovered + ?,
             tasks_done = tasks_done + ?,
             tasks_failed = tasks_failed + ?,
             tasks_cached = tasks_cached + ?
         WHERE id = ? AND tenant_id = ?`,
        inserted,
        doneInc,
        failedInc,
        cachedInc,
        pipelineRunId,
        tenantId,
      );

      const runRows = readCursorRows<{
        tasks_total: number;
        tasks_done: number;
        tasks_failed: number;
        tasks_cached: number;
      }>(
        storage.sql.exec(
          `SELECT tasks_total, tasks_done, tasks_failed, tasks_cached
           FROM pipeline_runs
           WHERE id = ? AND tenant_id = ?
           LIMIT 1`,
          pipelineRunId,
          tenantId,
        ),
      );

      const run = runRows[0];
      if (run && run.tasks_total > 0) {
        const finished = run.tasks_done + run.tasks_failed + run.tasks_cached;
        if (finished >= run.tasks_total) {
          const finalStatus = run.tasks_failed > 0 ? "partial" : "completed";
          storage.sql.exec(
            `UPDATE pipeline_runs
             SET status = ?, completed_at = datetime('now')
             WHERE id = ? AND tenant_id = ?`,
            finalStatus,
            pipelineRunId,
            tenantId,
          );
        }
      }
    }
  });

  return { inserted, skipped, tenantId, pipelineRunId };
}
