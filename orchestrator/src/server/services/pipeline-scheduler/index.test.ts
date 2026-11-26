import { serviceUnavailable } from "@infra/errors";
import { getRequestContext, runWithRequestContext } from "@infra/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getLatestPipelineRun: vi.fn(),
  runsSince: vi.fn(),
  listOwners: vi.fn(),
  listRequestOwners: vi.fn(),
  adminTenant: vi.fn(),
  load: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  active: vi.fn(),
  hosted: vi.fn(),
}));
vi.mock("@server/repositories/settings", () => ({
  getSetting: mocks.getSetting,
}));
vi.mock("@server/repositories/pipeline", () => ({
  getLatestPipelineRun: mocks.getLatestPipelineRun,
  getPipelineRunsSince: mocks.runsSince,
}));
vi.mock("@server/repositories/users", () => ({
  getSystemAdminTenantId: mocks.adminTenant,
}));
vi.mock("./storage", () => ({
  listScheduleOwners: mocks.listOwners,
  listRunRequestOwners: mocks.listRequestOwners,
  loadRunRequest: mocks.load,
}));
vi.mock("./run-request", () => ({
  readMaxConcurrentPipelines: () => 3,
  runPipelineSchema: { parse: (value: unknown) => value },
  startRequestedPipeline: mocks.start,
}));
vi.mock("@server/pipeline/index", () => ({
  getPipelineStatus: mocks.status,
  getActivePipelineCount: mocks.active,
}));
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
  catchUpIncompleteScheduledPipelines,
  getNextScheduledPipelineRun,
  nextDailyFireTime,
  refreshPipelineScheduler,
  runDueScheduledPipelinesForHour,
  runScheduledPipeline,
  startIncompleteSearchRecovery,
  startPipelineScheduler,
  __stopPipelineSchedulerForTests,
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
  mocks.active.mockReturnValue(0);
  mocks.start.mockResolvedValue(undefined);
  mocks.getLatestPipelineRun.mockResolvedValue(null);
});
afterEach(() => {
  __stopPipelineSchedulerForTests();
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
  it("covers every saved Watchlist source, ignoring the last manual selection", async () => {
    for (const saved of [["apple:software"], []]) {
      mocks.start.mockClear();
      mocks.load.mockResolvedValue({
        sources: ["indeed"],
        topN: 5,
        searchTerms: ["developer"],
        watchlistSelectedSourceIds: saved,
      });
      await runScheduledPipeline();
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(mocks.start.mock.calls[0]?.[0].watchlistSelectedSourceIds).toBeUndefined();
    }
  });
  it("skips until a manual run has saved a request", async () => {
    mocks.load.mockResolvedValue(null);
    await runScheduledPipeline();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("filters retired sources from saved scheduled pipeline requests", async () => {
    mocks.load.mockResolvedValue({
      sources: ["gradcracker", "linkedin"],
      topN: 5,
      searchTerms: ["developer"],
    });
    await runScheduledPipeline();
    expect(mocks.start).toHaveBeenCalledWith(
      {
        sources: ["linkedin"],
        topN: 5,
        searchTerms: ["developer"],
        watchlistSelectedSourceIds: undefined,
      },
      false,
    );

    mocks.start.mockClear();
    mocks.load.mockResolvedValue({
      sources: ["gradcracker", "ukvisajobs"],
      topN: 5,
      searchTerms: ["developer"],
    });
    await runScheduledPipeline();
    expect(mocks.start).toHaveBeenCalledWith(
      {
        topN: 5,
        searchTerms: ["developer"],
        watchlistSelectedSourceIds: undefined,
      },
      false,
    );
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
    expect(mocks.start).toHaveBeenCalledWith(
      { ...(await mocks.load()), watchlistSelectedSourceIds: undefined },
      false,
    );
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

describe("admin-owned daily search outside hosted mode", () => {
  beforeEach(() => {
    mocks.hosted.mockReturnValue(false);
    mocks.adminTenant.mockResolvedValue("tenant-admin");
    // Only the admin's workspace has the schedule on; users' own values must be ignored.
    mocks.getSetting.mockImplementation(async (key) => {
      const onForAdmin = getRequestContext()?.tenantId === "tenant-admin";
      if (key === "pipelineScheduleEnabled") return onForAdmin ? "1" : "0";
      return onForAdmin ? "7" : "3";
    });
    mocks.listRequestOwners.mockResolvedValue([
      { tenantId: "a", userId: null },
      { tenantId: "b", userId: null },
    ]);
  });

  it("runs every workspace with a saved search at the admin's hour", async () => {
    const seen: unknown[] = [];
    mocks.load.mockImplementation(async () => ({ searchTerms: [getRequestContext()?.tenantId] }));
    mocks.start.mockImplementation(async (request) => {
      seen.push({ request, tenantId: getRequestContext()?.tenantId });
    });
    await startPipelineScheduler();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    expect(seen).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    // The start order rotates daily, so only the pairing of each request with its workspace counts.
    expect(seen).toHaveLength(2);
    expect(seen).toEqual(
      expect.arrayContaining([
        { request: { searchTerms: ["a"] }, tenantId: "a" },
        { request: { searchTerms: ["b"] }, tenantId: "b" },
      ]),
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("picks up workspaces that save a search after the scheduler started", async () => {
    mocks.listRequestOwners.mockResolvedValue([]);
    await startPipelineScheduler();
    mocks.listRequestOwners.mockResolvedValue([{ tenantId: "late", userId: null }]);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing while the admin has it off or there is no admin", async () => {
    mocks.getSetting.mockResolvedValue("0");
    await startPipelineScheduler();
    expect(vi.getTimerCount()).toBe(0);
    mocks.getSetting.mockImplementation(async (key) =>
      key === "pipelineScheduleEnabled" ? "1" : "7",
    );
    mocks.adminTenant.mockResolvedValue(null);
    await refreshPipelineScheduler();
    expect(vi.getTimerCount()).toBe(0);
    expect(await getNextScheduledPipelineRun()).toBeNull();
  });

  it("reports the admin's next run to every user", async () => {
    expect(
      await runWithRequestContext({ tenantId: "a", userId: "alice" }, getNextScheduledPipelineRun),
    ).toBe(new Date(2026, 0, 5, 7).toISOString());
  });

  it("waits for a free scraper slot instead of dropping a workspace", async () => {
    mocks.start
      .mockRejectedValueOnce(serviceUnavailable("Other searches are using the scrapers"))
      .mockResolvedValue(undefined);
    await startPipelineScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 1000);
    // The first workspace retried and succeeded, then the second ran.
    expect(mocks.start).toHaveBeenCalledTimes(3);
  });

  it("coordinates 50 workspaces through the shared scraper slots", async () => {
    const owners = Array.from({ length: 50 }, (_, i) => ({ tenantId: `t${i}`, userId: null }));
    mocks.listRequestOwners.mockResolvedValue(owners);
    let active = 0;
    let peak = 0;
    const startedTenants: Array<string | undefined> = [];
    mocks.active.mockImplementation(() => active);
    mocks.start.mockImplementation(async () => {
      startedTenants.push(getRequestContext()?.tenantId);
      active++;
      peak = Math.max(peak, active);
      // Each search holds its scraper slot for ten minutes.
      setTimeout(() => active--, 10 * 60 * 1000);
    });
    await startPipelineScheduler();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);

    // Everyone ran exactly once, and never more than the cap (3) minus the slot kept for manual runs.
    expect(startedTenants).toHaveLength(50);
    expect(new Set(startedTenants).size).toBe(50);
    expect(peak).toBe(2);
  });

  it("ignores a second trigger while the first queue is still waiting", async () => {
    mocks.active.mockReturnValue(99);
    await runDueScheduledPipelinesForHour(7);
    await runDueScheduledPipelinesForHour(7);
    mocks.active.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("moves on after another kind of failure", async () => {
    mocks.start.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    await startPipelineScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  describe("recovery of incomplete searches", () => {
    const run = (status: string) => ({
      id: `run-${status}`,
      startedAt: new Date(2026, 0, 5, 17, 5).toISOString(),
      completedAt: null,
      status,
      jobsDiscovered: 0,
      jobsProcessed: 0,
      errorMessage: null,
      configSnapshot: null,
    });
    // 17:00 is the admin's hour; the sweep runs at 18:30 after a restart lost the queue.
    const evening = () => vi.setSystemTime(new Date(2026, 0, 5, 18, 30));
    const adminAtFive = () =>
      mocks.getSetting.mockImplementation(async (key) => {
        const isAdmin = getRequestContext()?.tenantId === "tenant-admin";
        if (key === "pipelineScheduleEnabled") return isAdmin ? "1" : "0";
        return isAdmin ? "17" : "3";
      });
    const startCount = () => mocks.start.mock.calls.length;

    beforeEach(() => {
      adminAtFive();
      evening();
      mocks.runsSince.mockResolvedValue([]);
    });

    it("re-queues only the workspaces with no finished or running run since the hour", async () => {
      mocks.runsSince.mockImplementation(async () => {
        const tenant = getRequestContext()?.tenantId;
        if (tenant === "a") return []; // never started: the queue was lost
        if (tenant === "b") return [run("completed")];
        return [run("running")];
      });
      mocks.listRequestOwners.mockResolvedValue([
        { tenantId: "a", userId: null },
        { tenantId: "b", userId: null },
        { tenantId: "c", userId: null },
      ]);
      const seen: Array<string | undefined> = [];
      mocks.start.mockImplementation(async () => {
        seen.push(getRequestContext()?.tenantId);
      });

      expect(await catchUpIncompleteScheduledPipelines()).toEqual({
        evaluatedCount: 3,
        triggeredCount: 1,
      });
      await vi.waitFor(() => expect(seen).toEqual(["a"]));
    });

    it("retries a search whose only runs failed, at most three times a day", async () => {
      mocks.runsSince.mockResolvedValue([run("failed")]);
      mocks.listRequestOwners.mockResolvedValue([{ tenantId: "a", userId: null }]);
      for (let sweep = 1; sweep <= 3; sweep++) {
        expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(1);
        await vi.waitFor(() => expect(startCount()).toBe(sweep));
        // Let the queue finish, otherwise the next sweep is skipped as "still draining".
        await vi.advanceTimersByTimeAsync(10);
      }
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(0);
      // A new day starts the count again.
      vi.setSystemTime(new Date(2026, 0, 6, 18, 30));
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(1);
    });

    it("waits for the hour, and for tomorrow when the search was saved after it", async () => {
      mocks.listRequestOwners.mockResolvedValue([
        { tenantId: "a", userId: null, requestSavedAt: new Date(2026, 0, 5, 17, 30).toISOString() },
      ]);
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(0);

      mocks.listRequestOwners.mockResolvedValue([
        { tenantId: "a", userId: null, requestSavedAt: new Date(2026, 0, 4, 9).toISOString() },
      ]);
      vi.setSystemTime(new Date(2026, 0, 5, 16, 30));
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(0);
      evening();
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(1);
    });

    it("does nothing while the admin has the daily search off", async () => {
      mocks.getSetting.mockResolvedValue("0");
      mocks.listRequestOwners.mockResolvedValue([{ tenantId: "a", userId: null }]);
      expect(await catchUpIncompleteScheduledPipelines()).toEqual({
        evaluatedCount: 0,
        triggeredCount: 0,
      });
      expect(mocks.start).not.toHaveBeenCalled();
    });

    it("does not stack a second queue on one that is still waiting for slots", async () => {
      mocks.listRequestOwners.mockResolvedValue([{ tenantId: "a", userId: null }]);
      mocks.active.mockReturnValue(99);
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(1);
      expect(await catchUpIncompleteScheduledPipelines()).toEqual({
        evaluatedCount: 0,
        triggeredCount: 0,
      });
      mocks.active.mockReturnValue(0);
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(mocks.start).toHaveBeenCalledTimes(1);
    });

    it("sweeps shortly after boot and then every hour", async () => {
      mocks.listRequestOwners.mockResolvedValue([{ tenantId: "a", userId: null }]);
      mocks.runsSince
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([run("completed")])
        .mockResolvedValue([run("failed")]);
      startIncompleteSearchRecovery();
      await vi.advanceTimersByTimeAsync(59 * 1000);
      expect(mocks.start).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2 * 1000); // boot sweep: never started -> run
      expect(mocks.start).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // done by now -> nothing
      expect(mocks.start).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // failed -> retried
      expect(mocks.start).toHaveBeenCalledTimes(2);
      __stopPipelineSchedulerForTests();
      await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
      expect(mocks.start).toHaveBeenCalledTimes(2);
    });
  });

  it("runs the webhook-triggered hour for every workspace with a saved search", async () => {
    expect(await runDueScheduledPipelinesForHour(3)).toEqual({
      hour: 3,
      evaluatedCount: 2,
      triggeredCount: 0,
    });
    expect(await runDueScheduledPipelinesForHour(7)).toEqual({
      hour: 7,
      evaluatedCount: 2,
      triggeredCount: 2,
    });
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
  });
});
