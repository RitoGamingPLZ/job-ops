import { createJob } from "@shared/testing/factories";
import { describe, expect, it, vi } from "vitest";
import * as jobsRepo from "../repositories/jobs";
import { generatePdf } from "../services/pdf";
import {
  createJobPdfFingerprint,
  type PdfFingerprintContext,
  resolvePdfFingerprintContext,
} from "../services/pdf-fingerprint";
import { generateFinalPdf } from "./orchestrator";

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
  processJobsStep: vi.fn(),
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
    vi.mocked(resolvePdfFingerprintContext).mockImplementation(
      async () => current,
    );
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
});
