import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@server/db/index";
import {
  jobs,
  pipelineRuns,
  postings,
  scrapeTasks,
  sourceState,
  taskSubscribers,
} from "@server/db/schema";
import type { ExtractorRateLimit, ExtractorRuntime } from "@shared/types";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_INTERVAL_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 1;
const BASE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;

const DEFAULT_RUNTIME_LIMITS: Record<ExtractorRuntime, number> = {
  worker: 10,
  browser: 4,
  container: 2,
};

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
]);

function normalizeKeyPart(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Builds a canonical scrape key from source, target, title, and location.
 */
export function buildScrapeKey(input: {
  source: string;
  target?: string | null;
  title: string;
  location?: string | null;
}): string {
  return [
    normalizeKeyPart(input.source),
    normalizeKeyPart(input.target),
    normalizeKeyPart(input.title),
    normalizeKeyPart(input.location),
  ].join("|");
}

/**
 * Normalizes a posting URL for deduplication across scrapes.
 */
export function normalizePostingUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

export interface EnsureTaskInput {
  source: string;
  target?: string;
  title: string;
  location?: string;
  runtime?: ExtractorRuntime;
  tenantId: string;
  runId: string;
  now?: Date;
}

export type EnsureTaskResult =
  | { status: "cached"; taskId: string; postingIds: string[] }
  | { status: "waiting"; taskId: string }
  | { status: "created"; taskId: string };

/**
 * Ensures a scrape task exists for the given key, reusing a 24h rolling completed
 * task or attaching the caller as a subscriber to an active/new task.
 * Callers must dedupe by buildScrapeKey within each run before setting tasksTotal.
 */
export function ensureTask(
  db: AppDatabase,
  input: EnsureTaskInput,
): EnsureTaskResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - DAY_MS).toISOString();
  const targetNorm = normalizeKeyPart(input.target);
  const titleNorm = normalizeKeyPart(input.title);
  const locationNorm = normalizeKeyPart(input.location);
  const scrapeKey = buildScrapeKey({
    source: input.source,
    target: targetNorm,
    title: titleNorm,
    location: locationNorm,
  });

  return db.transaction((tx) => {
    const recentDone = tx
      .select()
      .from(scrapeTasks)
      .where(
        and(
          eq(scrapeTasks.scrapeKey, scrapeKey),
          eq(scrapeTasks.status, "done"),
        ),
      )
      .orderBy(desc(scrapeTasks.completedAt))
      .limit(1)
      .get();

    if (recentDone?.completedAt && recentDone.completedAt >= cutoffIso) {
      return {
        status: "cached",
        taskId: recentDone.id,
        postingIds: recentDone.postingIds ?? [],
      };
    }

    const activeTask = tx
      .select()
      .from(scrapeTasks)
      .where(
        and(
          eq(scrapeTasks.scrapeKey, scrapeKey),
          inArray(scrapeTasks.status, ["pending", "running"]),
        ),
      )
      .limit(1)
      .get();

    if (activeTask) {
      tx.insert(taskSubscribers)
        .values({
          taskId: activeTask.id,
          tenantId: input.tenantId,
          runId: input.runId,
          createdAt: nowIso,
        })
        .onConflictDoNothing()
        .run();

      return { status: "waiting", taskId: activeTask.id };
    }

    let windowStartMs = now.getTime();
    let windowStart = new Date(windowStartMs).toISOString();
    while (
      tx
        .select({ id: scrapeTasks.id })
        .from(scrapeTasks)
        .where(
          and(
            eq(scrapeTasks.scrapeKey, scrapeKey),
            eq(scrapeTasks.windowStart, windowStart),
          ),
        )
        .get()
    ) {
      windowStartMs += 1;
      windowStart = new Date(windowStartMs).toISOString();
    }

    const taskId = randomUUID();
    tx.insert(scrapeTasks)
      .values({
        id: taskId,
        scrapeKey,
        windowStart,
        source: normalizeKeyPart(input.source),
        runtime: input.runtime ?? "container",
        target: targetNorm,
        titleNorm,
        location: locationNorm,
        status: "pending",
        attempts: 0,
        postingsFound: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();

    tx.insert(taskSubscribers)
      .values({
        taskId,
        tenantId: input.tenantId,
        runId: input.runId,
        createdAt: nowIso,
      })
      .run();

    return { status: "created", taskId };
  });
}

export interface DispatchPendingTasksOptions {
  now?: Date;
  leaseDurationMs?: number;
  maxAttempts?: number;
  runtimeLimits?: Partial<Record<ExtractorRuntime, number>>;
  rateLimits?: Record<string, ExtractorRateLimit | undefined>;
}

export interface DispatchPendingTasksResult {
  expiredCount: number;
  failedCount: number;
  leasedTasks: Array<typeof scrapeTasks.$inferSelect>;
}

function decrementSourceInFlight(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  source: string,
): void {
  const state = tx
    .select()
    .from(sourceState)
    .where(eq(sourceState.source, source))
    .get();
  if (!state) return;

  tx.update(sourceState)
    .set({ inFlight: Math.max(0, state.inFlight - 1) })
    .where(eq(sourceState.source, source))
    .run();
}

/**
 * Expires stale leases, marks tasks exceeding maxAttempts as failed, and leases
 * eligible pending tasks respecting runtime concurrency and per-site rate limits.
 */
export function dispatchPendingTasks(
  db: AppDatabase,
  options: DispatchPendingTasksOptions = {},
): DispatchPendingTasksResult {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const todayStr = nowIso.slice(0, 10);
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const runtimeLimits: Record<ExtractorRuntime, number> = {
    ...DEFAULT_RUNTIME_LIMITS,
    ...options.runtimeLimits,
  };

  return db.transaction((tx) => {
    const expiredTasks = tx
      .select()
      .from(scrapeTasks)
      .where(
        and(
          eq(scrapeTasks.status, "running"),
          lt(scrapeTasks.leaseUntil, nowIso),
        ),
      )
      .all();

    let expiredCount = 0;
    let failedCount = 0;

    for (const task of expiredTasks) {
      expiredCount += 1;
      const nextAttempts = task.attempts + 1;
      const exceeded = nextAttempts >= maxAttempts;
      if (exceeded) {
        failedCount += 1;
      }

      tx.update(scrapeTasks)
        .set({
          status: exceeded ? "failed" : "pending",
          attempts: nextAttempts,
          leaseUntil: null,
          error: exceeded
            ? (task.error ?? `Lease expired after ${nextAttempts} attempts`)
            : task.error,
          updatedAt: nowIso,
        })
        .where(eq(scrapeTasks.id, task.id))
        .run();

      decrementSourceInFlight(tx, task.source);
    }

    const runningTasks = tx
      .select({ runtime: scrapeTasks.runtime })
      .from(scrapeTasks)
      .where(eq(scrapeTasks.status, "running"))
      .all();

    const runningByRuntime: Record<ExtractorRuntime, number> = {
      worker: 0,
      browser: 0,
      container: 0,
    };
    for (const row of runningTasks) {
      runningByRuntime[row.runtime] += 1;
    }

    const pendingTasks = tx
      .select()
      .from(scrapeTasks)
      .where(eq(scrapeTasks.status, "pending"))
      .orderBy(scrapeTasks.createdAt)
      .all();

    const leasedTasks: Array<typeof scrapeTasks.$inferSelect> = [];
    const leaseUntil = new Date(nowMs + leaseDurationMs).toISOString();

    for (const task of pendingTasks) {
      if (runningByRuntime[task.runtime] >= runtimeLimits[task.runtime]) {
        continue;
      }

      const limit = options.rateLimits?.[task.source];
      const maxConcurrent = limit?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
      const minIntervalMs = limit?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
      const dailyCap = limit?.dailyCap;

      const currentState = tx
        .select()
        .from(sourceState)
        .where(eq(sourceState.source, task.source))
        .get();

      if (currentState?.cooldownUntil && currentState.cooldownUntil > nowIso) {
        continue;
      }

      const inFlight = currentState?.inFlight ?? 0;
      if (inFlight >= maxConcurrent) {
        continue;
      }

      const requestsToday =
        currentState?.day === todayStr ? currentState.requestsToday : 0;
      if (dailyCap !== undefined && requestsToday >= dailyCap) {
        continue;
      }

      if (currentState?.lastDispatchAt) {
        const elapsedMs =
          nowMs - new Date(currentState.lastDispatchAt).getTime();
        if (elapsedMs < minIntervalMs) {
          continue;
        }
      }

      tx.update(scrapeTasks)
        .set({
          status: "running",
          leaseUntil,
          updatedAt: nowIso,
        })
        .where(eq(scrapeTasks.id, task.id))
        .run();

      if (currentState) {
        tx.update(sourceState)
          .set({
            inFlight: inFlight + 1,
            lastDispatchAt: nowIso,
            requestsToday: requestsToday + 1,
            day: todayStr,
          })
          .where(eq(sourceState.source, task.source))
          .run();
      } else {
        tx.insert(sourceState)
          .values({
            source: task.source,
            inFlight: 1,
            lastDispatchAt: nowIso,
            requestsToday: 1,
            day: todayStr,
            cooldownLevel: 0,
          })
          .run();
      }

      runningByRuntime[task.runtime] += 1;
      const updatedTask = tx
        .select()
        .from(scrapeTasks)
        .where(eq(scrapeTasks.id, task.id))
        .get();
      if (updatedTask) {
        leasedTasks.push(updatedTask);
      }
    }

    return { expiredCount, failedCount, leasedTasks };
  });
}

/**
 * Records an upstream 429/403 rate-limit response for a source, applying exponential
 * cooldown (5m..2h) and returning the task to pending without consuming attempts.
 */
export function recordSourceRateLimitHit(
  db: AppDatabase,
  input: { source: string; taskId?: string; now?: Date },
): { cooldownUntil: string; cooldownLevel: number } {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(sourceState)
      .where(eq(sourceState.source, input.source))
      .get();

    const currentLevel = existing?.cooldownLevel ?? 0;
    const cooldownMs = Math.min(
      MAX_COOLDOWN_MS,
      BASE_COOLDOWN_MS * 2 ** currentLevel,
    );
    const cooldownUntil = new Date(now.getTime() + cooldownMs).toISOString();
    const nextLevel = currentLevel + 1;

    if (existing) {
      tx.update(sourceState)
        .set({
          inFlight: Math.max(0, existing.inFlight - 1),
          cooldownUntil,
          cooldownLevel: nextLevel,
        })
        .where(eq(sourceState.source, input.source))
        .run();
    } else {
      tx.insert(sourceState)
        .values({
          source: input.source,
          inFlight: 0,
          requestsToday: 0,
          cooldownUntil,
          cooldownLevel: nextLevel,
        })
        .run();
    }

    if (input.taskId) {
      tx.update(scrapeTasks)
        .set({
          status: "pending",
          leaseUntil: null,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(scrapeTasks.id, input.taskId),
            eq(scrapeTasks.status, "running"),
          ),
        )
        .run();
    }

    return { cooldownUntil, cooldownLevel: nextLevel };
  });
}

