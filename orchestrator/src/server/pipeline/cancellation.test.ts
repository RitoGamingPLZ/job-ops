import { useSqliteTestDb } from "../testing/sqlite-test-db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stepState = vi.hoisted(() => {
  let resolveDiscover:
    | ((value: { discoveredJobs: []; sourceErrors: []; pendingChallenges: [] }) => void)
    | null = null;
  return {
    setResolver: (
      fn: (value: { discoveredJobs: []; sourceErrors: []; pendingChallenges: [] }) => void,
    ) => {
      resolveDiscover = fn;
    },
    resolveDiscover: () =>
      resolveDiscover?.({
        discoveredJobs: [],
        sourceErrors: [],
        pendingChallenges: [],
      }),
  };
});

vi.mock("../repositories/pipeline", async () => {
  const { createPipelineRepoMock } = await import("./testing/mocks");
  return createPipelineRepoMock("run-cancel-1");
});

vi.mock("./steps", async () => {
  const { createPipelineStepsMock } = await import("./testing/mocks");
  return {
    ...createPipelineStepsMock(),
    discoverJobsStep: vi.fn(
      () =>
        new Promise<{
          discoveredJobs: [];
          sourceErrors: [];
          pendingChallenges: [];
        }>((resolve) => {
          stepState.setResolver(resolve);
        }),
    ),
  };
});

describe("pipeline cancellation", () => {
  const database = useSqliteTestDb();

  beforeEach(async () => {
    vi.clearAllMocks();
    await database.open();
  });

  afterEach(async () => {
    await database.close();
  });

  it("marks run as cancelled at checkpoint and resets running state", async () => {
    const pipeline = await import("./orchestrator");
    const pipelineRepo = await import("../repositories/pipeline");
    const steps = await import("./steps");

    const runPromise = pipeline.runPipeline({ sources: [] });

    await Promise.resolve();

    const cancelRequest = pipeline.requestPipelineCancel();
    expect(cancelRequest.accepted).toBe(true);
    expect([null, "run-cancel-1"]).toContain(cancelRequest.pipelineRunId);

    const duplicateRequest = pipeline.requestPipelineCancel();
    expect(duplicateRequest.accepted).toBe(true);
    expect(duplicateRequest.alreadyRequested).toBe(true);

    stepState.resolveDiscover();
    const result = await runPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cancelled");
    expect(vi.mocked(steps.importJobsStep)).not.toHaveBeenCalled();
    expect(vi.mocked(pipelineRepo.updatePipelineRun)).toHaveBeenCalledWith(
      "run-cancel-1",
      expect.objectContaining({
        status: "cancelled",
      }),
    );
    expect(pipeline.getPipelineStatus().isRunning).toBe(false);
  });
  it("scores and selects without generating resumes, PDFs, or targeting jobs", async () => {
    const pipeline = await import("./orchestrator");
    const pipelineRepo = await import("../repositories/pipeline");
    const steps = await import("./steps");
    const jobsRepo = await import("../repositories/jobs");
    const targeted = vi.spyOn(jobsRepo, "setJobTargeted");
    vi.mocked(steps.selectJobsStep).mockReturnValue([{ id: "selected-job" }] as never);
    const run = pipeline.runPipeline({ sources: [] });
    await vi.waitFor(() => expect(steps.discoverJobsStep).toHaveBeenCalled());
    stepState.resolveDiscover();
    const result = await run;
    expect(result.success).toBe(true);
    expect(result.jobsProcessed).toBe(0);
    expect(steps.selectJobsStep).toHaveBeenCalled();
    expect(targeted).not.toHaveBeenCalled();
    expect(pipelineRepo.updatePipelineRun).toHaveBeenCalledWith(
      "run-cancel-1",
      expect.objectContaining({ status: "completed", jobsProcessed: 0 }),
    );
    targeted.mockRestore();
  });
});
