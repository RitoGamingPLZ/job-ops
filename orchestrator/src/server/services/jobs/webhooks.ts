import { logger } from "@infra/logger";
import { sanitizeWebhookPayload } from "@infra/sanitize";
import { postJsonToPublicUrl } from "@infra/safe-fetch";
import * as settingsRepo from "@server/repositories/settings";
import { isOperatorContext } from "@server/services/server-credentials";
import type { Job } from "@shared/types";

export async function notifyJobCompleteWebhook(job: Job) {
  const overrideWebhookUrl = await settingsRepo.getSetting("jobCompleteWebhookUrl");
  const operatorTrusted = await isOperatorContext();
  const webhookUrl = (
    overrideWebhookUrl ||
    (operatorTrusted ? process.env.JOB_COMPLETE_WEBHOOK_URL : "") ||
    ""
  ).trim();
  if (!webhookUrl) return;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = operatorTrusted
      ? process.env.WEBHOOK_SECRET
      : (await settingsRepo.getSetting("webhookSecret"))?.trim() || undefined;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const payload = sanitizeWebhookPayload({
      event: "job.completed",
      sentAt: new Date().toISOString(),
      job: {
        id: job.id,
        source: job.source,
        title: job.title,
        employer: job.employer,
        status: job.status,
        suitabilityScore: job.suitabilityScore,
      },
    });

    const response = await postJsonToPublicUrl(webhookUrl, payload, headers, {
      signal: AbortSignal.timeout(10_000),
      allowPrivateNetwork: operatorTrusted,
    });

    if (!response.ok) {
      logger.warn("Job complete webhook POST failed", {
        status: response.status,
        response: (await response.text().catch(() => "")).slice(0, 200),
        jobId: job.id,
      });
    }
  } catch (error) {
    logger.warn("Job complete webhook POST failed", { jobId: job.id, error });
  }
}
