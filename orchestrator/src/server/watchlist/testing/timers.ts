import { vi } from "vitest";

type TimerModule = typeof import("node:timers/promises");

export function withFakeTimeouts(actual: TimerModule) {
  function setTimeout<T = void>(
    ms?: number,
    value?: T,
    options?: Parameters<TimerModule["setTimeout"]>[2],
  ): Promise<T> {
    if (!vi.isFakeTimers()) return actual.setTimeout(ms, value, options);

    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      signal?.throwIfAborted();
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        // The native overload also allows an omitted value.
        resolve(value as T);
      }, ms);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  return { ...actual, setTimeout };
}
