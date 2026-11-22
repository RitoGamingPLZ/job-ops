import { timingSafeEqual } from "node:crypto";
import { forbidden, toAppError, unauthorized } from "@infra/errors";
import { fail, ok, okWithMeta } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import { isDemoMode } from "@server/config/demo";
import { runPipeline } from "@server/pipeline/index";
import {
  cleanupOldBackups,
  createBackup,
  getBackupSettings,
} from "@server/services/backup";
import { simulatePipelineRun } from "@server/services/demo-simulator";
import { runDueScheduledPipelinesForHour } from "@server/services/pipeline-scheduler";
import { type Request, type Response, Router } from "express";

export const webhookRouter = Router();

/**
 * POST /api/webhook/trigger - Webhook endpoint for n8n to trigger the pipeline
 */
webhookRouter.post("/trigger", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.WEBHOOK_SECRET;

  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return fail(res, unauthorized());
  }

  try {
    if (isDemoMode()) {
      const simulated = await simulatePipelineRun();
      return okWithMeta(
        res,
        {
          message: "Pipeline trigger simulated in demo mode",
          triggeredAt: new Date().toISOString(),
          runId: simulated.runId,
        },
        { simulated: true },
      );
    }

    if (getJobOpsAppConfig().appMode === "hosted") {
      return fail(
        res,
        forbidden("Webhook pipeline trigger is unavailable in hosted mode."),
      );
    }

    // Start pipeline in background
    runWithRequestContext({}, () => {
      runPipeline().catch((error) => {
        logger.error("Webhook-triggered pipeline run failed", error);
      });
    });

    ok(res, {
      message: "Pipeline triggered",
      triggeredAt: new Date().toISOString(),
    });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

function hasMatchingBearerSecret(
  authHeader: string | undefined,
  expectedSecret: string | undefined,
): boolean {
  const secret = expectedSecret?.trim();
  if (!secret || !authHeader?.startsWith("Bearer ")) {
    return false;
  }
  const provided = authHeader.slice("Bearer ".length);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function resolveCronHour(body: unknown): number {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (
      typeof record.hour === "number" &&
      Number.isInteger(record.hour) &&
      record.hour >= 0 &&
      record.hour <= 23
    ) {
      return record.hour;
    }
    if (
      typeof record.scheduledTime === "number" ||
      typeof record.scheduledTime === "string"
    ) {
      const parsed = new Date(record.scheduledTime);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getUTCHours();
      }
    }
  }
  return new Date().getHours();
}

/**
 * POST /api/webhook/cron - Internal cron tick endpoint invoked by Cloudflare Worker
 * Cron Triggers to run due scheduled pipelines and auto-backups.
 */
webhookRouter.post("/cron", async (req: Request, res: Response) => {
  const expectedSecret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET;
  if (!hasMatchingBearerSecret(req.headers.authorization, expectedSecret)) {
    return fail(res, unauthorized());
  }

  try {
    const targetHour = resolveCronHour(req.body);
    const pipelineResult = await runDueScheduledPipelinesForHour(targetHour);

    const backupSettings = getBackupSettings();
    let backupTriggered = false;
    if (backupSettings.enabled && backupSettings.hour === targetHour) {
      backupTriggered = true;
      void createBackup("auto")
        .then(() => cleanupOldBackups())
        .catch((error) => {
          logger.error("Cron-triggered backup failed", {
            route: "POST /api/webhook/cron",
            error: sanitizeUnknown(error),
          });
        });
    }

    logger.info("Processed cron tick", {
      route: "POST /api/webhook/cron",
      ...pipelineResult,
      backupTriggered,
    });

    ok(res, {
      ...pipelineResult,
      backupTriggered,
      triggeredAt: new Date().toISOString(),
    });
  } catch (error) {
    fail(res, toAppError(error));
  }
});
