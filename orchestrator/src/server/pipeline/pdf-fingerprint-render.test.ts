vi.mock("../repositories/job-resumes", () => ({
  getJobResume: vi.fn(async () => null),
}));
vi.mock("../services/job-resume", () => ({ ensureJobResume: vi.fn() }));

import { createJob } from "@shared/testing/factories";
import { describe, expect, it, vi } from "vitest";
import { getJobResume } from "../repositories/job-resumes";
import * as jobsRepo from "../repositories/jobs";
import { ensureJobResume } from "../services/job-resume";
import { generatePdf } from "../services/pdf";
import {
  createJobPdfFingerprint,
  type PdfFingerprintContext,
  resolvePdfFingerprintContext,
} from "../services/pdf-fingerprint";
import { generateFinalPdf, processJob } from "./orchestrator";

vi.mock("@infra/logger", () => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { logger };
});

vi.mock("@infra/product-analytics", () => ({
  trackServerProductEvent: vi.fn(),
}));

vi.mock("../repositories/jobs", () => ({
  getJobById: vi.fn(),
  updateJob: vi.fn(),
  setJobTargeted: vi.fn(),
  finalizeGeneratedPdfIfCurrent: vi.fn(),
}));

vi.mock("../repositories/pipeline", () => ({
  createPipelineRun: vi.fn(),
  updatePipelineRun: vi.fn(),
}));

vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn(),
  getAllSettings: vi.fn(),
}));

vi.mock("../services/hosted-usage", () => ({
  reserveHostedUsage: vi.fn(async () => ({ reservation: null })),
  settleHostedUsageReservation: vi.fn(),
  refundHostedUsageReservation: vi.fn(),
}));
vi.mock("../services/pdf", () => ({
  generatePdf: vi.fn(),
}));

vi.mock("../services/pdf-fingerprint", () => ({
  createJobPdfFingerprint: vi.fn(),
  resolvePdfFingerprintContext: vi.fn(),
}));

vi.mock("../services/profile", () => ({
  getProfile: vi.fn(),
}));

vi.mock("../services/projectSelection", () => ({
  pickProjectIdsForJob: vi.fn(),
}));

vi.mock("../services/summary", () => ({
  generateTailoring: vi.fn(),
}));

vi.mock("./steps", () => ({
  discoverJobsStep: vi.fn(),
  importJobsStep: vi.fn(),
  loadProfileStep: vi.fn(),
  notifyPipelineWebhookStep: vi.fn(),
  scoreJobsStep: vi.fn(),
  selectJobsStep: vi.fn(),
}));

