import { deliverWebhook } from "@server/services/webhooks";
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

  await deliverWebhook({
    url: webhookUrl,
    operatorTrusted,
    failureMessage: "Job complete webhook POST failed",
    context: { jobId: job.id },
    payload: {
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
    },
  });
}
