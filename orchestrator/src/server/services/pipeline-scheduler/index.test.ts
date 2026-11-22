import { getRequestContext, runWithRequestContext } from "@infra/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getLatestPipelineRun: vi.fn(),
  listOwners: vi.fn(),
  load: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  hosted: vi.fn(),
}));
vi.mock("@server/repositories/settings", () => ({
  getSetting: mocks.getSetting,
}));
vi.mock("@server/repositories/pipeline", () => ({
  getLatestPipelineRun: mocks.getLatestPipelineRun,
}));
vi.mock("./storage", () => ({
  listScheduleOwners: mocks.listOwners,
  loadRunRequest: mocks.load,
}));
vi.mock("./run-request", () => ({
  runPipelineSchema: { parse: (value: unknown) => value },
  startRequestedPipeline: mocks.start,
}));
vi.mock("@server/pipeline/index", () => ({ getPipelineStatus: mocks.status }));
vi.mock("@server/config/demo", () => ({ isDemoMode: () => false }));
vi.mock("@server/tenancy/private-scope", async () => {
  const { getRequestContext } = await import("@infra/request-context");
  return {
    isHostedUserIsolationEnabled: mocks.hosted,
    getPrivateDataScope: () => {
      const ctx = getRequestContext();
      return { scopeKey: `${ctx?.tenantId}:${ctx?.userId}` };
    },
  };
});

import {
  getNextScheduledPipelineRun,
  nextDailyFireTime,
  refreshPipelineScheduler,
  runDueScheduledPipelinesForHour,
  runScheduledPipeline,
  startPipelineScheduler,
  stopPipelineScheduler,
} from "./index";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 5, 6));
  vi.clearAllMocks();
  mocks.hosted.mockReturnValue(true);
  mocks.getSetting.mockImplementation(async (key) =>
    key === "pipelineScheduleEnabled" ? "1" : "7",
  );
  mocks.listOwners.mockResolvedValue([{ tenantId: "tenant-a", userId: "alice" }]);
  mocks.load.mockResolvedValue({
    sources: ["indeed"],
    topN: 5,
    searchTerms: ["developer"],
    watchlistSelectedSourceIds: ["apple:software"],
  });
  mocks.status.mockReturnValue({ isRunning: false });
  mocks.start.mockResolvedValue(undefined);
  mocks.getLatestPipelineRun.mockResolvedValue(null);
});
afterEach(() => {
  stopPipelineScheduler();
  vi.useRealTimers();
});