describe("PDF render freshness snapshot", () => {
  it("keeps the pre-render context when autosave changes the resume during rendering", async () => {
    const job = createJob({
      id: "own",
      status: "ready",
      pdfSource: "generated",
    });
    const before: PdfFingerprintContext = {
      version: "v1",
      designResumeDocumentId: null,
      designResumeRevision: null,
      designResumeUpdatedAt: null,
      pdfRenderer: "latex",
      typstTheme: "classic",
      pdfPaperSize: "auto",
      rxresumeBaseResumeId: null,
      resumeProjects: {
        maxProjects: 3,
        lockedProjectIds: [],
        aiSelectableProjectIds: [],
      },
      jobResumeHashes: { own: "before" },
    };
    const after = { ...before, jobResumeHashes: { own: "after" } };
    let current = before;
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(job);
    vi.mocked(jobsRepo.finalizeGeneratedPdfIfCurrent).mockResolvedValue(job);
    vi.mocked(resolvePdfFingerprintContext).mockImplementation(async () => current);
    vi.mocked(createJobPdfFingerprint).mockImplementation(
      (_job, snapshot) => snapshot.jobResumeHashes?.own ?? "missing",
    );
    vi.mocked(generatePdf).mockImplementation(async () => {
      expect(resolvePdfFingerprintContext).toHaveBeenCalledTimes(1);
      current = after;
      return { success: true, pdfPath: "generated.pdf" };
    });
    expect(await generateFinalPdf(job.id)).toEqual({ success: true });
    expect(createJobPdfFingerprint).toHaveBeenCalledWith(job, before);
    expect(jobsRepo.finalizeGeneratedPdfIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ pdfFingerprint: "before" }),
    );
  });
  it("restores the previous status on generation failure and retains targeting for retry", async () => {
    vi.clearAllMocks();
    const job = createJob({ id: "retry", status: "discovered" });
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(job);
    vi.mocked(getJobResume).mockResolvedValue(null);
    vi.mocked(ensureJobResume).mockRejectedValueOnce(new Error("LLM unavailable"));
    expect(await processJob(job.id)).toMatchObject({ success: false });
    expect(jobsRepo.setJobTargeted).toHaveBeenCalledWith(job.id, true);
    expect(jobsRepo.updateJob).toHaveBeenNthCalledWith(1, job.id, {
      status: "processing",
      generationError: null,
    });
    expect(jobsRepo.updateJob).toHaveBeenLastCalledWith(job.id, {
      status: "discovered",
      generationError: "LLM unavailable",
    });
    expect(generatePdf).not.toHaveBeenCalled();
  });
  it("does nothing for an editor resume with a current PDF", async () => {
    vi.clearAllMocks();
    const job = createJob({
      id: "own",
      status: "ready",
      pdfPath: "current.pdf",
      pdfSource: "generated",
      pdfFingerprint: "current",
    });
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
    vi.mocked(getJobResume).mockResolvedValue({
      document: {} as never,
      revision: 1,
      exists: true,
      updatedAt: "now",
    });
    vi.mocked(createJobPdfFingerprint).mockReturnValue("current");
    expect(await processJob(job.id)).toEqual({ success: true });
    expect(ensureJobResume).not.toHaveBeenCalled();
    expect(generatePdf).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).not.toHaveBeenCalled();
  });
  it("moves a discovered or processing job with an editor resume and current PDF to ready", async () => {
    for (const status of ["discovered", "processing"] as const) {
      vi.clearAllMocks();
      const job = createJob({
        id: "own",
        status,
        pdfPath: "current.pdf",
        pdfSource: "generated",
        pdfFingerprint: "current",
      });
      vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
      vi.mocked(getJobResume).mockResolvedValue({
        document: {} as never,
        revision: 1,
        exists: true,
        updatedAt: "now",
      });
      vi.mocked(createJobPdfFingerprint).mockReturnValue("current");
      expect(await processJob(job.id)).toEqual({ success: true });
      expect(jobsRepo.updateJob).toHaveBeenCalledExactlyOnceWith(job.id, {
        status: "ready",
        generationError: null,
      });
      expect(generatePdf).not.toHaveBeenCalled();
    }
  });
  it("restores a route-claimed processing job to discovered on failure", async () => {
    vi.clearAllMocks();
    const job = createJob({ id: "claimed", status: "processing" });
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
    vi.mocked(getJobResume).mockResolvedValue(null);
    vi.mocked(ensureJobResume).mockRejectedValueOnce(new Error("LLM down"));
    expect(await processJob(job.id)).toMatchObject({ success: false });
    expect(jobsRepo.updateJob).toHaveBeenLastCalledWith(job.id, {
      status: "discovered",
      generationError: "LLM down",
    });
  });
  it("restores a claimed job when a read before rendering throws", async () => {
    vi.clearAllMocks();
    const job = createJob({ id: "claimed", status: "processing" });
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
    vi.mocked(getJobResume).mockRejectedValueOnce(new Error("db busy"));
    expect(await processJob(job.id)).toMatchObject({ success: false });
    expect(jobsRepo.updateJob).toHaveBeenCalledExactlyOnceWith(job.id, {
      status: "discovered",
      generationError: "db busy",
    });
  });
  it("restores a claimed job when the job itself cannot be read", async () => {
    vi.clearAllMocks();
    const job = createJob({ id: "claimed", status: "processing" });
    vi.mocked(jobsRepo.getJobById)
      .mockRejectedValueOnce(new Error("db busy"))
      .mockResolvedValue(job);
    expect(await processJob(job.id)).toMatchObject({ success: false });
    expect(jobsRepo.updateJob).toHaveBeenCalledExactlyOnceWith(job.id, {
      status: "discovered",
      generationError: "db busy",
    });
  });
  it("keeps a ready job in ready while its stale PDF re-renders", async () => {
    vi.clearAllMocks();
    const job = createJob({
      id: "stale",
      status: "ready",
      pdfPath: "old.pdf",
      pdfSource: "generated",
      pdfFingerprint: "old",
    });
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(job);
    vi.mocked(jobsRepo.finalizeGeneratedPdfIfCurrent).mockResolvedValue(job);
    vi.mocked(getJobResume).mockResolvedValue({
      document: {} as never,
      revision: 2,
      exists: true,
      updatedAt: "now",
    });
    vi.mocked(createJobPdfFingerprint).mockReturnValue("new");
    vi.mocked(generatePdf).mockResolvedValue({
      success: true,
      pdfPath: "new.pdf",
    });
    expect(await processJob(job.id)).toEqual({ success: true });
    for (const [, input] of vi.mocked(jobsRepo.updateJob).mock.calls)
      expect(input).not.toHaveProperty("status");
    expect(jobsRepo.finalizeGeneratedPdfIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "ready",
        requireGeneratedSource: true,
      }),
    );
  });
});
