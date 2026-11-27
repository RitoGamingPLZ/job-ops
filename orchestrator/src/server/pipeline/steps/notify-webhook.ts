import { deliverWebhook } from "@server/services/webhooks";
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

  await deliverWebhook({
    url: pipelineWebhookUrl,
    operatorTrusted,
    failureMessage: "Pipeline webhook POST failed",
    context: {
      pipelineRunId: typeof payload.pipelineRunId === "string" ? payload.pipelineRunId : undefined,
    },
    payload: {
      event,
      sentAt: new Date().toISOString(),
      pipelineRunId: payload.pipelineRunId,
      jobsDiscovered: payload.jobsDiscovered,
      jobsScored: payload.jobsScored,
      jobsProcessed: payload.jobsProcessed,
      error: payload.error,
    },
  });
}
