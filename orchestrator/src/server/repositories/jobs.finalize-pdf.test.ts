import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("finalizeGeneratedPdfIfCurrent", () => {
  let tempDir: string;
  let jobsRepo: Awaited<typeof import("./jobs")>;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-finalize-pdf-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";
    await import("../db/migrate");
    jobsRepo = await import("./jobs");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
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
