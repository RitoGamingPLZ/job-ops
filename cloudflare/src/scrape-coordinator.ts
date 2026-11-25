import { DurableObject } from "cloudflare:workers";
import type { OnTaskDonePosting } from "./app-store";
import type { Env } from "./types";
import { sleep } from "./utils";

const DISPATCH_INTERVAL_MS = 30_000;
const LEASE_DURATION_MS = 5 * 60_000;
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_MIN_INTERVAL_MS = 30_000;
const COOLDOWN_MIN_MS = 5 * 60_000;
const COOLDOWN_MAX_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SCRAPER_POOL_SIZE = 2;

export type ScrapeRuntime = "worker" | "browser" | "container";

export interface EnsureTaskInput {
  source: string;
  target: string;
  title?: string | null;
  location?: string | null;
  runtime?: ScrapeRuntime;
  params?: Record<string, unknown>;
  tenantId: string;
  userId?: string | null;
  pipelineRunId?: string | null;
  callbackUrl?: string | null;
  rateLimit?: {
    maxConcurrent?: number;
    minIntervalMs?: number;
    dailyCap?: number | null;
  };
}

export interface ScrapePostingInput {
  jobUrl: string;
  title: string;
  employer: string;
  location?: string | null;
  salary?: string | null;
  datePosted?: string | null;
  description?: string | null;
  extracted?: Record<string, unknown> | null;
}

export interface CompleteTaskInput {
  taskId: string;
  postings: ScrapePostingInput[];
  meta?: Record<string, unknown>;
}

interface ScrapeTaskRow {
  id: string;
  scrape_key: string;
  source: string;
  target: string;
  title: string | null;
  location: string | null;
  runtime: string;
  params_json: string | null;
  status: string;
  window_start: number;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  next_retry_at: number | null;
  last_error: string | null;
  result_r2_key: string | null;
  result_count: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  [key: string]: SqlStorageValue;
}

interface SourceStateRow {
  source: string;
  max_concurrent: number;
  min_interval_ms: number;
  daily_cap: number | null;
  active_count: number;
  last_dispatched_at: number | null;
  daily_count: number;
  daily_window_start: number | null;
  cooldown_until: number | null;
  consecutive_rate_limits: number;
  updated_at: number;
  [key: string]: SqlStorageValue;
}

interface SubscriberRow {
  id: string;
  task_id: string;
  tenant_id: string;
  user_id: string | null;
  pipeline_run_id: string | null;
  callback_url: string | null;
  notified_at: number | null;
  [key: string]: SqlStorageValue;
}

function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function buildScrapeKey(parts: {
  source: string;
  target: string;
  title?: string | null;
  location?: string | null;
}): string {
  return [
    parts.source.trim().toLowerCase(),
    parts.target.trim().toLowerCase(),
    (parts.title ?? "").trim().toLowerCase(),
    (parts.location ?? "").trim().toLowerCase(),
  ].join("|");
}

