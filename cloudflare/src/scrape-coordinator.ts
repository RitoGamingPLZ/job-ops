import { DurableObject } from "cloudflare:workers";
import type {
  CareersCrawlRequest,
  CareersCrawlStatus,
  CareersScanRequest,
  CareersScanStatus,
} from "../../orchestrator/src/server/watchlist/careers-site/scan-task";
import type { OnTaskDonePosting } from "./app-store";
import type { Env } from "./types";
import { jsonError, resolveInternalContainerSecret, sleep } from "./utils";

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
const CAREERS_SCAN_SOURCE_PREFIX = "careers-scan:";
const CAREERS_CRAWL_SOURCE_PREFIX = "careers-crawl:";
const MAX_ACTIVE_CAREERS_SCANS = 2;
const MAX_ACTIVE_CAREERS_CRAWLS = 4;
const CAREERS_RESULT_FRESHNESS_MS = 5 * 60_000;

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
			CREATE INDEX IF NOT EXISTS idx_scrape_tasks_source_target_created
				ON scrape_tasks (source, target, created_at DESC);

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

    return jsonError(request, "NOT_FOUND", `Unknown ScrapeCoordinator route: ${url.pathname}`, {
      status: 404,
    });
  }

  async enqueueCareersScan(input: CareersScanRequest): Promise<CareersScanStatus> {
    const url = new URL(input.careersUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      throw new Error("Invalid careers listing URL");
    }
    url.search = "";
    url.hash = "";
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const status = await this.careersScanStatus(url.href);
    if (status?.state === "queued") {
      await this.scheduleDispatcherAlarm();
      return status;
    }
    if (status?.state === "finished") {
      const cooldown =
        !input.repair && (status.outcome.outcome === "none" || status.outcome.outcome === "found")
          ? 6 * 60 * 60_000
          : status.outcome.outcome === "failed"
            ? 30 * 60_000
            : 0;
      if (now - status.finishedAt < cooldown) return status;
    }
    // Recheck after the status lookup so concurrent callers cannot create duplicate active work.
    const source = CAREERS_SCAN_SOURCE_PREFIX + url.hostname;
    const id = crypto.randomUUID();
    sql.exec(
      `INSERT INTO scrape_tasks (
         id, scrape_key, source, target, runtime, params_json, status,
         window_start, attempts, max_attempts, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, 'container', ?, 'pending', ?, 0, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM scrape_tasks
         WHERE source = ? AND target = ? AND status IN ('pending', 'running')
       )`,
      id,
      id,
      source,
      url.href,
      JSON.stringify({
        tenantId: input.tenantId,
        userId: input.userId,
        requestId: input.requestId,
        pipelineRunId: input.pipelineRunId,
      }),
      now,
      DEFAULT_MAX_ATTEMPTS,
      now,
      now,
      source,
      url.href,
    );
    await this.scheduleDispatcherAlarm();
    return (await this.careersScanStatus(url.href)) ?? { state: "queued" };
  }

  async careersScanStatus(value: string): Promise<CareersScanStatus | null> {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    const task = this.ctx.storage.sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks WHERE source = ? AND target = ?
       ORDER BY created_at DESC LIMIT 1`,
        CAREERS_SCAN_SOURCE_PREFIX + url.hostname,
        url.href,
      )
      .toArray()[0];
    if (!task) return null;
    if (task.status === "running" || task.status === "pending")
      return { state: "queued", taskId: task.id };
    const outcome =
      task.last_error === "found" ||
      task.last_error === "none" ||
      task.last_error === "blocked" ||
      task.last_error === "unavailable"
        ? task.last_error
        : "failed";
    return { state: "finished", outcome: { outcome }, finishedAt: task.updated_at };
  }

  async enqueueCareersCrawl(input: CareersCrawlRequest): Promise<CareersCrawlStatus> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const source = CAREERS_CRAWL_SOURCE_PREFIX + input.host;
    const task = sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks WHERE source = ? AND scrape_key = ?
       ORDER BY created_at DESC LIMIT 1`,
        source,
        input.key,
      )
      .toArray()[0];
    if (task?.status === "running" || task?.status === "pending") {
      await this.scheduleDispatcherAlarm();
      return { state: "queued" };
    }
    if (task && now - task.updated_at < CAREERS_RESULT_FRESHNESS_MS) {
      return {
        state: "finished",
        result:
          task.status === "completed" && task.params_json
            ? JSON.parse(task.params_json)
            : { kind: "failed" },
      };
    }
    sql.exec(
      `INSERT INTO scrape_tasks (
        id, scrape_key, source, target, title, runtime, params_json, status,
        window_start, attempts, max_attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'container', ?, 'pending', ?, 0, ?, ?, ?)`,
      crypto.randomUUID(),
      input.key,
      source,
      input.host,
      input.scanTaskId ?? null,
      JSON.stringify({ payload: input.payload, requestId: input.requestId }),
      now,
      DEFAULT_MAX_ATTEMPTS,
      now,
      now,
    );
    await this.scheduleDispatcherAlarm();
    return { state: "queued" };
  }

  async readCareersCrawl(key: string, host: string): Promise<unknown> {
    const row = this.ctx.storage.sql
      .exec<{ params_json: string | null }>(
        `SELECT params_json FROM scrape_tasks WHERE source = ? AND scrape_key = ?
       AND status = 'completed' AND params_json IS NOT NULL ORDER BY completed_at DESC LIMIT 5`,
        CAREERS_CRAWL_SOURCE_PREFIX + host,
        key,
      )
      .toArray()
      .find((item) => JSON.parse(item.params_json ?? "null")?.kind === "jobs");
    return row?.params_json ? JSON.parse(row.params_json) : null;
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
    sql.exec(
      `DELETE FROM scrape_tasks WHERE (source LIKE ? OR source LIKE ?) AND updated_at < ?
       AND status IN ('completed', 'failed')`,
      `${CAREERS_SCAN_SOURCE_PREFIX}%`,
      `${CAREERS_CRAWL_SOURCE_PREFIX}%`,
      now - RETENTION_MS,
    );

    // 3. Dispatch eligible pending tasks respecting per-site rate limits.
    const pendingTasks = sql
      .exec<ScrapeTaskRow>(
        `SELECT * FROM scrape_tasks
				 WHERE status = 'pending'
                   AND source NOT LIKE ? AND source NOT LIKE ?
				   AND (next_retry_at IS NULL OR next_retry_at <= ?)
				 ORDER BY created_at ASC
				 LIMIT 25`,
        `${CAREERS_SCAN_SOURCE_PREFIX}%`,
        `${CAREERS_CRAWL_SOURCE_PREFIX}%`,
        now,
      )
      .toArray();
    pendingTasks.push(
      ...sql
        .exec<ScrapeTaskRow>(
          `SELECT * FROM scrape_tasks WHERE status = 'pending' AND source LIKE ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC LIMIT 25`,
          `${CAREERS_SCAN_SOURCE_PREFIX}%`,
          now,
        )
        .toArray(),
    );
    pendingTasks.push(
      ...sql
        .exec<ScrapeTaskRow>(
          `SELECT * FROM scrape_tasks WHERE status = 'pending' AND source LIKE ?
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC LIMIT 25`,
          `${CAREERS_CRAWL_SOURCE_PREFIX}%`,
          now,
        )
        .toArray(),
    );

    const dayWindowStart = Math.floor(now / ROLLING_WINDOW_MS) * ROLLING_WINDOW_MS;

    for (const task of pendingTasks) {
      const scan = task.source.startsWith(CAREERS_SCAN_SOURCE_PREFIX);
      const crawl = task.source.startsWith(CAREERS_CRAWL_SOURCE_PREFIX);
      if (crawl && task.title) {
        const dependency = sql
          .exec<{ status: string }>(
            "SELECT status FROM scrape_tasks WHERE id = ? AND source LIKE ?",
            task.title,
            `${CAREERS_SCAN_SOURCE_PREFIX}%`,
          )
          .toArray()[0];
        if (dependency?.status === "pending" || dependency?.status === "running") continue;
        if (dependency?.status !== "completed") {
          sql.exec(
            "UPDATE scrape_tasks SET status = 'failed', last_error = 'Scan failed', params_json = NULL, updated_at = ? WHERE id = ?",
            now,
            task.id,
          );
          continue;
        }
      }
      if (scan || crawl) {
        const prefix = scan ? CAREERS_SCAN_SOURCE_PREFIX : CAREERS_CRAWL_SOURCE_PREFIX;
        const otherPrefix = scan ? CAREERS_CRAWL_SOURCE_PREFIX : CAREERS_SCAN_SOURCE_PREFIX;
        const otherSource = otherPrefix + task.source.slice(prefix.length);
        const { n } = sql
          .exec<{ n: number }>(
            "SELECT COUNT(*) as n FROM scrape_tasks WHERE status = 'running' AND source LIKE ?",
            `${prefix}%`,
          )
          .one();
        if (n >= (scan ? MAX_ACTIVE_CAREERS_SCANS : MAX_ACTIVE_CAREERS_CRAWLS)) continue;
        const otherActive = sql
          .exec<{ id: string }>(
            "SELECT id FROM scrape_tasks WHERE source = ? AND status = 'running' LIMIT 1",
            otherSource,
          )
          .toArray()[0];
        if (otherActive) continue;
      }
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
        this.dispatchTask({ ...task, lease_owner: leaseOwner }).catch((error: unknown) => {
          console.error(
            `Scrape dispatch failed for task ${task.id}:`,
            scan || crawl ? "Careers task RPC failed" : error,
          );
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
    if (task.source.startsWith(CAREERS_SCAN_SOURCE_PREFIX)) {
      await this.dispatchCareersScan(task);
      return;
    }
    if (task.source.startsWith(CAREERS_CRAWL_SOURCE_PREFIX)) {
      await this.dispatchCareersCrawl(task);
      return;
    }
    const runtime = (task.runtime || "worker") as ScrapeRuntime;
    const payload = {
      taskId: task.id,
      source: task.source,
      target: task.target,
      title: task.title,
      location: task.location,
      params: task.params_json ? JSON.parse(task.params_json) : {},
    };

    // Worker and browser tasks currently run through the scraper container.
    if (runtime === "worker" || runtime === "browser") {
      await this.dispatchContainerScrape(task, {
        ...payload,
        runtime: runtime === "browser" ? "browser-fallback" : runtime,
      });
    } else {
      await this.dispatchContainerScrape(task, payload);
    }
  }

  private async dispatchCareersCrawl(task: ScrapeTaskRow): Promise<void> {
    const appStore = this.env.APP_STORE?.getByName("primary");
    if (!appStore || !task.params_json) return;
    const input = JSON.parse(task.params_json) as Pick<
      CareersCrawlRequest,
      "payload" | "requestId"
    >;
    const result = await appStore.executeCareersCrawl({ ...input, host: task.target });
    const retry = result.kind === "unavailable" && task.attempts + 1 < task.max_attempts;
    const now = Date.now();
    const serialized = JSON.stringify(result);
    const payload =
      new TextEncoder().encode(serialized).byteLength < 1_500_000
        ? serialized
        : JSON.stringify({ kind: "failed" });
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const updated = sql
        .exec<{ id: string }>(
          `UPDATE scrape_tasks SET status = ?, updated_at = ?, completed_at = ?,
           lease_owner = NULL, lease_expires_at = NULL, params_json = ?, next_retry_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ? RETURNING id`,
          retry ? "pending" : "completed",
          now,
          retry ? null : now,
          retry ? task.params_json : payload,
          retry ? now + DISPATCH_INTERVAL_MS : null,
          task.id,
          task.lease_owner,
        )
        .toArray()[0];
      if (updated)
        sql.exec(
          "UPDATE source_state SET active_count = MAX(0, active_count - 1), updated_at = ? WHERE source = ?",
          now,
          task.source,
        );
    });
  }

  private async dispatchCareersScan(task: ScrapeTaskRow): Promise<void> {
    const appStore = this.env.APP_STORE?.getByName("primary");
    if (!appStore || !task.params_json) return;
    const context = JSON.parse(task.params_json) as Omit<CareersScanRequest, "careersUrl">;
    const { outcome } = await appStore.executeCareersScan({ ...context, careersUrl: task.target });
    const now = Date.now();
    const retry = outcome === "unavailable" && task.attempts + 1 < task.max_attempts;
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const updated = sql
        .exec<{ id: string }>(
          `UPDATE scrape_tasks SET status = ?, last_error = ?, updated_at = ?, completed_at = ?,
           lease_owner = NULL, lease_expires_at = NULL, params_json = ?, next_retry_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ? RETURNING id`,
          retry ? "pending" : outcome === "found" || outcome === "none" ? "completed" : "failed",
          outcome,
          now,
          retry ? null : now,
          retry ? task.params_json : null,
          retry ? now + DISPATCH_INTERVAL_MS : null,
          task.id,
          task.lease_owner,
        )
        .toArray()[0];
      if (updated)
        sql.exec(
          "UPDATE source_state SET active_count = MAX(0, active_count - 1), updated_at = ? WHERE source = ?",
          now,
          task.source,
        );
    });
  }

  private buildScrapeHeaders(): Record<string, string> {
    const secret = resolveInternalContainerSecret(this.env);
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
const CONTAINER_EXIT_GRACE_MS = 1_000;
const CONTAINER_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const CONTAINER_READY_POLL_MS = 200;
const CONTAINER_READY_PROBE_TIMEOUT_MS = 1_500;
const PDF_WORKER_ENTRYPOINT = ["node", "/app/orchestrator/dist/pdf-worker/pdf-worker.mjs"];
const CAREERS_WORKER_ENTRYPOINT = [
  "node",
  "/app/orchestrator/dist/careers-worker/careers-worker.mjs",
];

/**
 * PDF rendering runs in a dedicated lightweight worker entrypoint on "standard-1" (1/2 vCPU,
 * 4 GiB) so cold starts skip migrations/extractors and Typst has headroom. Scrapers stay on the
 * default size to avoid multiplying idle memory cost across the scraper pool.
 */
function isPdfRenderRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/internal/render-pdf");
}