describe("daily pipeline scheduler", () => {
  it("fires today before the hour, tomorrow at or after the hour", () => {
    expect(nextDailyFireTime(7, new Date(2026, 0, 5, 6, 59))).toEqual(new Date(2026, 0, 5, 7));
    expect(nextDailyFireTime(7, new Date(2026, 0, 5, 7))).toEqual(new Date(2026, 0, 6, 7));
    expect(nextDailyFireTime(7, new Date(2026, 0, 5, 23))).toEqual(new Date(2026, 0, 6, 7));
  });
  it("uses local calendar days across DST transitions", () => {
    for (const now of [new Date(2026, 2, 7, 12), new Date(2026, 9, 31, 12)]) {
      const expected = new Date(now);
      expected.setDate(expected.getDate() + 1);
      expected.setHours(7, 0, 0, 0);
      expect(nextDailyFireTime(7, now)).toEqual(expected);
    }
  });
  it("skips an existing pipeline without loading or launching defaults", async () => {
    mocks.status.mockReturnValue({ isRunning: true });
    await runScheduledPipeline();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("skips until a manual run has saved a request", async () => {
    mocks.load.mockResolvedValue(null);
    await runScheduledPipeline();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("reschedules after settings change and stops when disabled", async () => {
    await startPipelineScheduler();
    expect(vi.getTimerCount()).toBe(1);
    mocks.getSetting.mockImplementation(async (key) =>
      key === "pipelineScheduleEnabled" ? "1" : "8",
    );
    await refreshPipelineScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mocks.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mocks.start).toHaveBeenCalledWith(await mocks.load(), false);
    expect(vi.getTimerCount()).toBe(1);
    mocks.listOwners.mockResolvedValue([]);
    await refreshPipelineScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("runs each opted-in tenant and user with its own context and defaults", async () => {
    mocks.listOwners.mockResolvedValue([
      { tenantId: "a", userId: "alice" },
      { tenantId: "a", userId: "bob" },
      { tenantId: "b", userId: "alice" },
      { tenantId: "b", userId: null },
    ]);
    mocks.load.mockImplementation(async () => ({
      searchTerms: [getRequestContext()?.tenantId, getRequestContext()?.userId],
    }));
    const seen: unknown[] = [];
    mocks.start.mockImplementation(async (request) => {
      seen.push({ request, context: getRequestContext() });
    });
    await startPipelineScheduler();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(seen).toHaveLength(3);
    expect(seen).toEqual(
      expect.arrayContaining([
        {
          request: { searchTerms: ["a", "alice"] },
          context: expect.objectContaining({
            tenantId: "a",
            userId: "alice",
            requestId: expect.any(String),
          }),
        },
        {
          request: { searchTerms: ["a", "bob"] },
          context: expect.objectContaining({ tenantId: "a", userId: "bob" }),
        },
        {
          request: { searchTerms: ["b", "alice"] },
          context: expect.objectContaining({ tenantId: "b", userId: "alice" }),
        },
      ]),
    );
  });
  it("logs failures and keeps the next daily timer", async () => {
    mocks.start.mockRejectedValue(new Error("test failure"));
    await startPipelineScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
  it("reports ISO next run only when enabled", async () => {
    expect(
      await runWithRequestContext({ tenantId: "a", userId: "alice" }, getNextScheduledPipelineRun),
    ).toBe(new Date(2026, 0, 5, 7).toISOString());
    mocks.getSetting.mockResolvedValue("0");
    expect(await getNextScheduledPipelineRun()).toBeNull();
  });

  it("triggers only schedules matching the target hour via runDueScheduledPipelinesForHour", async () => {
    mocks.listOwners.mockResolvedValue([
      { tenantId: "a", userId: "alice" },
      { tenantId: "b", userId: "bob" },
    ]);
    mocks.getSetting.mockImplementation(async (key) => {
      const ctx = getRequestContext();
      if (key === "pipelineScheduleEnabled") return "1";
      return ctx?.userId === "alice" ? "7" : "9";
    });

    const skipResult = await runDueScheduledPipelinesForHour(8);
    expect(skipResult).toEqual({
      hour: 8,
      evaluatedCount: 2,
      triggeredCount: 0,
    });
    expect(mocks.start).not.toHaveBeenCalled();

    const matchResult = await runDueScheduledPipelinesForHour(7);
    expect(matchResult).toEqual({
      hour: 7,
      evaluatedCount: 2,
      triggeredCount: 1,
    });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
  });

  it("triggers a catch-up run when today's latest run failed and the scheduled hour has passed", async () => {
    vi.setSystemTime(new Date(2026, 0, 5, 9));
    mocks.listOwners.mockResolvedValue([
      { tenantId: "a", userId: "alice" },
      { tenantId: "b", userId: "bob" },
    ]);
    mocks.getSetting.mockImplementation(async (key) => {
      if (key === "pipelineScheduleEnabled") return "1";
      return "7";
    });
    mocks.getLatestPipelineRun.mockImplementation(async () => {
      const ctx = getRequestContext();
      if (ctx?.tenantId === "a") {
        return {
          id: "run-failed-today",
          startedAt: new Date(2026, 0, 5, 7, 5).toISOString(),
          completedAt: new Date(2026, 0, 5, 7, 10).toISOString(),
          status: "failed",
          jobsDiscovered: 0,
          jobsProcessed: 0,
          errorMessage: "interrupted by restart",
          configSnapshot: null,
        };
      }
      return {
        id: "run-completed-today",
        startedAt: new Date(2026, 0, 5, 7, 0).toISOString(),
        completedAt: new Date(2026, 0, 5, 7, 15).toISOString(),
        status: "completed",
        jobsDiscovered: 5,
        jobsProcessed: 5,
        errorMessage: null,
        configSnapshot: null,
      };
    });

    const result = await runDueScheduledPipelinesForHour(9);
    expect(result).toEqual({
      hour: 9,
      evaluatedCount: 2,
      triggeredCount: 1,
    });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
  });

  it("does not trigger catch-up before the scheduled hour or for yesterday's failed run", async () => {
    vi.setSystemTime(new Date(2026, 0, 5, 9));
    mocks.listOwners.mockResolvedValue([
      { tenantId: "a", userId: "alice" },
      { tenantId: "b", userId: "bob" },
    ]);
    mocks.getSetting.mockImplementation(async (key) => {
      const ctx = getRequestContext();
      if (key === "pipelineScheduleEnabled") return "1";
      return ctx?.tenantId === "a" ? "11" : "7";
    });
    mocks.getLatestPipelineRun.mockImplementation(async () => {
      const ctx = getRequestContext();
      if (ctx?.tenantId === "a") {
        return {
          id: "run-failed-before-hour",
          startedAt: new Date(2026, 0, 5, 6, 0).toISOString(),
          completedAt: new Date(2026, 0, 5, 6, 5).toISOString(),
          status: "failed",
          jobsDiscovered: 0,
          jobsProcessed: 0,
          errorMessage: "manual failure",
          configSnapshot: null,
        };
      }
      return {
        id: "run-failed-yesterday",
        startedAt: new Date(2026, 0, 4, 7, 0).toISOString(),
        completedAt: new Date(2026, 0, 4, 7, 5).toISOString(),
        status: "failed",
        jobsDiscovered: 0,
        jobsProcessed: 0,
        errorMessage: "interrupted by restart",
        configSnapshot: null,
      };
    });

    const result = await runDueScheduledPipelinesForHour(9);
    expect(result).toEqual({
      hour: 9,
      evaluatedCount: 2,
      triggeredCount: 0,
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
