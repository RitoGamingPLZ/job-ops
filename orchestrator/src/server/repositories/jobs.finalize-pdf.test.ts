import { useSqliteTestDb } from "../testing/sqlite-test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("finalizeGeneratedPdfIfCurrent", () => {
  const database = useSqliteTestDb();
  let jobsRepo: Awaited<typeof import("./jobs")>;

  beforeEach(async () => {
    await database.open();
    jobsRepo = await import("./jobs");
  });

  afterEach(async () => {
    await database.close();
  });

  const finalize = (id: string, expectedStatus: "processing" | "applied") =>
    jobsRepo.finalizeGeneratedPdfIfCurrent({
      id,
      expectedStatus,
      requireGeneratedSource: expectedStatus !== "processing",
      pdfPath: "new.pdf",
      pdfFingerprint: "fp",
      pdfGeneratedAt: "2026-01-01T00:00:00.000Z",
    });

  it("keeps an applied job applied and stores the new PDF", async () => {
    const job = await jobsRepo.createJob({
      source: "manual",
      title: "Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job/applied",
    });
    await jobsRepo.updateJob(job.id, {
      status: "applied",
      pdfSource: "generated",
      pdfRegenerating: true,
    });
    const updated = await finalize(job.id, "applied");
    expect(updated).toMatchObject({
      status: "applied",
      pdfPath: "new.pdf",
      pdfRegenerating: false,
    });
    expect(updated?.readyAt).toBeNull();
  });

  it("moves a processing job to ready", async () => {
    const job = await jobsRepo.createJob({
      source: "manual",
      title: "Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job/processing",
    });
    await jobsRepo.updateJob(job.id, {
      status: "processing",
      pdfRegenerating: true,
    });
    const updated = await finalize(job.id, "processing");
    expect(updated?.status).toBe("ready");
    expect(updated?.readyAt).toBeTruthy();
  });
});
