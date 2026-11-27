import { useSqliteTestDb } from "../testing/sqlite-test-db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/pipeline", async () => {
  const { createPipelineRepoMock } = await import("./testing/mocks");
  return createPipelineRepoMock("run-llm-config-1");
});

const scoreJobsStep = vi.fn();

vi.mock("./steps", async () => {
  const { createPipelineStepsMock } = await import("./testing/mocks");
  return { ...createPipelineStepsMock(), scoreJobsStep };
});

describe("pipeline LLM configuration handling", () => {
  const database = useSqliteTestDb();

  beforeEach(async () => {
    vi.clearAllMocks();
    await database.open();
  });

  afterEach(async () => {
    await database.close();
  });

  it("re-enters configuration_required on every repeated scoring failure instead of failing", async () => {
    const { LlmNotConfiguredError } = await import("../services/scorer");

    scoreJobsStep
      .mockRejectedValueOnce(new LlmNotConfiguredError("LLM API key not configured"))
      .mockRejectedValueOnce(new LlmNotConfiguredError("LLM API key not configured"))
      .mockResolvedValueOnce({ unprocessedJobs: [], scoredJobs: [] });

    const pipeline = await import("./orchestrator");
    const pipelineRepo = await import("../repositories/pipeline");
    const { getProgress } = await import("./progress");

    const runPromise = pipeline.runPipeline({});

    // First failure: pipeline should pause for configuration, not fail.
    await vi.waitFor(() => {
      expect(getProgress().step).toBe("configuration_required");
    });
    expect(scoreJobsStep).toHaveBeenCalledTimes(1);
    expect(pipeline.resumePipelineScoring()).toEqual({ resolved: true });

    // Second failure: must ALSO pause for configuration again, not blow past
    // the catch and mark the pipeline failed.
    await vi.waitFor(() => {
      expect(scoreJobsStep).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(getProgress().step).toBe("configuration_required");
    });
    expect(pipeline.resumePipelineScoring()).toEqual({ resolved: true });

    const result = await runPromise;

    expect(scoreJobsStep).toHaveBeenCalledTimes(3);
    expect(result).toEqual(expect.objectContaining({ success: true, jobsProcessed: 0 }));
    expect(vi.mocked(pipelineRepo.updatePipelineRun)).not.toHaveBeenCalledWith(
      "run-llm-config-1",
      expect.objectContaining({ status: "failed" }),
    );
    expect(vi.mocked(pipelineRepo.updatePipelineRun)).toHaveBeenCalledWith(
      "run-llm-config-1",
      expect.objectContaining({ status: "completed" }),
    );
  });
});
