import type { CreateJobInput } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importJobsStep } from "./import-jobs";

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn() },
}));

vi.mock("@server/repositories/jobs", () => ({
  createJobs: vi.fn(async () => ({ created: 1, skipped: 0 })),
}));

vi.mock("../progress", () => ({
  progressHelpers: {
    importingJob: vi.fn(),
    importComplete: vi.fn(),
  },
}));

describe("importJobsStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes the job currently being imported", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { progressHelpers } = await import("../progress");
    const job: CreateJobInput = {
      source: "linkedin",
      title: "Frontend Engineer",
      employer: "Monzo",
      jobUrl: "https://example.com/jobs/1",
    };

    await importJobsStep({ discoveredJobs: [job] });

    const onProgress = vi.mocked(jobsRepo.createJobs).mock.calls[0]?.[1];
    expect(onProgress).toBeTypeOf("function");
    onProgress?.(job, 1, 1);

    expect(progressHelpers.importingJob).toHaveBeenCalledWith(1, 1, {
      id: job.jobUrl,
      title: job.title,
      employer: job.employer,
    });
  });

  it("drops fuzzy duplicates of jobs imported earlier in the run", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const { progressHelpers } = await import("../progress");
    const prior: CreateJobInput = {
      source: "linkedin",
      title: "Software Engineer",
      employer: "Acme Ltd",
      jobUrl: "https://linkedin.com/jobs/1",
    };
    const newJob: CreateJobInput = {
      source: "indeed",
      title: "Product Designer",
      employer: "Monzo",
      jobUrl: "https://indeed.com/jobs/2",
      location: "London",
    };

    const result = await importJobsStep({
      priorRunJobs: [prior],
      discoveredJobs: [
        {
          source: "indeed",
          title: "Software Engineers",
          employer: "Acme Limited",
          jobUrl: "https://indeed.com/jobs/1",
        },
        newJob,
        { ...newJob, jobUrl: "https://indeed.com/jobs/3", salary: "£60,000" },
      ],
    });

    expect(result).toEqual({ created: 1, skipped: 0, fuzzyMerged: 2 });
    expect(jobsRepo.createJobs).toHaveBeenCalledWith(
      [expect.objectContaining({ ...newJob, salary: "£60,000" })],
      expect.any(Function),
    );
    expect(progressHelpers.importComplete).toHaveBeenCalledWith(1, 2);
  });

  it("does not dedup against stored jobs from previous runs", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const job: CreateJobInput = {
      source: "linkedin",
      title: "Software Engineer",
      employer: "Acme Ltd",
      jobUrl: "https://linkedin.com/jobs/new",
    };

    expect(await importJobsStep({ discoveredJobs: [job], emitProgress: false })).toEqual({
      created: 1,
      skipped: 0,
      fuzzyMerged: 0,
    });
    expect(jobsRepo.createJobs).toHaveBeenCalledWith([job], undefined);
  });
});
