import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateJobInput } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../pipeline/progress", () => ({
  progressHelpers: { importingJob: vi.fn(), importComplete: vi.fn() },
}));

describe.sequential("stored job deduplication", () => {
  let tempDir: string;
  let jobsRepo: Awaited<typeof import("./jobs")>;
  let importJobsStep: typeof import("../pipeline/steps/import-jobs").importJobsStep;
  let runWithRequestContext: typeof import("@infra/request-context").runWithRequestContext;

  const firstJob: CreateJobInput = {
    source: "linkedin",
    title: "Software Engineer",
    employer: "Acme Ltd",
    jobUrl: "https://linkedin.com/jobs/1",
  };
  const fuzzyDuplicate: CreateJobInput = {
    source: "indeed",
    title: "Software Engineers",
    employer: "Acme Limited",
    jobUrl: "https://indeed.com/jobs/2",
  };

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-job-deduplication-"));
    vi.stubEnv("DATA_DIR", tempDir);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JOBOPS_APP_MODE", "local");
    await import("../db/migrate");
    jobsRepo = await import("./jobs");
    ({ importJobsStep } = await import("../pipeline/steps/import-jobs"));
    ({ runWithRequestContext } = await import("@infra/request-context"));
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    vi.unstubAllEnvs();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("counts a fuzzy duplicate from a later source batch without creating it", async () => {
    expect(
      await importJobsStep({ discoveredJobs: [firstJob], emitProgress: false }),
    ).toEqual({ created: 1, skipped: 0, fuzzyMerged: 0 });

    expect(
      await importJobsStep({
        discoveredJobs: [fuzzyDuplicate],
        emitProgress: false,
      }),
    ).toEqual({ created: 0, skipped: 0, fuzzyMerged: 1 });
    expect(await jobsRepo.getJobDeduplicationCandidates()).toEqual([firstJob]);
    expect(await jobsRepo.getAllJobs()).toHaveLength(1);
    expect(await jobsRepo.getJobByUrl(fuzzyDuplicate.jobUrl)).toBeNull();

    expect(
      await importJobsStep({ discoveredJobs: [firstJob], emitProgress: false }),
    ).toEqual({ created: 0, skipped: 1, fuzzyMerged: 0 });
  });

  it.each([
    "local",
    "hosted",
  ] as const)("does not deduplicate against another private scope in %s mode", async (appMode) => {
    vi.stubEnv("JOBOPS_APP_MODE", appMode);
    vi.stubEnv("JOBOPS_HOSTED_TENANT_ID", "tenant-a");
    const { db, schema } = await import("../db/index");
    await db.insert(schema.tenants).values([
      { id: "tenant-a", name: "A", slug: "a" },
      { id: "tenant-b", name: "B", slug: "b" },
    ]);
    await db.insert(schema.users).values([
      { id: "user-a", username: "a" },
      { id: "user-b", username: "b" },
    ]);
    const owner = { tenantId: "tenant-a", userId: "user-a" };
    const other = {
      tenantId: appMode === "hosted" ? "tenant-a" : "tenant-b",
      userId: "user-b",
    };
    // Seed an existing job independently of the current pipeline run.
    await runWithRequestContext(owner, () => jobsRepo.createJob(firstJob));

    await runWithRequestContext(other, async () => {
      expect(await jobsRepo.getJobDeduplicationCandidates()).toEqual([]);
      expect(
        await importJobsStep({
          discoveredJobs: [fuzzyDuplicate],
          emitProgress: false,
        }),
      ).toEqual({ created: 1, skipped: 0, fuzzyMerged: 0 });
      expect(await jobsRepo.getJobDeduplicationCandidates()).toEqual([
        fuzzyDuplicate,
      ]);
    });

    await runWithRequestContext(owner, async () => {
      expect(await jobsRepo.getJobDeduplicationCandidates()).toEqual([
        firstJob,
      ]);
      expect(
        await importJobsStep({
          discoveredJobs: [fuzzyDuplicate],
          emitProgress: false,
        }),
      ).toEqual({ created: 0, skipped: 0, fuzzyMerged: 1 });
    });
  });
});
