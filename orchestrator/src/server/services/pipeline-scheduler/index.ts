import { randomUUID } from "node:crypto";
import { AppError } from "@infra/errors";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { isDemoMode } from "@server/config/demo";
import { getActivePipelineCount, getPipelineStatus } from "@server/pipeline/index";
import * as pipelineRepo from "@server/repositories/pipeline";
import * as settingsRepo from "@server/repositories/settings";
import { getSystemAdminTenantId } from "@server/repositories/users";
import { getPrivateDataScope, isHostedUserIsolationEnabled } from "@server/tenancy/private-scope";
import { PIPELINE_EXTRACTOR_SOURCE_IDS } from "@shared/extractors";
import { settingsRegistry } from "@shared/settings-registry";
import {
  readMaxConcurrentPipelines,
  runPipelineSchema,
  startRequestedPipeline,
} from "./run-request";
import { sleep } from "@server/utils/sleep";
import { listRunRequestOwners, listScheduleOwners, loadRunRequest } from "./storage";

export function nextDailyFireTime(hour: number, now = new Date()): Date {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
    next.setHours(hour, 0, 0, 0);
  }
  return next;
}

async function scheduleSettings() {
  const enabled =
    settingsRegistry.pipelineScheduleEnabled.parse(
      (await settingsRepo.getSetting("pipelineScheduleEnabled")) ?? undefined,
    ) ?? false;
  const hour =
    settingsRegistry.pipelineScheduleHour.parse(
      (await settingsRepo.getSetting("pipelineScheduleHour")) ?? undefined,
    ) ?? 7;
  return { enabled, hour };
}

/**
 * Outside hosted mode the system admin owns one schedule for the whole server. It lives in the
 * admin's workspace settings, like the server's default AI connection.
 */
async function adminScheduleSettings() {
  const tenantId = await getSystemAdminTenantId();
  if (!tenantId) return { enabled: false, hour: 7 };
  return asOwner({ tenantId, userId: null }, scheduleSettings);
}

export async function getNextScheduledPipelineRun(): Promise<string | null> {
  if (isDemoMode()) return null;
  const settings = isHostedUserIsolationEnabled()
    ? await scheduleSettings()
    : await adminScheduleSettings();
  return settings.enabled ? nextDailyFireTime(settings.hour).toISOString() : null;
}

function sanitizeSavedScheduleRequest(saved: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(saved.sources)) return saved;
  const allowed = new Set<string>(PIPELINE_EXTRACTOR_SOURCE_IDS);
  const kept = saved.sources.filter(
    (source): source is string => typeof source === "string" && allowed.has(source),
  );
  const droppedCount = saved.sources.length - kept.length;
  if (droppedCount > 0) {
    logger.warn("Filtered retired sources from saved scheduled pipeline request", {
      droppedCount,
      keptCount: kept.length,
    });
  }
  if (kept.length === 0) {
    const { sources: _dropped, ...rest } = saved;
    return rest;
  }
  return { ...saved, sources: kept };
}

export async function runScheduledPipeline(): Promise<void> {
  if (getPipelineStatus().isRunning) {
    logger.info("Scheduled pipeline skipped", { reason: "already_running" });
    return;
  }
  const saved = await loadRunRequest();
  if (saved === null) {
    logger.info("Scheduled pipeline skipped", {
      reason: "no_saved_run",
      message: "Run a search manually to save its defaults",
    });
    return;
  }
  logger.info("Starting scheduled pipeline");
  // The saved request replays the sources, search terms and limits of the last
  // manual search, but not its Watchlist selection: a scheduled run always
  // covers every Watchlist source currently saved, so sources added since that
  // search (custom URLs, source groups) are picked up without another manual run.
  const sanitized = sanitizeSavedScheduleRequest(saved as unknown as Record<string, unknown>);
  await startRequestedPipeline(
    { ...runPipelineSchema.parse(sanitized), watchlistSelectedSourceIds: undefined },
    false,
  );
}

