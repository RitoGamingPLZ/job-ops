import { toAppError } from "@infra/errors";
import { setupSse, writeSseData } from "@infra/sse";
import type * as ghostwriterService from "@server/services/ghostwriter";
import type { Response } from "express";

type GhostwriterStream = NonNullable<
  Parameters<typeof ghostwriterService.sendMessageForJob>[0]["stream"]
>;

export async function streamGhostwriterReply(
  res: Response,
  run: (stream: GhostwriterStream) => Promise<unknown>,
  readyThreadId?: string,
): Promise<void> {
  setupSse(res, {
    cacheControl: "no-cache, no-transform",
    flushHeaders: true,
  });

  try {
    await run({
      onReady: ({ runId, threadId, messageId, requestId }) =>
        writeSseData(res, {
          type: "ready",
          runId,
          threadId: readyThreadId ?? threadId,
          messageId,
          requestId,
        }),
      onDelta: ({ runId, messageId, delta }) =>
        writeSseData(res, {
          type: "delta",
          runId,
          messageId,
          delta,
        }),
      onCompleted: ({ runId, message }) =>
        writeSseData(res, {
          type: "completed",
          runId,
          message,
        }),
      onCancelled: ({ runId, message }) =>
        writeSseData(res, {
          type: "cancelled",
          runId,
          message,
        }),
      onError: ({ runId, code, message, requestId }) =>
        writeSseData(res, {
          type: "error",
          runId,
          code,
          message,
          requestId,
        }),
    });
  } catch (error) {
    const appError = toAppError(error);
    writeSseData(res, {
      type: "error",
      code: appError.code,
      message: appError.message,
      requestId: res.getHeader("x-request-id") || "unknown",
    });
  } finally {
    res.end();
  }
}