export interface IncomingPosting {
  jobUrl: string;
  source: string;
  company: string;
  title: string;
  location?: string | null;
  description?: string | null;
  postedAt?: string | null;
  extracted?: Record<string, unknown> | null;
}

export interface CompleteTaskResult {
  alreadyDone: boolean;
  postingIds: string[];
  subscribers: Array<typeof taskSubscribers.$inferSelect>;
}

/**
 * Idempotently completes a scrape task, upserting postings by normalized URL
 * and returning pending subscribers to notify.
 */
export function completeTask(
  db: AppDatabase,
  input: {
    taskId: string;
    postings: IncomingPosting[];
    resultKey?: string;
    now?: Date;
  },
): CompleteTaskResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  return db.transaction((tx) => {
    const task = tx
      .select()
      .from(scrapeTasks)
      .where(eq(scrapeTasks.id, input.taskId))
      .get();

    if (!task) {
      throw new Error(`Scrape task not found: ${input.taskId}`);
    }

    const pendingSubscribers = tx
      .select()
      .from(taskSubscribers)
      .where(
        and(
          eq(taskSubscribers.taskId, input.taskId),
          isNull(taskSubscribers.notifiedAt),
        ),
      )
      .all();

    if (task.status === "done") {
      return {
        alreadyDone: true,
        postingIds: task.postingIds ?? [],
        subscribers: pendingSubscribers,
      };
    }

    const postingIds: string[] = [];
    const seenIds = new Set<string>();

    for (const item of input.postings) {
      const urlNorm = normalizePostingUrl(item.jobUrl);
      const existing = tx
        .select()
        .from(postings)
        .where(eq(postings.urlNorm, urlNorm))
        .get();

      let postingId: string;
      if (existing) {
        postingId = existing.id;
        tx.update(postings)
          .set({
            source: item.source,
            company: item.company,
            title: item.title,
            location:
              item.location !== undefined ? item.location : existing.location,
            description:
              item.description !== undefined
                ? item.description
                : existing.description,
            postedAt:
              item.postedAt !== undefined ? item.postedAt : existing.postedAt,
            lastSeenAt: nowIso,
            extracted:
              item.extracted !== undefined
                ? item.extracted
                : existing.extracted,
          })
          .where(eq(postings.id, existing.id))
          .run();
      } else {
        postingId = randomUUID();
        tx.insert(postings)
          .values({
            id: postingId,
            urlNorm,
            source: item.source,
            company: item.company,
            title: item.title,
            location: item.location ?? null,
            description: item.description ?? null,
            postedAt: item.postedAt ?? null,
            firstSeenAt: nowIso,
            lastSeenAt: nowIso,
            extracted: item.extracted ?? null,
          })
          .run();
      }

      if (!seenIds.has(postingId)) {
        seenIds.add(postingId);
        postingIds.push(postingId);
      }
    }

    if (task.status === "running") {
      const state = tx
        .select()
        .from(sourceState)
        .where(eq(sourceState.source, task.source))
        .get();
      if (state) {
        tx.update(sourceState)
          .set({
            inFlight: Math.max(0, state.inFlight - 1),
            cooldownLevel: 0,
          })
          .where(eq(sourceState.source, task.source))
          .run();
      }
    }

    tx.update(scrapeTasks)
      .set({
        status: "done",
        completedAt: nowIso,
        leaseUntil: null,
        resultKey: input.resultKey ?? task.resultKey,
        postingsFound: postingIds.length,
        postingIds,
        error: null,
        updatedAt: nowIso,
      })
      .where(eq(scrapeTasks.id, task.id))
      .run();

    return {
      alreadyDone: false,
      postingIds,
      subscribers: pendingSubscribers,
    };
  });
}

