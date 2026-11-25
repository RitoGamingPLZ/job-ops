import { logger } from "@infra/logger";
import { sanitizeWebhookPayload } from "@infra/sanitize";
import { postJsonToPublicUrl } from "@infra/safe-fetch";
import * as settingsRepo from "@server/repositories/settings";
import { isOperatorContext } from "@server/services/server-credentials";

export async function notifyPipelineWebhookStep(
  event: "pipeline.completed" | "pipeline.failed",
  payload: Record<string, unknown>,
): Promise<void> {
  const operatorTrusted = await isOperatorContext();
  const overridePipelineWebhookUrl = await settingsRepo.getSetting("pipelineWebhookUrl");
  const pipelineWebhookUrl = (
    overridePipelineWebhookUrl ||
    (operatorTrusted ? process.env.PIPELINE_WEBHOOK_URL || process.env.WEBHOOK_URL : "") ||
    ""
  ).trim();

  if (!pipelineWebhookUrl) return;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // The operator's secret only ever goes to the operator's own webhook.
    const secret = operatorTrusted
      ? process.env.WEBHOOK_SECRET
      : (await settingsRepo.getSetting("webhookSecret"))?.trim() || undefined;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const sanitizedPayload = sanitizeWebhookPayload({
      event,
      sentAt: new Date().toISOString(),
      pipelineRunId: payload.pipelineRunId,
      jobsDiscovered: payload.jobsDiscovered,
      jobsScored: payload.jobsScored,
      jobsProcessed: payload.jobsProcessed,
      error: payload.error,
    });

    const response = await postJsonToPublicUrl(pipelineWebhookUrl, sanitizedPayload, headers, {
      signal: AbortSignal.timeout(10_000),
      allowPrivateNetwork: operatorTrusted,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      logger.warn("Pipeline webhook POST failed", {
        status: response.status,
        error: responseText.slice(0, 200),
      });
    }
  } catch (error) {
    logger.warn("Pipeline webhook POST failed", error);
  }
}
