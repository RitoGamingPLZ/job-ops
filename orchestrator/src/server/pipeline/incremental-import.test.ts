import { useSqliteTestDb } from "../testing/sqlite-test-db";
import type { CreateJobInput } from "@shared/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sourceBatches = vi.hoisted(() => ({
  linkedin: [] as CreateJobInput[],
  indeed: [] as CreateJobInput[],
}));

vi.mock("../repositories/pipeline", async () => {
  const { createPipelineRepoMock } = await import("./testing/mocks");
  return createPipelineRepoMock("run-import-1");
});

vi.mock("./steps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./steps")>()),
  loadProfileStep: vi.fn(async () => ({})),
  // Both sources finish together, so their imports overlap.
  discoverJobsStep: vi.fn(async (args) => {
    await Promise.all([
      args.onSourceDiscovered(sourceBatches.linkedin, "linkedin"),
      args.onSourceDiscovered(sourceBatches.indeed, "indeed"),
    ]);
    return {
      discoveredJobs: [...sourceBatches.linkedin, ...sourceBatches.indeed],
      sourceErrors: [],
      pendingChallenges: [],
    };
  }),
  scoreJobsStep: vi.fn(async () => ({ unprocessedJobs: [], scoredJobs: [] })),
  selectJobsStep: vi.fn(() => []),
  notifyPipelineWebhookStep: vi.fn(async () => undefined),
}));

describe("incremental per-source import", () => {
  const database = useSqliteTestDb();

  // Each test uses distinct titles.
  beforeAll(async () => {
    await database.open();
  });
  afterAll(database.close);

  it("does not create a cross-source fuzzy duplicate when batches overlap", async () => {
    sourceBatches.linkedin = [
      {
        source: "linkedin",
        title: "Software Engineer",
        employer: "Acme Ltd",
        jobUrl: "https://linkedin.com/jobs/1",
      },
    ];
    sourceBatches.indeed = [
      {
        source: "indeed",
        title: "Software Engineers",
        employer: "Acme Limited",
        jobUrl: "https://indeed.com/jobs/1",
      },
    ];
    const pipeline = await import("./orchestrator");
    const jobsRepo = await import("../repositories/jobs");

    expect((await pipeline.runPipeline({ sources: [] })).success).toBe(true);

    const stored = await jobsRepo.getAllJobs();
    expect(stored.map((job) => job.jobUrl)).toEqual(["https://linkedin.com/jobs/1"]);
  });

  it("still creates a job matching one stored by a previous run", async () => {
    sourceBatches.linkedin = [
      {
        source: "linkedin",
        title: "Data Engineer",
        employer: "Globex",
        jobUrl: "https://linkedin.com/jobs/2",
      },
    ];
    sourceBatches.indeed = [];
    const pipeline = await import("./orchestrator");
    const jobsRepo = await import("../repositories/jobs");
    await jobsRepo.createJob({
      source: "indeed",
      title: "Data Engineer",
      employer: "Globex",
      jobUrl: "https://indeed.com/jobs/old",
    });

    expect((await pipeline.runPipeline({ sources: [] })).success).toBe(true);

    expect(await jobsRepo.getJobByUrl("https://linkedin.com/jobs/2")).not.toBe(null);
    expect(await jobsRepo.getJobByUrl("https://indeed.com/jobs/old")).not.toBe(null);
  });
});
