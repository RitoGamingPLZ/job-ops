import { logger } from "@infra/logger";
import { postJsonToPublicUrl } from "@infra/safe-fetch";
import { sanitizeUnknown, sanitizeWebhookPayload } from "@infra/sanitize";
import * as settingsRepo from "@server/repositories/settings";

export async function deliverWebhook(args: {
  url: string;
  operatorTrusted: boolean;
  payload: Record<string, unknown>;
  failureMessage: string;
  context: { jobId?: string; pipelineRunId?: string };
}): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = args.operatorTrusted
      ? process.env.WEBHOOK_SECRET
      : (await settingsRepo.getSetting("webhookSecret"))?.trim();
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const response = await postJsonToPublicUrl(
      args.url,
      sanitizeWebhookPayload(args.payload),
      headers,
      {
        signal: AbortSignal.timeout(10_000),
        allowPrivateNetwork: args.operatorTrusted,
      },
    );
    if (!response.ok) {
      logger.warn(args.failureMessage, { ...args.context, status: response.status });
    }
    await response.body?.cancel();
  } catch (error) {
    logger.warn(args.failureMessage, { ...args.context, error: sanitizeUnknown(error) });
  }
}
