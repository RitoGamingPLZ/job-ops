import { setTimeout as delay } from "node:timers/promises";

export function watchlistRequestSignal(signal?: AbortSignal, timeoutMs = 25_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function fetchWithThrottleRetry(
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    init.signal.throwIfAborted();
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt === 3) return response;
    await response.body?.cancel();
    await delay(250 * 2 ** attempt, undefined, { signal: init.signal });
  }
}