type Owner = { tenantId: string; userId: string | null; requestSavedAt?: string };
// `owner: null` is the admin's server-wide schedule; it fans out to every workspace with a saved search.
type Schedule = { owner: Owner | null; at: Date; hour: number };
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let started = false;
let schedules: Schedule[] = [];

function asOwner<T>(owner: Owner, fn: () => T): T {
  return runWithRequestContext(
    {
      tenantId: owner.tenantId,
      userId: owner.userId ?? undefined,
      requestId: randomUUID(),
      pipelineRunId: undefined,
      jobId: undefined,
      username: undefined,
      isSystemAdmin: false,
      analyticsSessionId: undefined,
      requestUserAgent: undefined,
    },
    fn,
  );
}

const CAPACITY_RETRY_DELAY_MS = 30_000;
// Stop waiting for a free slot well before the next daily fire so two days never overlap.
const QUEUE_DEADLINE_MS = 20 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let draining = false;

/**
 * Starts the saved searches of many workspaces. Searches share a small pool of scrapers
 * (`MAX_CONCURRENT_PIPELINES`), so workspaces are started one at a time and each waits for a free
 * slot rather than being dropped. The start order rotates daily so nobody is always last, and a
 * second trigger while a queue is still draining is ignored instead of running everyone twice.
 */
async function runOwnersStaggered(owners: Owner[]): Promise<void> {
  if (owners.length === 0) return;
  if (draining) {
    logger.info("Scheduled pipelines skipped", { reason: "previous_queue_still_running" });
    return;
  }
  draining = true;
  try {
    const offset = Math.floor(Date.now() / DAY_MS) % owners.length;
    const ordered = [...owners.slice(offset), ...owners.slice(0, offset)];
    const deadline = Date.now() + QUEUE_DEADLINE_MS;
    // Scheduled searches leave one scraper slot free so people can still start a search by hand.
    const scheduledSlots = Math.max(1, readMaxConcurrentPipelines() - 1);
    for (const owner of ordered) {
      while (getActivePipelineCount() >= scheduledSlots && Date.now() < deadline) {
        await sleep(CAPACITY_RETRY_DELAY_MS, { unref: true });
      }
      for (;;) {
        try {
          await asOwner(owner, () => runScheduledPipeline());
          break;
        } catch (error) {
          const atCapacity = error instanceof AppError && error.status === 503;
          if (atCapacity && Date.now() < deadline) {
            await sleep(CAPACITY_RETRY_DELAY_MS, { unref: true });
            continue;
          }
          logger.error("Scheduled pipeline failed", { error: sanitizeUnknown(error) });
          break;
        }
      }
    }
  } finally {
    draining = false;
  }
}

async function runAllWorkspaces(): Promise<void> {
  const settings = await adminScheduleSettings();
  if (!settings.enabled || isDemoMode()) return;
  await runOwnersStaggered(await listRunRequestOwners());
}

function armTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!started || schedules.length === 0) return;
  const next = Math.min(...schedules.map((schedule) => schedule.at.getTime()));
  timer = setTimeout(
    () => {
      timer = undefined;
      const now = new Date();
      const due = schedules.filter((schedule) => schedule.at <= now);
      // Rearm before running; jobs may take hours and settings can change meanwhile.
      for (const schedule of due) {
        const { owner } = schedule;
        if (owner === null) {
          void runAllWorkspaces().catch((error) =>
            logger.error("Scheduled pipeline failed", { error: sanitizeUnknown(error) }),
          );
          schedule.at = nextDailyFireTime(schedule.hour, now);
          continue;
        }
        asOwner(owner, () => {
          void (async () => {
            const settings = await scheduleSettings();
            if (!settings.enabled || isDemoMode()) return;
            await runScheduledPipeline();
          })().catch((error) =>
            logger.error("Scheduled pipeline failed", {
              error: sanitizeUnknown(error),
            }),
          );
        });
        schedule.at = nextDailyFireTime(schedule.hour, now);
      }
      armTimer();
    },
    Math.max(0, next - Date.now()),
  );
  timer.unref?.();
}

