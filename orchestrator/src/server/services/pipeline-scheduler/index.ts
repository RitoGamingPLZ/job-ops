import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { isDemoMode } from "@server/config/demo";
import { getPipelineStatus } from "@server/pipeline/index";
import * as pipelineRepo from "@server/repositories/pipeline";
import * as settingsRepo from "@server/repositories/settings";
import { getPrivateDataScope, isHostedUserIsolationEnabled } from "@server/tenancy/private-scope";
import { settingsRegistry } from "@shared/settings-registry";
import { runPipelineSchema, startRequestedPipeline } from "./run-request";
import { listScheduleOwners, loadRunRequest } from "./storage";

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

export async function getNextScheduledPipelineRun(): Promise<string | null> {
  if (isDemoMode()) return null;
  const settings = await scheduleSettings();
  return settings.enabled ? nextDailyFireTime(settings.hour).toISOString() : null;
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
  await startRequestedPipeline(
    { ...runPipelineSchema.parse(saved), watchlistSelectedSourceIds: undefined },
    false,
  );
}

type Owner = { tenantId: string; userId: string | null };
type Schedule = { owner: Owner; at: Date; hour: number };
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
        asOwner(schedule.owner, () => {
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

export function stopPipelineScheduler(): void {
  started = false;
  ++generation;
  if (timer) clearTimeout(timer);
  timer = undefined;
  schedules = [];
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

  const owners = await listScheduleOwners();
  const unique = new Map<string, Owner>();
  for (const owner of owners) {
    if (isHostedUserIsolationEnabled() && !owner.userId) continue;
    const key = asOwner(owner, () => getPrivateDataScope().scopeKey);
    unique.set(key, owner);
  }

  const now = new Date();
  let evaluatedCount = 0;
  let triggeredCount = 0;

  for (const [scopeKey, owner] of unique.entries()) {
    const settings = await asOwner(owner, scheduleSettings);
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
      const scheduleKey = asOwner(schedule.owner, () => getPrivateDataScope().scopeKey);
      if (scheduleKey === scopeKey) {
        schedule.at = nextDailyFireTime(settings.hour, now);
      }
    }

    triggeredCount++;
    asOwner(owner, () => {
      void runScheduledPipeline().catch((error) =>
        logger.error("Scheduled pipeline failed", {
          error: sanitizeUnknown(error),
        }),
      );
    });
  }

  if (triggeredCount > 0 && started) {
    armTimer();
  }

  return { hour: targetHour, evaluatedCount, triggeredCount };
}
