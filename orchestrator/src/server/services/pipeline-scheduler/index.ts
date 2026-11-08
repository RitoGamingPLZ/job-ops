import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { isDemoMode } from "@server/config/demo";
import { getPipelineStatus } from "@server/pipeline/index";
import * as settingsRepo from "@server/repositories/settings";
import {
  getPrivateDataScope,
  isHostedUserIsolationEnabled,
} from "@server/tenancy/private-scope";
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
  return settings.enabled
    ? nextDailyFireTime(settings.hour).toISOString()
    : null;
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
  await startRequestedPipeline(runPipelineSchema.parse(saved), false);
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
