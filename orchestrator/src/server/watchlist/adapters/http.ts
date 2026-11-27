import { upstreamError } from "@infra/errors";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_BACKOFF_SCHEDULE_MS = [1000, 3000, 8000] as const;
// Explicitly global public ATS host-level crawl pacing, independent of tenants.
const hostNextRequestAt = new Map<string, number>();

export interface SoftDeadline {
  signal: AbortSignal;
  stopAt: number;
  hasTimeLeft: () => boolean;
  remainingMs: () => number;
}

export interface FetchWatchlistContext {
  attempt: number;
  response: Response;
  retryAfterMs: number | null;
  hasRetryAfterHeader: boolean;
}

export interface FetchWatchlistOptions<TResponse extends "json" | "text" | "response" = "json"> {
  url: string | URL;
  signal: AbortSignal;
  headers?: HeadersInit;
  redirect?: RequestRedirect;
  paceMs?: number;
  maxRetries?: number | ((ctx: FetchWatchlistContext) => number);
  retryDelayMs?: (ctx: FetchWatchlistContext) => number;
  retryAfterMaxMs?: number;
  failFastRetryAfterMs?: number;
  backoffScheduleMs?: readonly number[];
  onRateLimit?: (ctx: FetchWatchlistContext) => void | Promise<void>;
  responseType?: TResponse;
  formatHttpError?: (ctx: {
    status: number;
    response: Response;
    attempt: number;
    url: URL;
  }) => Error | Promise<Error>;
  formatInvalidBodyError?: (error: unknown) => Error;
}

export function createBudgetSignal(signal?: AbortSignal, timeoutMs = 25_000): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createSoftDeadline(
  signal: AbortSignal | undefined,
  options: { hardMs?: number; softMs: number; abortAtSoft?: boolean },
): SoftDeadline {
  const hardSignal = createBudgetSignal(signal, options.hardMs ?? 25_000);
  const combined =
    options.abortAtSoft === false
      ? hardSignal
      : AbortSignal.any([hardSignal, AbortSignal.timeout(options.softMs)]);
  const stopAt = Date.now() + options.softMs;
  return {
    signal: combined,
    stopAt,
    hasTimeLeft: () => Date.now() < stopAt,
    remainingMs: () => Math.max(0, stopAt - Date.now()),
  };
}

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | null {
  const trimmed = header?.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(trimmed);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - now) : null;
}

export async function fetchWatchlist(
  options: Omit<FetchWatchlistOptions<"response">, "responseType"> & {
    responseType: "response";
  },
): Promise<Response>;
export async function fetchWatchlist(
  options: Omit<FetchWatchlistOptions<"text">, "responseType"> & {
    responseType: "text";
  },
): Promise<string>;
export async function fetchWatchlist(
  options: Omit<FetchWatchlistOptions<"json">, "responseType"> & {
    responseType?: "json";
  },
): Promise<unknown>;
export async function fetchWatchlist(
  options: FetchWatchlistOptions<"json" | "text">,
): Promise<unknown>;
export async function fetchWatchlist(
  options: FetchWatchlistOptions<"json" | "text" | "response">,
): Promise<unknown> {
  const url = options.url instanceof URL ? options.url : new URL(options.url);
  const maxRetriesOption = options.maxRetries ?? 3;
  const backoff = options.backoffScheduleMs ?? DEFAULT_BACKOFF_SCHEDULE_MS;

  for (let attempt = 0; ; attempt += 1) {
    options.signal.throwIfAborted();

    if (options.paceMs && options.paceMs > 0) {
      const host = url.hostname;
      const now = Date.now();
      const start = Math.max(now, hostNextRequestAt.get(host) ?? 0);
      hostNextRequestAt.set(host, start + options.paceMs);
      if (start > now) {
        await delay(start - now, undefined, { signal: options.signal });
      }
      options.signal.throwIfAborted();
    }

    const response = await fetch(options.url, {
      signal: options.signal,
      redirect: options.redirect ?? "manual",
      ...(options.headers ? { headers: options.headers } : {}),
    });

    const hasRetryAfterHeader = Boolean(response.headers?.has("retry-after"));
    const retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after") ?? null);
    const ctx: FetchWatchlistContext = { attempt, response, retryAfterMs, hasRetryAfterHeader };

    if (response.status === 429 && options.onRateLimit) {
      await options.onRateLimit(ctx);
    }

    const maxRetries =
      typeof maxRetriesOption === "function" ? maxRetriesOption(ctx) : maxRetriesOption;

    if (response.status === 429 && attempt < maxRetries) {
      if (!response.bodyUsed) void response.body?.cancel().catch(() => {});
      if (
        options.failFastRetryAfterMs !== undefined &&
        retryAfterMs !== null &&
        retryAfterMs > options.failFastRetryAfterMs
      ) {
        throw options.formatHttpError
          ? await options.formatHttpError({ status: response.status, response, attempt, url })
          : upstreamError(`Upstream returned HTTP ${response.status}.`);
      }

      let waitMs: number;
      if (options.retryDelayMs) {
        waitMs = options.retryDelayMs(ctx);
      } else if (retryAfterMs !== null) {
        waitMs =
          options.retryAfterMaxMs !== undefined
            ? Math.min(options.retryAfterMaxMs, retryAfterMs)
            : retryAfterMs;
      } else {
        waitMs = backoff[Math.min(attempt, backoff.length - 1)] ?? 0;
      }
      await delay(Math.max(0, waitMs), undefined, { signal: options.signal });
      continue;
    }

    if (!response.ok) {
      const error = options.formatHttpError
        ? await options.formatHttpError({ status: response.status, response, attempt, url })
        : upstreamError(`Upstream returned HTTP ${response.status}.`);
      if (!response.bodyUsed) void response.body?.cancel().catch(() => {});
      throw error;
    }

    if (options.responseType === "response") return response;

    try {
      return options.responseType === "text" ? await response.text() : await response.json();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw error;
      }
      options.signal.throwIfAborted();
      if (options.formatInvalidBodyError) {
        throw options.formatInvalidBodyError(error);
      }
      throw upstreamError("Upstream returned an invalid response.");
    }
  }
}
