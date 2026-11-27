import { getCachedAuthHeader, recoverAuthHeaderAfterUnauthorized } from "@client/api/client";
import { readSseFrames } from "./sse-frames";

interface EventSourceSubscriptionHandlers<T> {
  onOpen?: () => void;
  onMessage: (payload: T) => void;
  onError?: () => void;
}

export function subscribeToEventSource<T>(
  url: string,
  handlers: EventSourceSubscriptionHandlers<T>,
): () => void {
  const controller = new AbortController();
  let isClosed = false;

  void (async () => {
    let authHeader = getCachedAuthHeader();
    let authAttempt = 0;

    while (!isClosed) {
      try {
        const response = await fetch(url, {
          headers: authHeader ? { Authorization: authHeader } : undefined,
          signal: controller.signal,
        });

        if (response.status === 401 && authAttempt < 1) {
          const recoveredAuthHeader = await recoverAuthHeaderAfterUnauthorized();
          if (!recoveredAuthHeader) {
            handlers.onError?.();
            return;
          }

          authHeader = recoveredAuthHeader;
          authAttempt += 1;
          continue;
        }

        if (!response.ok || !response.body) {
          handlers.onError?.();
          return;
        }

        handlers.onOpen?.();

        await readSseFrames<T>(
          response.body,
          (event) => {
            try {
              handlers.onMessage(event);
            } catch {
              // A subscriber error should not stop the progress stream.
            }
          },
          controller.signal,
        );

        return;
      } catch {
        if (!isClosed && !controller.signal.aborted) {
          handlers.onError?.();
        }
        return;
      }
    }
  })();

  return () => {
    isClosed = true;
    controller.abort();
  };
}