/**
 * Marks a scrape task as needing human attention (e.g. captcha challenge).
 */
export function markTaskNeedsAttention(
  db: AppDatabase,
  input: { taskId: string; error?: string; now?: Date },
): void {
  const nowIso = (input.now ?? new Date()).toISOString();

  db.transaction((tx) => {
    const task = tx
      .select()
      .from(scrapeTasks)
      .where(eq(scrapeTasks.id, input.taskId))
      .get();
    if (!task) return;

    if (task.status === "running") {
      decrementSourceInFlight(tx, task.source);
    }

    tx.update(scrapeTasks)
      .set({
        status: "needs_attention",
        leaseUntil: null,
        error: input.error ?? "Captcha or human verification required",
        updatedAt: nowIso,
      })
      .where(eq(scrapeTasks.id, task.id))
      .run();
  });
}

export interface OnTaskDoneForTenantInput {
  taskId: string;
  tenantId: string;
  userId?: string | null;
  runId: string;
  postingIds: string[];
  cached?: boolean;
  taskStatus?: "done" | "failed";
  now?: Date;
}

/**
 * Idempotently imports shared postings into a tenant's jobs table, updates
 * pipeline_runs task counters and final status, and stamps subscriber notified_at.
 * Callers must dedupe by buildScrapeKey within each run before setting tasksTotal.
 */
