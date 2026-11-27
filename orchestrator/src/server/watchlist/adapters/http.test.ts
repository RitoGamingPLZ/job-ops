import { parseRetryAfterMs } from "./http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchStub, installFakeAbortSignalTimeout, jsonResponse } from "../testing/fixtures";

vi.mock("node:timers/promises", async (importOriginal) => {
  const { withFakeTimeouts } = await import("../testing/timers");
  return withFakeTimeouts(await importOriginal<typeof import("node:timers/promises")>());
});

let http: typeof import("./http");

beforeEach(async () => {
  vi.resetModules();
  http = await import("./http");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("watchlist http helpers", () => {
  it("parses numeric and HTTP-date Retry-After headers and rejects blanks", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs("   ", now)).toBeNull();
    expect(parseRetryAfterMs("0", now)).toBe(0);
    expect(parseRetryAfterMs("2.5", now)).toBe(2500);
    expect(parseRetryAfterMs("-5", now)).toBe(0);
    expect(parseRetryAfterMs(new Date(now + 4000).toUTCString(), now)).toBe(4000);
    expect(parseRetryAfterMs(new Date(0).toUTCString(), now)).toBe(0);
    expect(parseRetryAfterMs("not-a-date", now)).toBeNull();
  });

  it("creates 25s budget signals and soft deadlines with configurable abortAtSoft", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const timeoutSpy = installFakeAbortSignalTimeout();
    const caller = new AbortController();

    const soft = http.createSoftDeadline(caller.signal, { hardMs: 24_000, softMs: 20_000 });
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 24_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 20_000);
    expect(soft.hasTimeLeft()).toBe(true);
    expect(soft.remainingMs()).toBe(20_000);

    vi.setSystemTime(1_020_000);
    expect(soft.hasTimeLeft()).toBe(false);
    expect(soft.remainingMs()).toBe(0);

    timeoutSpy.mockClear();
    const nonAbortingSoft = http.createSoftDeadline(undefined, {
      hardMs: 25_000,
      softMs: 20_000,
      abortAtSoft: false,
    });
    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(25_000);
    expect(nonAbortingSoft.signal.aborted).toBe(false);
  });

  it("retries 429s with Retry-After clamps, fail-fast thresholds, and backoff", async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchStub(
      new Response("limit", { status: 429, headers: { "retry-after": "60" } }),
      jsonResponse({ ok: true }),
    );

    const pending = http.fetchWatchlist({
      url: "https://boards.example.com/jobs",
      signal: http.createBudgetSignal(),
      maxRetries: 3,
      retryAfterMaxMs: 5_000,
      backoffScheduleMs: [1000, 3000],
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: true });

    createFetchStub(new Response("secret", { status: 429, headers: { "retry-after": "15" } }));
    await expect(
      http.fetchWatchlist({
        url: "https://boards.example.com/jobs",
        signal: http.createBudgetSignal(),
        failFastRetryAfterMs: 10_000,
      }),
    ).rejects.toMatchObject({ status: 502, message: "Upstream returned HTTP 429." });
  });

  it("paces concurrent requests to the same hostname", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        starts.push(Date.now());
        return jsonResponse({ ok: true });
      }),
    );

    const signal = http.createBudgetSignal();
    const pending = Promise.all([
      http.fetchWatchlist({ url: "https://api.example.com/a", signal, paceMs: 1_000 }),
      http.fetchWatchlist({ url: "https://api.example.com/b", signal, paceMs: 1_000 }),
    ]);
    await vi.runAllTimersAsync();
    await pending;
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBe(1_000);
  });

  it("preserves AbortError and TimeoutError while sanitizing invalid JSON", async () => {
    for (const name of ["AbortError", "TimeoutError"] as const) {
      const error = new Error("interrupted");
      error.name = name;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(error) }),
      );
      await expect(
        http.fetchWatchlist({
          url: "https://boards.example.com/jobs",
          signal: new AbortController().signal,
        }),
      ).rejects.toBe(error);
    }

    createFetchStub(new Response("not-json"));
    await expect(
      http.fetchWatchlist({
        url: "https://boards.example.com/jobs",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 502, message: "Upstream returned an invalid response." });
  });
});
