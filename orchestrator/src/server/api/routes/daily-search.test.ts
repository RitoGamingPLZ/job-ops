import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

/**
 * End to end over a real database: the admin owns one daily switch and hour, while each user
 * keeps their own sources and filters. Only the pipeline itself is mocked, so what it receives
 * shows exactly what the scheduler picked up for whom.
 */
describe("admin-owned daily search for several users", () => {
  let server: Server;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    const { stopPipelineScheduler } = await import("@server/services/pipeline-scheduler");
    stopPipelineScheduler();
    vi.useRealTimers();
    await stopServer({ server, closeDb, tempDir });
  });

  async function seed() {
    const users = await import("@server/repositories/users");
    const settings = await import("@server/repositories/settings");
    const { runWithRequestContext } = await import("@infra/request-context");
    const { saveScheduledSearch } = await import("@server/services/pipeline-scheduler/run-request");

    type Account = Awaited<ReturnType<typeof users.createPrivateWorkspaceUser>>;
    const as = <T>(account: Account, fn: () => T): T =>
      runWithRequestContext({ tenantId: account.workspaceId, userId: account.id }, fn);

    const admin = await users.createPrivateWorkspaceUser({
      username: "admin",
      password: "admin-password",
      isSystemAdmin: true,
      useDefaultTenant: true,
    });
    const alice = await users.createPrivateWorkspaceUser({
      username: "alice",
      password: "alice-password",
    });
    const bob = await users.createPrivateWorkspaceUser({
      username: "bob",
      password: "bob-password",
    });

    // Invited users bring their own AI key, so the scheduled run may start for them.
    for (const account of [alice, bob]) {
      await as(account, () => settings.setSetting("llmApiKey", "test-key"));
    }
    await as(alice, () =>
      saveScheduledSearch({
        sources: ["freehire"],
        searchTerms: ["backend developer"],
        country: "united kingdom",
        cityLocations: ["London"],
        workplaceTypes: ["hybrid"],
        searchScope: "selected_only",
        matchStrictness: "flexible",
        topN: 5,
        minSuitabilityScore: 65,
      }),
    );
    await as(bob, () =>
      saveScheduledSearch({
        sources: ["indeed", "linkedin"],
        searchTerms: ["data engineer", "analytics engineer"],
        country: "united kingdom",
        cityLocations: ["Manchester"],
        workplaceTypes: ["remote"],
        searchScope: "selected_only",
        matchStrictness: "flexible",
        topN: 12,
        minSuitabilityScore: 40,
      }),
    );

    const setAdminSchedule = (enabled: boolean, hour: number) =>
      as(admin, async () => {
        await settings.setSetting("pipelineScheduleEnabled", enabled ? "1" : "0");
        await settings.setSetting("pipelineScheduleHour", String(hour));
      });

    return { as, admin, alice, bob, settings, setAdminSchedule };
  }

  /** Records which workspace each pipeline run was started for, with what it was given. */
  async function capturePipelineRuns() {
    const { runPipeline } = await import("@server/pipeline/index");
    const { getRequestContext } = await import("@infra/request-context");
    const runs: Array<{ tenantId: string | undefined; config: any }> = [];
    vi.mocked(runPipeline).mockImplementation(async (config: any) => {
      runs.push({ tenantId: getRequestContext()?.tenantId, config });
      return { success: true, jobsDiscovered: 0, jobsProcessed: 0 } as any;
    });
    return runs;
  }

  it("runs each user's own search at the admin's 5pm and ignores their own schedule settings", async () => {
    const { startPipelineScheduler } = await import("@server/services/pipeline-scheduler");
    const { alice, bob, as, settings, setAdminSchedule } = await seed();
    await setAdminSchedule(true, 17);
    // Bob tries to run his own search at 9am; only the admin's schedule counts.
    await as(bob, async () => {
      await settings.setSetting("pipelineScheduleEnabled", "1");
      await settings.setSetting("pipelineScheduleHour", "9");
    });
    const runs = await capturePipelineRuns();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 0, 5, 8, 0));
    await startPipelineScheduler();

    // Bob's own 9am hour does not fire anything.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(runs).toHaveLength(0);

    // Nothing runs until 17:00, then both users' searches start.
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 59 * 60 * 1000);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await vi.waitFor(() => expect(runs).toHaveLength(2));

    const forAlice = runs.find((run) => run.tenantId === alice.workspaceId);
    const forBob = runs.find((run) => run.tenantId === bob.workspaceId);
    expect(forAlice?.config).toMatchObject({
      sources: ["freehire"],
      topN: 5,
      minSuitabilityScore: 65,
      locationIntent: {
        selectedCountry: "united kingdom",
        cityLocations: ["London"],
        workplaceTypes: ["hybrid"],
      },
    });
    expect(forBob?.config).toMatchObject({
      sources: ["indeed", "linkedin"],
      topN: 12,
      minSuitabilityScore: 40,
      locationIntent: {
        selectedCountry: "united kingdom",
        cityLocations: ["Manchester"],
        workplaceTypes: ["remote"],
      },
    });

    // The search terms land in each user's own settings, never in the other's.
    const termsOf = (account: typeof alice) =>
      as(account, async () => JSON.parse((await settings.getSetting("searchTerms")) ?? "[]"));
    expect(await termsOf(alice)).toEqual(["backend developer"]);
    expect(await termsOf(bob)).toEqual(["data engineer", "analytics engineer"]);

    // It repeats the next day at the same time.
    runs.length = 0;
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await vi.waitFor(() => expect(runs).toHaveLength(2));
  });

  it("runs nothing when the admin turns the daily search off, whatever the users chose", async () => {
    const { startPipelineScheduler, getNextScheduledPipelineRun } =
      await import("@server/services/pipeline-scheduler");
    const { alice, as, settings, setAdminSchedule } = await seed();
    await setAdminSchedule(false, 17);
    await as(alice, async () => {
      await settings.setSetting("pipelineScheduleEnabled", "1");
      await settings.setSetting("pipelineScheduleHour", "17");
    });
    const runs = await capturePipelineRuns();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 0, 5, 8, 0));
    await startPipelineScheduler();
    expect(await getNextScheduledPipelineRun()).toBeNull();

    await vi.advanceTimersByTimeAsync(26 * 60 * 60 * 1000);
    expect(runs).toHaveLength(0);
  });

  it("starts running once the admin turns it on, without a restart", async () => {
    const { startPipelineScheduler, refreshPipelineScheduler, getNextScheduledPipelineRun } =
      await import("@server/services/pipeline-scheduler");
    const { setAdminSchedule } = await seed();
    await setAdminSchedule(false, 17);
    const runs = await capturePipelineRuns();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 0, 5, 8, 0));
    await startPipelineScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    await setAdminSchedule(true, 17);
    await refreshPipelineScheduler();
    expect(await getNextScheduledPipelineRun()).toBe(new Date(2026, 0, 5, 17).toISOString());
    await vi.advanceTimersByTimeAsync(9 * 60 * 60 * 1000);
    await vi.waitFor(() => expect(runs).toHaveLength(2));
  });

  describe("recovery after a restart", () => {
    const fakeClock = () =>
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "Date"] });
    const at = (hour: number, minute = 0) => vi.setSystemTime(new Date(2026, 0, 5, hour, minute));

    async function finishedRun(account: any, status: "completed" | "failed") {
      const { as } = ctx;
      const pipelineRepo = await import("@server/repositories/pipeline");
      await as(account, async () => {
        const run = await pipelineRepo.createPipelineRun();
        await pipelineRepo.updatePipelineRun(run.id, {
          status,
          completedAt: new Date().toISOString(),
          ...(status === "failed" ? { errorMessage: "interrupted by restart" } : {}),
        });
      });
    }
    let ctx: Awaited<ReturnType<typeof seed>>;

    it("re-queues only the user whose daily run never started", async () => {
      const { catchUpIncompleteScheduledPipelines } =
        await import("@server/services/pipeline-scheduler");
      fakeClock();
      at(16); // both users save their search before the 17:00 hour
      ctx = await seed();
      await ctx.setAdminSchedule(true, 17);
      const runs = await capturePipelineRuns();

      at(17, 5); // Alice's run starts and finishes; the server then restarts and Bob's turn is lost
      await finishedRun(ctx.alice, "completed");
      at(18, 30);

      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(1);
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]?.tenantId).toBe(ctx.bob.workspaceId);
      expect(runs[0]?.config).toMatchObject({ sources: ["indeed", "linkedin"], topN: 12 });

      // Bob's run is now on record, so a later sweep has nothing left to recover.
      await finishedRun(ctx.bob, "completed");
      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(0);
    });

    it("re-runs a search that was interrupted by the restart", async () => {
      const { catchUpIncompleteScheduledPipelines } =
        await import("@server/services/pipeline-scheduler");
      fakeClock();
      at(16);
      ctx = await seed();
      await ctx.setAdminSchedule(true, 17);
      const runs = await capturePipelineRuns();

      at(17, 2);
      await finishedRun(ctx.alice, "completed");
      await finishedRun(ctx.bob, "failed"); // what boot does to a run left "running"
      at(17, 40);

      expect((await catchUpIncompleteScheduledPipelines()).triggeredCount).toBe(1);
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      expect(runs[0]?.tenantId).toBe(ctx.bob.workspaceId);
    });
  });

  it("skips a user who never saved a search", async () => {
    const { startPipelineScheduler } = await import("@server/services/pipeline-scheduler");
    const users = await import("@server/repositories/users");
    const { alice, setAdminSchedule } = await seed();
    await users.createPrivateWorkspaceUser({ username: "carol", password: "carol-password" });
    await setAdminSchedule(true, 17);
    const runs = await capturePipelineRuns();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "Date"] });
    vi.setSystemTime(new Date(2026, 0, 5, 16, 59));
    await startPipelineScheduler();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await vi.waitFor(() => expect(runs).toHaveLength(2));
    expect(runs.map((run) => run.tenantId)).toContain(alice.workspaceId);
  });
});