function getPoolSize(env: Env): number {
  const parsed = Number.parseInt(env.SCRAPER_POOL_SIZE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SCRAPER_POOL_SIZE;
}

export class ScrapeCoordinatorDO extends DurableObject<Env> {
  private poolCursor = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS scrape_tasks (
				id TEXT PRIMARY KEY,
				scrape_key TEXT NOT NULL,
				source TEXT NOT NULL,
				target TEXT NOT NULL,
				title TEXT,
				location TEXT,
				runtime TEXT NOT NULL DEFAULT 'worker',
				params_json TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				window_start INTEGER NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 3,
				lease_owner TEXT,
				lease_expires_at INTEGER,
				next_retry_at INTEGER,
				last_error TEXT,
				result_r2_key TEXT,
				result_count INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				completed_at INTEGER,
				UNIQUE(scrape_key, window_start)
			);

			CREATE INDEX IF NOT EXISTS idx_scrape_tasks_status_retry
				ON scrape_tasks (status, next_retry_at);
			CREATE INDEX IF NOT EXISTS idx_scrape_tasks_key_completed
				ON scrape_tasks (scrape_key, completed_at);

			CREATE TABLE IF NOT EXISTS task_subscribers (
				id TEXT PRIMARY KEY,
				task_id TEXT NOT NULL REFERENCES scrape_tasks(id) ON DELETE CASCADE,
				tenant_id TEXT NOT NULL,
				user_id TEXT,
				pipeline_run_id TEXT,
				callback_url TEXT,
				notified_at INTEGER,
				created_at INTEGER NOT NULL,
				UNIQUE(task_id, tenant_id, pipeline_run_id)
			);

			CREATE TABLE IF NOT EXISTS postings (
				id TEXT PRIMARY KEY,
				source TEXT NOT NULL,
				url_norm TEXT NOT NULL UNIQUE,
				job_url TEXT NOT NULL,
				title TEXT NOT NULL,
				employer TEXT NOT NULL,
				location TEXT,
				salary TEXT,
				date_posted TEXT,
				description TEXT,
				extracted_json TEXT,
				first_seen_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_postings_last_seen
				ON postings (last_seen_at);

			CREATE TABLE IF NOT EXISTS source_state (
				source TEXT PRIMARY KEY,
				max_concurrent INTEGER NOT NULL DEFAULT 1,
				min_interval_ms INTEGER NOT NULL DEFAULT 30000,
				daily_cap INTEGER,
				active_count INTEGER NOT NULL DEFAULT 0,
				last_dispatched_at INTEGER,
				daily_count INTEGER NOT NULL DEFAULT 0,
				daily_window_start INTEGER,
				cooldown_until INTEGER,
				consecutive_rate_limits INTEGER NOT NULL DEFAULT 0,
				updated_at INTEGER NOT NULL
			);
		`);
  }

  private async scheduleDispatcherAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + DISPATCH_INTERVAL_MS);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_cf/scrape/ensure" && request.method === "POST") {
      const input = (await request.json()) as EnsureTaskInput;
      const result = await this.ensureTask(input);
      return Response.json({ ok: true, data: result });
    }

    if (url.pathname === "/_cf/scrape/complete" && request.method === "POST") {
      const input = (await request.json()) as CompleteTaskInput;
      const result = await this.completeTask(input);
      return Response.json({ ok: true, data: result });
    }

    if (url.pathname === "/_cf/scrape/rate-limit" && request.method === "POST") {
      const body = (await request.json()) as {
        taskId: string;
        source: string;
        statusCode: number;
      };
      const result = await this.recordRateLimitHit(body.taskId, body.source, body.statusCode);
      return Response.json({ ok: true, data: result });
    }

    if (url.pathname === "/_cf/scrape/needs-attention" && request.method === "POST") {
      const body = (await request.json()) as { taskId: string; reason: string };
      await this.markTaskNeedsAttention(body.taskId, body.reason);
      return Response.json({ ok: true, data: { taskId: body.taskId } });
    }

    if (url.pathname === "/_cf/scrape/dispatch" && request.method === "POST") {
      await this.alarm();
      return Response.json({ ok: true, data: { dispatched: true } });
    }

    if (url.pathname === "/_cf/scrape/status" && request.method === "GET") {
      const counts = this.ctx.storage.sql
        .exec<{ status: string; n: number }>(
          `SELECT status, COUNT(*) as n FROM scrape_tasks GROUP BY status`,
        )
        .toArray();
      const sources = this.ctx.storage.sql
        .exec<SourceStateRow>(`SELECT * FROM source_state ORDER BY source ASC`)
        .toArray();
      return Response.json({ ok: true, data: { counts, sources } });
    }

    return Response.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Unknown ScrapeCoordinator route: ${url.pathname}`,
        },
      },
      { status: 404 },
    );
  }

  async ensureTask(input: EnsureTaskInput): Promise<{
    taskId: string;
    status: string;
    reused: boolean;
    cached: boolean;
  }> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const scrapeKey = buildScrapeKey(input);
    const rollingCutoff = now - ROLLING_WINDOW_MS;
    const windowStart = Math.floor(now / ROLLING_WINDOW_MS) * ROLLING_WINDOW_MS;

    if (input.rateLimit) {
      sql.exec(
        `INSERT INTO source_state (
					source, max_concurrent, min_interval_ms, daily_cap, updated_at
				) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(source) DO UPDATE SET
					max_concurrent = COALESCE(excluded.max_concurrent, source_state.max_concurrent),
					min_interval_ms = COALESCE(excluded.min_interval_ms, source_state.min_interval_ms),
					daily_cap = COALESCE(excluded.daily_cap, source_state.daily_cap),
					updated_at = excluded.updated_at`,
        input.source,
        input.rateLimit.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
        input.rateLimit.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
        input.rateLimit.dailyCap ?? null,
        now,
      );
    }

    const recentCompleted = sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks
				 WHERE scrape_key = ?
				   AND status = 'completed'
				   AND completed_at >= ?
				 ORDER BY completed_at DESC
				 LIMIT 1`,
        scrapeKey,
        rollingCutoff,
      )
      .toArray()[0];

    if (recentCompleted) {
      this.attachSubscriber(recentCompleted.id, input, now);
      await this.notifySubscribersFromArchive(recentCompleted, "cached");
      return {
        taskId: recentCompleted.id,
        status: recentCompleted.status,
        reused: true,
        cached: true,
      };
    }

    const existingActive = sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks
				 WHERE scrape_key = ?
				   AND window_start = ?
				 LIMIT 1`,
        scrapeKey,
        windowStart,
      )
      .toArray()[0];

    if (existingActive) {
      this.attachSubscriber(existingActive.id, input, now);
      await this.scheduleDispatcherAlarm();
      return {
        taskId: existingActive.id,
        status: existingActive.status,
        reused: true,
        cached: false,
      };
    }

    const taskId = crypto.randomUUID();
    sql.exec(
      `INSERT INTO scrape_tasks (
				id, scrape_key, source, target, title, location, runtime,
				params_json, status, window_start, attempts, max_attempts,
				created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)`,
      taskId,
      scrapeKey,
      input.source,
      input.target,
      input.title ?? null,
      input.location ?? null,
      input.runtime ?? "worker",
      input.params ? JSON.stringify(input.params) : null,
      windowStart,
      DEFAULT_MAX_ATTEMPTS,
      now,
      now,
    );

    this.attachSubscriber(taskId, input, now);
    await this.scheduleDispatcherAlarm();

    return {
      taskId,
      status: "pending",
      reused: false,
      cached: false,
    };
  }

  private attachSubscriber(taskId: string, input: EnsureTaskInput, now: number): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO task_subscribers (
				id, task_id, tenant_id, user_id, pipeline_run_id, callback_url, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      taskId,
      input.tenantId,
      input.userId ?? null,
      input.pipelineRunId ?? null,
      input.callbackUrl ?? null,
      now,
    );
  }

  async completeTask(input: CompleteTaskInput): Promise<{
    taskId: string;
    postingsCount: number;
    r2Key: string | null;
    notifiedCount: number;
  }> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const task = sql
      .exec<ScrapeTaskRow>(`SELECT * FROM scrape_tasks WHERE id = ? LIMIT 1`, input.taskId)
      .toArray()[0];

    if (!task) {
      throw new Error(`Scrape task not found: ${input.taskId}`);
    }

    const postingsForNotification: OnTaskDonePosting[] = [];

    this.ctx.storage.transactionSync(() => {
      for (const item of input.postings) {
        const urlNorm = normalizeUrl(item.jobUrl);
        const existing = sql
          .exec<{ id: string }>(`SELECT id FROM postings WHERE url_norm = ? LIMIT 1`, urlNorm)
          .toArray()[0];

        const postingId = existing?.id ?? crypto.randomUUID();
        const extractedJson = item.extracted ? JSON.stringify(item.extracted) : null;

        if (existing) {
          sql.exec(
            `UPDATE postings
						 SET title = ?, employer = ?, location = ?, salary = ?,
						     date_posted = ?, description = ?, extracted_json = COALESCE(?, extracted_json),
						     last_seen_at = ?
						 WHERE id = ?`,
            item.title,
            item.employer,
            item.location ?? null,
            item.salary ?? null,
            item.datePosted ?? null,
            item.description ?? null,
            extractedJson,
            now,
            postingId,
          );
        } else {
          sql.exec(
            `INSERT INTO postings (
							id, source, url_norm, job_url, title, employer,
							location, salary, date_posted, description,
							extracted_json, first_seen_at, last_seen_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            postingId,
            task.source,
            urlNorm,
            item.jobUrl,
            item.title,
            item.employer,
            item.location ?? null,
            item.salary ?? null,
            item.datePosted ?? null,
            item.description ?? null,
            extractedJson,
            now,
            now,
          );
        }

        postingsForNotification.push({
          postingId,
          jobUrl: item.jobUrl,
          title: item.title,
          employer: item.employer,
          location: item.location ?? null,
          salary: item.salary ?? null,
          datePosted: item.datePosted ?? null,
          description: item.description ?? null,
          extractedJson,
        });
      }
    });

    let r2Key: string | null = null;
    if (this.env.DATA_BUCKET) {
      r2Key = `scrape-results/${task.id}.json`;
      await this.env.DATA_BUCKET.put(
        r2Key,
        JSON.stringify({
          taskId: task.id,
          source: task.source,
          target: task.target,
          completedAt: now,
          meta: input.meta ?? {},
          postings: postingsForNotification,
        }),
        { httpMetadata: { contentType: "application/json" } },
      );
    }

    sql.exec(
      `UPDATE scrape_tasks
			 SET status = 'completed',
			     completed_at = ?,
			     updated_at = ?,
			     lease_owner = NULL,
			     lease_expires_at = NULL,
			     last_error = NULL,
			     result_r2_key = ?,
			     result_count = ?
			 WHERE id = ?`,
      now,
      now,
      r2Key,
      postingsForNotification.length,
      task.id,
    );

    sql.exec(
      `UPDATE source_state
			 SET active_count = MAX(0, active_count - 1),
			     consecutive_rate_limits = 0,
			     updated_at = ?
			 WHERE source = ?`,
      now,
      task.source,
    );

    const notifiedCount = await this.notifySubscribers(task, postingsForNotification, "completed");

    return {
      taskId: task.id,
      postingsCount: postingsForNotification.length,
      r2Key,
      notifiedCount,
    };
  }

  async recordRateLimitHit(
    taskId: string,
    source: string,
    statusCode: number,
  ): Promise<{ cooldownUntil: number; backoffMs: number }> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const state = sql
      .exec<SourceStateRow>(`SELECT * FROM source_state WHERE source = ? LIMIT 1`, source)
      .toArray()[0];

    const hits = (state?.consecutive_rate_limits ?? 0) + 1;
    const backoffMs = Math.min(COOLDOWN_MAX_MS, COOLDOWN_MIN_MS * 2 ** (hits - 1));
    const cooldownUntil = now + backoffMs;

    sql.exec(
      `INSERT INTO source_state (
				source, active_count, cooldown_until, consecutive_rate_limits, updated_at
			) VALUES (?, 0, ?, ?, ?)
			ON CONFLICT(source) DO UPDATE SET
				active_count = MAX(0, source_state.active_count - 1),
				cooldown_until = excluded.cooldown_until,
				consecutive_rate_limits = excluded.consecutive_rate_limits,
				updated_at = excluded.updated_at`,
      source,
      cooldownUntil,
      hits,
      now,
    );

    // Re-queue without consuming attempts.
    sql.exec(
      `UPDATE scrape_tasks
			 SET status = 'pending',
			     attempts = MAX(0, attempts - 1),
			     lease_owner = NULL,
			     lease_expires_at = NULL,
			     next_retry_at = ?,
			     last_error = ?,
			     updated_at = ?
			 WHERE id = ?`,
      cooldownUntil,
      `HTTP ${statusCode} rate limit; cooling down until ${new Date(cooldownUntil).toISOString()}`,
      now,
      taskId,
    );

    await this.scheduleDispatcherAlarm();
    return { cooldownUntil, backoffMs };
  }

  async markTaskNeedsAttention(taskId: string, reason: string): Promise<void> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const task = sql
      .exec<ScrapeTaskRow>(`SELECT * FROM scrape_tasks WHERE id = ? LIMIT 1`, taskId)
      .toArray()[0];
    if (!task) return;

    sql.exec(
      `UPDATE scrape_tasks
			 SET status = 'needs_attention',
			     lease_owner = NULL,
			     lease_expires_at = NULL,
			     last_error = ?,
			     updated_at = ?
			 WHERE id = ?`,
      reason,
      now,
      taskId,
    );

    sql.exec(
      `UPDATE source_state
			 SET active_count = MAX(0, active_count - 1),
			     updated_at = ?
			 WHERE source = ?`,
      now,
      task.source,
    );
  }

  private async notifySubscribersFromArchive(
    task: ScrapeTaskRow,
    outcome: "completed" | "failed" | "cached",
  ): Promise<number> {
    let postings: OnTaskDonePosting[] = [];
    if (task.result_r2_key && this.env.DATA_BUCKET) {
      const obj = await this.env.DATA_BUCKET.get(task.result_r2_key);
      if (obj) {
        const parsed = (await obj.json()) as {
          postings?: OnTaskDonePosting[];
        };
        postings = parsed.postings ?? [];
      }
    }
    return this.notifySubscribers(task, postings, outcome);
  }

  private async notifySubscribers(
    task: ScrapeTaskRow,
    postings: OnTaskDonePosting[],
    outcome: "completed" | "failed" | "cached",
  ): Promise<number> {
    const sql = this.ctx.storage.sql;
    const subscribers = sql
      .exec<SubscriberRow>(
        `SELECT * FROM task_subscribers
				 WHERE task_id = ? AND notified_at IS NULL`,
        task.id,
      )
      .toArray();

    if (subscribers.length === 0) return 0;

    const appStore = this.env.APP_STORE?.getByName("primary");
    let notified = 0;
    const now = Date.now();

    for (const sub of subscribers) {
      try {
        if (appStore) {
          await appStore.onTaskDone({
            taskId: task.id,
            tenantId: sub.tenant_id,
            userId: sub.user_id,
            pipelineRunId: sub.pipeline_run_id,
            source: task.source,
            outcome,
            postings: outcome === "failed" ? [] : postings,
          });
        }
        sql.exec(`UPDATE task_subscribers SET notified_at = ? WHERE id = ?`, now, sub.id);
        notified++;
      } catch (error) {
        console.error(`Failed to notify subscriber ${sub.id} for task ${task.id}:`, error);
      }
    }

    return notified;
  }

  async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();

    // 1. Reclaim expired leases; fail tasks that reached max_attempts.
    const expiredTasks = sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks
				 WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
        now,
      )
      .toArray();

    for (const task of expiredTasks) {
      sql.exec(
        `UPDATE source_state
				 SET active_count = MAX(0, active_count - 1),
				     updated_at = ?
				 WHERE source = ?`,
        now,
        task.source,
      );

      if (task.attempts >= task.max_attempts) {
        sql.exec(
          `UPDATE scrape_tasks
					 SET status = 'failed',
					     lease_owner = NULL,
					     lease_expires_at = NULL,
					     last_error = COALESCE(last_error, 'Lease expired after max attempts'),
					     updated_at = ?
					 WHERE id = ?`,
          now,
          task.id,
        );
        await this.notifySubscribers(task, [], "failed");
      } else {
        sql.exec(
          `UPDATE scrape_tasks
					 SET status = 'pending',
					     lease_owner = NULL,
					     lease_expires_at = NULL,
					     next_retry_at = ?,
					     updated_at = ?
					 WHERE id = ?`,
          now + DISPATCH_INTERVAL_MS,
          now,
          task.id,
        );
      }
    }

    // 2. 30-day retention cleanup for unseen postings.
    sql.exec(`DELETE FROM postings WHERE last_seen_at < ?`, now - RETENTION_MS);

    // 3. Dispatch eligible pending tasks respecting per-site rate limits.
    const pendingTasks = sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks
				 WHERE status = 'pending'
				   AND (next_retry_at IS NULL OR next_retry_at <= ?)
				 ORDER BY created_at ASC
				 LIMIT 25`,
        now,
      )
      .toArray();

    const dayWindowStart = Math.floor(now / ROLLING_WINDOW_MS) * ROLLING_WINDOW_MS;

    for (const task of pendingTasks) {
      const state = sql
        .exec<SourceStateRow>(`SELECT * FROM source_state WHERE source = ? LIMIT 1`, task.source)
        .toArray()[0];

      const maxConcurrent = state?.max_concurrent ?? DEFAULT_MAX_CONCURRENT;
      const minIntervalMs = state?.min_interval_ms ?? DEFAULT_MIN_INTERVAL_MS;
      const activeCount = state?.active_count ?? 0;
      const lastDispatchedAt = state?.last_dispatched_at ?? 0;
      const cooldownUntil = state?.cooldown_until ?? 0;
      const dailyCount =
        state?.daily_window_start === dayWindowStart ? (state?.daily_count ?? 0) : 0;

      if (cooldownUntil > now) continue;
      if (activeCount >= maxConcurrent) continue;
      if (now - lastDispatchedAt < minIntervalMs) continue;
      if (state?.daily_cap && dailyCount >= state.daily_cap) continue;

      const leaseOwner = `dispatcher-${task.runtime}-${now}`;
      const leaseExpiresAt = now + LEASE_DURATION_MS;

      sql.exec(
        `UPDATE scrape_tasks
				 SET status = 'running',
				     attempts = attempts + 1,
				     lease_owner = ?,
				     lease_expires_at = ?,
				     updated_at = ?
				 WHERE id = ? AND status = 'pending'`,
        leaseOwner,
        leaseExpiresAt,
        now,
        task.id,
      );

      sql.exec(
        `INSERT INTO source_state (
					source, active_count, last_dispatched_at,
					daily_count, daily_window_start, updated_at
				) VALUES (?, 1, ?, 1, ?, ?)
				ON CONFLICT(source) DO UPDATE SET
					active_count = source_state.active_count + 1,
					last_dispatched_at = excluded.last_dispatched_at,
					daily_count = CASE
						WHEN source_state.daily_window_start = excluded.daily_window_start
						THEN source_state.daily_count + 1
						ELSE 1
					END,
					daily_window_start = excluded.daily_window_start,
					updated_at = excluded.updated_at`,
        task.source,
        now,
        dayWindowStart,
        now,
      );

      this.ctx.waitUntil(
        this.dispatchTask(task).catch((error: unknown) => {
          console.error(`Scrape dispatch failed for task ${task.id}:`, error);
        }),
      );
    }

    // 4. Reschedule 30s alarm if any active or pending work remains.
    const remaining = sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) as n FROM scrape_tasks WHERE status IN ('pending', 'running')`,
      )
      .toArray()[0];

    if ((remaining?.n ?? 0) > 0) {
      await this.ctx.storage.setAlarm(Date.now() + DISPATCH_INTERVAL_MS);
    }
  }

  private async dispatchTask(task: ScrapeTaskRow): Promise<void> {
    const runtime = (task.runtime || "worker") as ScrapeRuntime;
    const payload = {
      taskId: task.id,
      source: task.source,
      target: task.target,
      title: task.title,
      location: task.location,
      params: task.params_json ? JSON.parse(task.params_json) : {},
    };

    if (runtime === "worker") {
      await this.dispatchWorkerScrape(task, payload);
      return;
    }

    if (runtime === "browser") {
      await this.dispatchBrowserScrape(task, payload);
      return;
    }

    await this.dispatchContainerScrape(task, payload);
  }

  private buildScrapeHeaders(): Record<string, string> {
    const secret = (this.env.INTERNAL_SYNC_SECRET || this.env.CRON_SECRET)?.trim();
    return {
      "content-type": "application/json",
      ...(secret ? { "x-internal-sync-secret": secret } : {}),
    };
  }

  private async handleScrapeResponse(task: ScrapeTaskRow, resp: Response): Promise<void> {
    if (resp.status === 429 || resp.status === 403) {
      await this.recordRateLimitHit(task.id, task.source, resp.status);
      await resp.body?.cancel();
      return;
    }
    if (!resp.ok) {
      await resp.body?.cancel();
      return;
    }
    const body = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      data?: { postings?: ScrapePostingInput[] };
    } | null;
    if (body?.ok && Array.isArray(body.data?.postings)) {
      await this.completeTask({
        taskId: task.id,
        postings: body.data.postings,
      });
    }
  }

  private async dispatchWorkerScrape(
    task: ScrapeTaskRow,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.dispatchContainerScrape(task, {
      ...payload,
      runtime: "worker",
    });
  }

  private async dispatchBrowserScrape(
    task: ScrapeTaskRow,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Browser Rendering needs an HTML-to-postings extraction contract first.
    await this.dispatchContainerScrape(task, {
      ...payload,
      runtime: "browser-fallback",
    });
  }

  private async dispatchContainerScrape(
    task: ScrapeTaskRow,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.env.SCRAPER_CONTAINER) {
      return;
    }
    const poolSize = getPoolSize(this.env);
    const idx = this.poolCursor % poolSize;
    this.poolCursor = (this.poolCursor + 1) % poolSize;
    const poolName = `scraper-${idx}`;

    const scraper = this.env.SCRAPER_CONTAINER.getByName(poolName);

    const resp = await scraper.fetch("http://scraper/scrape", {
      method: "POST",
      headers: this.buildScrapeHeaders(),
      body: JSON.stringify({ ...payload, poolWorker: poolName }),
    });
    await this.handleScrapeResponse(task, resp);
  }
}

const CONTAINER_START_TIMEOUT_MS = 120_000;

/**
 * The PDF renderer must cold-start the Node server and run Typst, which the default "lite" size
 * (1/16 vCPU, 256 MiB) cannot do in time ("container is not listening"). Scrapers ran fine on the
 * default size, and memory is billed for the whole time a container is up, so only the renderer
 * gets the larger size. Durable Object-managed containers take the size here, not in wrangler.jsonc.
 */
function instanceForRequest(request: Request): "standard-1" | undefined {
  return new URL(request.url).pathname.startsWith("/internal/render-pdf")
    ? "standard-1"
    : undefined;
}

export class ScraperContainer extends DurableObject<Env> {
  /** Polls /health until the Node server inside the container accepts connections. */
  private async waitForContainerReady(port: number): Promise<boolean> {
    const container = this.ctx.container;
    if (!container) return false;
    const tcp = container.getTcpPort(port);
    const startedAt = Date.now();
    const deadline = startedAt + CONTAINER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // A container that exited during boot will never listen; stop waiting and report it.
      // The short grace period covers `running` lagging behind a just-issued start().
      if (!container.running && Date.now() - startedAt > 5_000) return false;
      try {
        const probe = await tcp.fetch("http://container/health", {
          signal: AbortSignal.timeout(2000),
        });
        await probe.body?.cancel();
        if (probe.ok) return true;
      } catch {
        // Waiting for scraper container startup
      }
      await sleep(500);
    }
    return false;
  }

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "ScraperContainer runtime is not bound.",
          },
        },
        { status: 503 },
      );
    }

    const portNumber = Number.parseInt(this.env.PORT ?? "", 10) || 3001;
    if (!container.running) {
      const instance = instanceForRequest(request);
      container.start({
        image: container.images.base,
        enableInternet: true,
        ...(instance ? { instance } : {}),
        env: {
          NODE_ENV: this.env.NODE_ENV ?? "production",
          PORT: String(portNumber),
          ...(this.env.INTERNAL_SYNC_SECRET
            ? { INTERNAL_SYNC_SECRET: this.env.INTERNAL_SYNC_SECRET }
            : {}),
        },
      });
      await container.setInactivityTimeout(5 * 60_000);
    }

    // Always confirm readiness: a container that is running but still booting (or was just
    // restarted) is not listening yet, and forwarding to it fails with a raw TCP error.
    if (!(await this.waitForContainerReady(portNumber))) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "The worker container did not finish starting. Try again in a moment.",
          },
        },
        { status: 503, headers: { "retry-after": "10" } },
      );
    }

    const targetUrl = new URL(request.url);
    targetUrl.protocol = "http:";
    targetUrl.host = "container";

    return container.getTcpPort(portNumber).fetch(
      new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      }),
    );
  }
}
