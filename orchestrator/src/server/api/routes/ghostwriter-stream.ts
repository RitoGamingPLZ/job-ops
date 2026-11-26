import { toAppError } from "@infra/errors";
import { ok } from "@infra/http";
import { setupSse, writeSseData } from "@infra/sse";
import type * as ghostwriterService from "@server/services/ghostwriter";
import type { Response } from "express";

type GhostwriterStream = NonNullable<
  Parameters<typeof ghostwriterService.sendMessageForJob>[0]["stream"]
>;

async function streamGhostwriterReply(
  res: Response,
  run: (stream: GhostwriterStream) => Promise<unknown>,
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
          threadId,
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

/**
 * Runs a ghostwriter reply either as an SSE stream or as a plain JSON response. `run` receives the
 * stream callbacks when streaming and `undefined` otherwise; `toBody` shapes the JSON response.
 */
export async function respondWithGhostwriterReply<T>(
  res: Response,
  options: {
    stream?: boolean;
    toBody?: (result: T) => unknown;
  },
  run: (stream?: GhostwriterStream) => Promise<T>,
): Promise<void> {
  if (options.stream) {
    await streamGhostwriterReply(res, (stream) => run(stream));
    return;
  }

  const result = await run();
  ok(res, options.toBody ? options.toBody(result) : result);
}