/**
 * Careers-site learning and crawling run on their own named container (not the scraper pool), so
 * a larger size here is paid only while someone is scanning a site. The full server idles near
 * 650 MiB and a learn on a large page reaches about 1 GiB, which the default size cannot hold.
 */
function isCareersSiteRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/internal/careers-site/");
}

export class ScraperContainer extends DurableObject<Env> {
  private containerReady = false;
  private readyPromise: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx?.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(CONTAINER_INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  /** Polls /health until the Node server inside the container accepts connections. */
  private async waitForContainerReady(port: number): Promise<boolean> {
    const container = this.ctx.container;
    if (!container) return false;
    const tcp = container.getTcpPort(port);
    const startedAt = Date.now();
    const deadline = startedAt + CONTAINER_START_TIMEOUT_MS;
    let sawRunning = false;
    while (Date.now() < deadline) {
      if (container.running) {
        sawRunning = true;
      } else if (sawRunning) {
        // It was running and then exited during boot: it will never listen, so fail fast.
        if (Date.now() - startedAt > CONTAINER_EXIT_GRACE_MS) return false;
      }
      // Before the first `running`, the platform is still placing the container and pulling
      // the image (slow right after a deploy). Keep waiting until the overall deadline rather
      // than reporting "did not finish starting" for a container that has not been scheduled.
      try {
        const probe = await tcp.fetch("http://container/health", {
          signal: AbortSignal.timeout(CONTAINER_READY_PROBE_TIMEOUT_MS),
        });
        await probe.body?.cancel();
        if (probe.ok) return true;
      } catch {
        // Waiting for scraper container startup
      }
      await sleep(CONTAINER_READY_POLL_MS);
    }
    return false;
  }

  private async ensureContainerReady(port: number): Promise<boolean> {
    if (this.containerReady) return true;
    if (!this.readyPromise) {
      this.readyPromise = this.waitForContainerReady(port)
        .then((ready) => {
          this.containerReady = ready;
          return ready;
        })
        .finally(() => {
          this.readyPromise = null;
        });
    }
    return this.readyPromise;
  }

  async fetch(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) {
      return jsonError(request, "SERVICE_UNAVAILABLE", "ScraperContainer runtime is not bound.", {
        status: 503,
      });
    }

    const portNumber = Number.parseInt(this.env.PORT ?? "", 10) || 3001;
    const startedAt = Date.now();
    const coldStart = !container.running;
    if (!container.running) {
      this.containerReady = false;
      const internalSecret = resolveInternalContainerSecret(this.env);
      const pdfRender = isPdfRenderRequest(request);
      container.start({
        image: container.images.base,
        enableInternet: true,
        ...(pdfRender
          ? { instance: "standard-1", entrypoint: PDF_WORKER_ENTRYPOINT }
          : isCareersSiteRequest(request)
            ? { instance: "standard-1", entrypoint: CAREERS_WORKER_ENTRYPOINT }
            : {}),
        env: {
          NODE_ENV: this.env.NODE_ENV ?? "production",
          PORT: String(portNumber),
          ...(internalSecret ? { INTERNAL_SYNC_SECRET: internalSecret } : {}),
        },
      });
      await container.setInactivityTimeout(CONTAINER_INACTIVITY_TIMEOUT_MS);
    }

    // Confirm readiness on cold start or after an unexpected container exit without probing
    // /health on every warm request.
    if (!(await this.ensureContainerReady(portNumber))) {
      return jsonError(
        request,
        "SERVICE_UNAVAILABLE",
        "The worker container did not finish starting. Try again in a moment.",
        { status: 503, headers: { "retry-after": "10" } },
      );
    }

    const readyAt = Date.now();

    const targetUrl = new URL(request.url);
    targetUrl.protocol = "http:";
    targetUrl.host = "container";

    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    try {
      const response = await container.getTcpPort(portNumber).fetch(
        new Request(targetUrl, {
          method: request.method,
          headers: request.headers,
          body: hasBody ? request.body : undefined,
          redirect: "manual",
          ...(hasBody ? { duplex: "half" } : {}),
        } as RequestInit),
      );
      // Splits a slow first render into "container not up yet" and "render itself".
      if (isPdfRenderRequest(request)) {
        console.log(
          JSON.stringify({
            msg: "pdf-container-timing",
            path: targetUrl.pathname,
            coldStart,
            readyMs: readyAt - startedAt,
            forwardMs: Date.now() - readyAt,
            status: response.status,
          }),
        );
      }
      return response;
    } catch (error) {
      this.containerReady = false;
      throw error;
    }
  }
}