export function onTaskDoneForTenant(
  db: AppDatabase,
  input: OnTaskDoneForTenantInput,
): { insertedCount: number } {
  const nowIso = (input.now ?? new Date()).toISOString();

  return db.transaction((tx) => {
    // Cached completions may not have a subscriber yet. Claim notification
    // once per task/tenant/run in the same transaction as imports and counters.
    const notification = tx
      .insert(taskSubscribers)
      .values({
        taskId: input.taskId,
        tenantId: input.tenantId,
        runId: input.runId,
        notifiedAt: nowIso,
        createdAt: nowIso,
      })
      .onConflictDoUpdate({
        target: [
          taskSubscribers.taskId,
          taskSubscribers.tenantId,
          taskSubscribers.runId,
        ],
        set: { notifiedAt: nowIso },
        setWhere: isNull(taskSubscribers.notifiedAt),
      })
      .run();

    if (notification.changes === 0) {
      return { insertedCount: 0 };
    }

    let insertedCount = 0;

    if (input.taskStatus !== "failed" && input.postingIds.length > 0) {
      const postingRows = tx
        .select()
        .from(postings)
        .where(inArray(postings.id, input.postingIds))
        .all();

      for (const posting of postingRows) {
        const result = tx
          .insert(jobs)
          .values({
            id: randomUUID(),
            tenantId: input.tenantId,
            userId: input.userId ?? null,
            source: posting.source,
            postingId: posting.id,
            title: posting.title,
            employer: posting.company,
            jobUrl: posting.urlNorm,
            location: posting.location,
            jobDescription: posting.description,
            datePosted: posting.postedAt,
            status: "discovered",
            discoveredAt: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .onConflictDoNothing()
          .run();

        insertedCount += result.changes;
      }
    }

    const run = tx
      .select()
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.id, input.runId),
          eq(pipelineRuns.tenantId, input.tenantId),
        ),
      )
      .get();

    if (run) {
      const nextDone = run.tasksDone + (input.taskStatus === "failed" ? 0 : 1);
      const nextFailed =
        run.tasksFailed + (input.taskStatus === "failed" ? 1 : 0);
      const nextCached = run.tasksCached + (input.cached ? 1 : 0);
      const nextDiscovered = run.jobsDiscovered + insertedCount;
      const allFinished =
        run.tasksTotal > 0 && nextDone + nextFailed >= run.tasksTotal;

      tx.update(pipelineRuns)
        .set({
          tasksDone: nextDone,
          tasksFailed: nextFailed,
          tasksCached: nextCached,
          jobsDiscovered: nextDiscovered,
          ...(allFinished
            ? {
                status: nextFailed > 0 ? "partial" : "completed",
                completedAt: nowIso,
              }
            : {}),
        })
        .where(eq(pipelineRuns.id, run.id))
        .run();
    }

    return { insertedCount };
  });
}

/**
 * Deletes shared postings that have not been seen within the retention window.
 */
export function cleanupUnseenPostings(
  db: AppDatabase,
  options: { retentionDays?: number; now?: Date } = {},
): { deletedCount: number } {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoffIso = new Date(
    now.getTime() - retentionDays * DAY_MS,
  ).toISOString();

  const result = db
    .delete(postings)
    .where(lt(postings.lastSeenAt, cutoffIso))
    .run();

  return { deletedCount: result.changes };
}