export async function refreshPipelineScheduler(): Promise<void> {
  if (!started) return;
  const current = ++generation;
  if (!isHostedUserIsolationEnabled()) {
    const settings = await adminScheduleSettings();
    if (current !== generation || !started) return;
    schedules =
      settings.enabled && !isDemoMode()
        ? [{ owner: null, at: nextDailyFireTime(settings.hour), hour: settings.hour }]
        : [];
    armTimer();
    return;
  }
  const owners = await listScheduleOwners();
  const unique = new Map<string, Owner>();
  for (const owner of owners) {
    if (isHostedUserIsolationEnabled() && !owner.userId) continue;
    const key = asOwner(owner, () => getPrivateDataScope().scopeKey);
    unique.set(key, owner);
  }
  const next: Schedule[] = [];
  for (const owner of unique.values()) {
    const settings = await asOwner(owner, scheduleSettings);
    if (settings.enabled && !isDemoMode())
      next.push({
        owner,
        at: nextDailyFireTime(settings.hour),
        hour: settings.hour,
      });
  }
  if (current !== generation || !started) return;
  schedules = next;
  armTimer();
}

export async function startPipelineScheduler(): Promise<void> {
  started = true;
  await refreshPipelineScheduler();
}

export function __stopPipelineSchedulerForTests(): void {
  started = false;
  ++generation;
  if (timer) clearTimeout(timer);
  timer = undefined;
  schedules = [];
  stopIncompleteSearchRecovery();
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function shouldCatchUpFailedRunToday(
  scheduledHour: number,
  targetHour: number,
  now: Date,
): Promise<boolean> {
  if (scheduledHour > targetHour) return false;
  const latestRun = await pipelineRepo.getLatestPipelineRun();
  if (!latestRun || latestRun.status !== "failed") return false;
  const startedAt = new Date(latestRun.startedAt);
  if (Number.isNaN(startedAt.getTime())) return false;
  if (!isSameLocalCalendarDay(startedAt, now)) return false;

  logger.info("Triggering catch-up scheduled pipeline run", {
    scheduledHour,
    targetHour,
    failedRunId: latestRun.id,
  });
  return true;
}

/** Execute any enabled daily pipeline schedules matching `targetHour` (0-23). */
export async function runDueScheduledPipelinesForHour(
  targetHour = new Date().getHours(),
): Promise<{ hour: number; evaluatedCount: number; triggeredCount: number }> {
  if (isDemoMode()) {
    return { hour: targetHour, evaluatedCount: 0, triggeredCount: 0 };
  }

  const hosted = isHostedUserIsolationEnabled();
  const owners = hosted ? await listScheduleOwners() : await listRunRequestOwners();
  // Outside hosted mode one admin-owned schedule applies to every workspace with a saved search.
  const adminSettings = hosted ? null : await adminScheduleSettings();
  const unique = new Map<string, Owner>();
  for (const owner of owners) {
    if (hosted && !owner.userId) continue;
    const key = asOwner(owner, () => getPrivateDataScope().scopeKey);
    unique.set(key, owner);
  }

  const now = new Date();
  let evaluatedCount = 0;
  let triggeredCount = 0;
  const triggered: Owner[] = [];

  for (const [scopeKey, owner] of unique.entries()) {
    const settings = adminSettings ?? (await asOwner(owner, scheduleSettings));
    evaluatedCount++;
    if (!settings.enabled) {
      continue;
    }

    const isDueHour = settings.hour === targetHour;
    const isCatchUp =
      !isDueHour &&
      (await asOwner(owner, () => shouldCatchUpFailedRunToday(settings.hour, targetHour, now)));

    if (!isDueHour && !isCatchUp) {
      continue;
    }

    for (const schedule of schedules) {
      const scheduleKey = schedule.owner
        ? asOwner(schedule.owner, () => getPrivateDataScope().scopeKey)
        : null;
      if (scheduleKey === null || scheduleKey === scopeKey) {
        schedule.at = nextDailyFireTime(settings.hour, now);
      }
    }

    triggeredCount++;
    triggered.push(owner);
  }

  if (triggered.length > 0) void runOwnersStaggered(triggered);

  if (triggeredCount > 0 && started) {
    armTimer();
  }

  return { hour: targetHour, evaluatedCount, triggeredCount };
}

// --- Recovery sweep -------------------------------------------------------------------------
// The daily queue lives in memory, so a restart (or a failed run) can leave searches that were
// due today never started or failed. The sweep re-queues exactly those, a few times at most.

const MAX_CATCH_UP_ATTEMPTS = 3;
const RECOVERY_BOOT_DELAY_MS = 60_000;
const RECOVERY_INTERVAL_MS = 60 * 60 * 1000;
const catchUpAttempts = new Map<string, { day: string; attempts: number }>();
let recoveryBootTimer: ReturnType<typeof setTimeout> | undefined;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;

/**
 * True when today's search was due (its hour has passed) and this workspace has no run since then
 * that started, finished or is still going. A search saved after the due time waits for tomorrow.
 */
async function searchStillOwedToday(
  scheduledHour: number,
  now: Date,
  requestSavedAt: string | undefined,
): Promise<boolean> {
  if (scheduledHour > now.getHours()) return false;
  const due = new Date(now);
  due.setHours(scheduledHour, 0, 0, 0);
  if (requestSavedAt && new Date(requestSavedAt) > due) return false;
  const runsSinceDue = await pipelineRepo.getPipelineRunsSince(due.toISOString());
  return runsSinceDue.every((run) => run.status === "failed");
}

/** Re-queue today's daily searches that never started or only failed. */
export async function catchUpIncompleteScheduledPipelines(
  now = new Date(),
): Promise<{ evaluatedCount: number; triggeredCount: number }> {
  if (isDemoMode() || draining) return { evaluatedCount: 0, triggeredCount: 0 };

  const hosted = isHostedUserIsolationEnabled();
  const owners = hosted ? await listScheduleOwners() : await listRunRequestOwners();
  const adminSettings = hosted ? null : await adminScheduleSettings();
  if (adminSettings && !adminSettings.enabled) return { evaluatedCount: 0, triggeredCount: 0 };

  const unique = new Map<string, Owner>();
  for (const owner of owners) {
    if (hosted && !owner.userId) continue;
    unique.set(
      asOwner(owner, () => getPrivateDataScope().scopeKey),
      owner,
    );
  }

  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  let evaluatedCount = 0;
  const triggered: Owner[] = [];
  for (const [scopeKey, owner] of unique.entries()) {
    const settings = adminSettings ?? (await asOwner(owner, scheduleSettings));
    if (!settings.enabled) continue;
    evaluatedCount++;
    const owed = await asOwner(owner, () =>
      searchStillOwedToday(settings.hour, now, owner.requestSavedAt),
    );
    if (!owed) continue;
    const previous = catchUpAttempts.get(scopeKey);
    const attempts = previous?.day === day ? previous.attempts : 0;
    if (attempts >= MAX_CATCH_UP_ATTEMPTS) continue;
    catchUpAttempts.set(scopeKey, { day, attempts: attempts + 1 });
    triggered.push(owner);
  }

  if (triggered.length > 0) {
    logger.info("Re-queueing incomplete daily searches", { count: triggered.length });
    void runOwnersStaggered(triggered);
  }
  return { evaluatedCount, triggeredCount: triggered.length };
}

function stopIncompleteSearchRecovery(): void {
  if (recoveryBootTimer) clearTimeout(recoveryBootTimer);
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryBootTimer = undefined;
  recoveryTimer = undefined;
  catchUpAttempts.clear();
}

/** Sweeps once shortly after boot (to recover from a restart), then every hour. */
export function startIncompleteSearchRecovery(): void {
  stopIncompleteSearchRecovery();
  const sweep = () =>
    void catchUpIncompleteScheduledPipelines().catch((error) =>
      logger.error("Incomplete search recovery failed", { error: sanitizeUnknown(error) }),
    );
  recoveryBootTimer = setTimeout(sweep, RECOVERY_BOOT_DELAY_MS);
  recoveryTimer = setInterval(sweep, RECOVERY_INTERVAL_MS);
  recoveryBootTimer.unref?.();
  recoveryTimer.unref?.();
}
