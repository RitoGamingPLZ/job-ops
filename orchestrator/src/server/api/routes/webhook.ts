import { timingSafeEqual } from "node:crypto";
import { forbidden, unauthorized } from "@infra/errors";
import { asyncRoute, fail, ok, okWithMeta } from "@infra/http";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import { isDemoMode } from "@server/config/demo";
import { runPipeline } from "@server/pipeline/index";
import {
  cleanupOldBackups,
  createBackup,
  hydrateBackupSettingsFromDb,
} from "@server/services/backup";
import { simulatePipelineRun } from "@server/services/demo-simulator";
import { runDueScheduledPipelinesForHour } from "@server/services/pipeline-scheduler";
import { type Request, type Response, Router } from "express";

export const webhookRouter = Router();

/**
 * POST /api/webhook/trigger - Webhook endpoint for n8n to trigger the pipeline
 */
webhookRouter.post(
  "/trigger",
  asyncRoute(async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.WEBHOOK_SECRET;

    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return fail(res, unauthorized());
    }

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
      return fail(res, forbidden("Webhook pipeline trigger is unavailable in hosted mode."));
    }

    // Start pipeline in background
    void runPipeline().catch((error) => {
      logger.error("Webhook-triggered pipeline run failed", {
        route: "POST /api/webhook/trigger",
        error: sanitizeUnknown(error),
      });
    });

    ok(res, {
      message: "Pipeline triggered",
      triggeredAt: new Date().toISOString(),
    });
  }),
);

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

function resolveCronHours(body: unknown): {
  targetHour: number;
  backupTargetHour: number;
} {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (
      typeof record.hour === "number" &&
      Number.isInteger(record.hour) &&
      record.hour >= 0 &&
      record.hour <= 23
    ) {
      return { targetHour: record.hour, backupTargetHour: record.hour };
    }
    if (typeof record.scheduledTime === "number" || typeof record.scheduledTime === "string") {
      const parsed = new Date(record.scheduledTime);
      if (!Number.isNaN(parsed.getTime())) {
        const utcHour = parsed.getUTCHours();
        return { targetHour: utcHour, backupTargetHour: utcHour };
      }
    }
  }
  const now = new Date();
  return {
    targetHour: now.getHours(),
    backupTargetHour: now.getUTCHours(),
  };
}

/**
 * POST /api/webhook/cron - Internal cron tick endpoint invoked by Cloudflare Worker
 * Cron Triggers to run due scheduled pipelines and auto-backups.
 */
webhookRouter.post(
  "/cron",
  asyncRoute(async (req: Request, res: Response) => {
    const expectedSecret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET;
    if (!hasMatchingBearerSecret(req.headers.authorization, expectedSecret)) {
      return fail(res, unauthorized());
    }

    const { targetHour, backupTargetHour } = resolveCronHours(req.body);
    const pipelineResult = await runDueScheduledPipelinesForHour(targetHour);

    const backupSettings = await hydrateBackupSettingsFromDb({ startScheduler: false });
    let backupTriggered = false;
    if (backupSettings.enabled && backupSettings.hour === backupTargetHour) {
      backupTriggered = true;
      try {
        await createBackup("auto");
        await cleanupOldBackups();
      } catch (error) {
        logger.error("Cron-triggered backup failed", {
          route: "POST /api/webhook/cron",
          error: sanitizeUnknown(error),
        });
      }
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
  }),
);
