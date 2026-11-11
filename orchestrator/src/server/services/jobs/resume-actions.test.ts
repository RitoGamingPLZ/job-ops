import {
  getRequestContext,
  runWithRequestContext,
} from "@infra/request-context";
import { generateFinalPdf, processJob } from "@server/pipeline/index";
import { getJobResume } from "@server/repositories/job-resumes";
import * as jobsRepo from "@server/repositories/jobs";
import { regenerateJobResume } from "@server/services/job-resume";
import { getJobPdfFreshness } from "@server/services/pdf-fingerprint";
import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateMissingResumesInBackground,
  regenerateJobResumeInBackground,
} from "./actions";

vi.mock("@server/pipeline/index", () => ({
  processJob: vi.fn(),
  generateFinalPdf: vi.fn(),
}));
vi.mock("@server/repositories/job-resumes", () => ({ getJobResume: vi.fn() }));
vi.mock("@server/repositories/jobs", () => ({
  getAllJobs: vi.fn(),
  getJobById: vi.fn(),
  updateJob: vi.fn(),
}));
vi.mock("@server/services/job-resume", () => ({
  regenerateJobResume: vi.fn(),
}));
vi.mock("@server/services/pdf-fingerprint", () => ({
  resolvePdfFingerprintContext: vi.fn(async () => ({})),
  getJobPdfFreshness: vi.fn(),
}));
vi.mock("@server/services/profile", () => ({ getProfile: vi.fn() }));
vi.mock("@server/services/scorer", () => ({ scoreJobSuitability: vi.fn() }));
vi.mock("@server/config/demo", () => ({ isDemoMode: () => false }));
vi.mock("@server/services/demo-simulator", () => ({
  simulateProcessJob: vi.fn(),
  simulateRescoreJob: vi.fn(),
}));
vi.mock("@server/tenancy/private-scope", () => ({
  getPrivateDataScope: () => ({
    scopeKey: `${getRequestContext()?.tenantId}:${getRequestContext()?.userId}`,
  }),
}));
const targeted = (id: string, overrides = {}) =>
  createJob({
    id,
    readyAt: "now",
    status: "ready",
    pdfPath: "resume.pdf",
    ...overrides,
  });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(processJob).mockResolvedValue({ success: true });
  vi.mocked(generateFinalPdf).mockResolvedValue({ success: true });
  vi.mocked(getJobResume).mockResolvedValue({
    exists: true,
    revision: 3,
    updatedAt: "now",
    document: {} as never,
  });
  vi.mocked(getJobPdfFreshness).mockReturnValue("current");
  vi.mocked(jobsRepo.getJobById).mockImplementation(async (id) => targeted(id));
  vi.mocked(jobsRepo.updateJob).mockImplementation(async (id, update) =>
    targeted(id, update),
  );
});
describe("resume background actions", () => {
  it("selects missing, stale and absent documents while excluding ineligible jobs", async () => {
    const jobs = [
      targeted("missing", { pdfPath: null }),
      targeted("stale"),
      targeted("no-doc"),
      targeted("current"),
      targeted("uploaded", { pdfSource: "uploaded" }),
      targeted("processing", { status: "processing" }),
      targeted("regenerating", { pdfRegenerating: true }),
      targeted("untargeted", { readyAt: null }),
    ];
    vi.mocked(jobsRepo.getAllJobs).mockResolvedValue(jobs);
    vi.mocked(getJobPdfFreshness).mockImplementation((job) =>
      job.id === "stale" ? "stale" : "current",
    );
    vi.mocked(getJobResume).mockImplementation(async (id) =>
      id === "no-doc"
        ? null
        : {
            exists: true,
            revision: 1,
            updatedAt: "now",
            document: {} as never,
          },
    );
    expect(await generateMissingResumesInBackground()).toEqual({
      jobIds: ["missing", "stale", "no-doc"],
      alreadyRunning: false,
    });
    expect(jobsRepo.getAllJobs).toHaveBeenCalledWith([
      "discovered",
      "processing",
      "ready",
    ]);
    await tick();
    expect(vi.mocked(processJob).mock.calls.map(([id]) => id)).toEqual([
      "missing",
      "stale",
      "no-doc",
    ]);
  });
  it("awaits each job, skips failures, and rejects concurrent batches in the same private scope", async () => {
    vi.mocked(jobsRepo.getAllJobs).mockResolvedValue([
      targeted("one", { pdfPath: null }),
      targeted("two", { pdfPath: null }),
    ]);
    let release!: (value: { success: boolean }) => void;
    vi.mocked(processJob).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = generateMissingResumesInBackground();
    expect(await generateMissingResumesInBackground()).toEqual({
      jobIds: [],
      alreadyRunning: true,
    });
    await first;
    await tick();
    expect(processJob).toHaveBeenCalledTimes(1);
    release({ success: false });
    await tick();
    expect(processJob).toHaveBeenCalledTimes(2);
  });
  it("separates private scope locks and retains tenant, user and request context in workers", async () => {
    const seen: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(jobsRepo.getAllJobs).mockImplementation(async () => [
      targeted(getRequestContext()?.tenantId ?? "", { pdfPath: null }),
    ]);
    vi.mocked(processJob).mockImplementation(async () => {
      seen.push(getRequestContext());
      await gate;
      return { success: true };
    });
    for (const [tenantId, userId] of [
      ["a", "one"],
      ["a", "two"],
      ["b", "one"],
    ]) {
      expect(
        (
          await runWithRequestContext(
            { tenantId, userId, requestId: "batch-request" },
            () => generateMissingResumesInBackground(),
          )
        ).alreadyRunning,
      ).toBe(false);
    }
    await tick();
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: "a",
          userId: "one",
          requestId: "batch-request",
          jobId: "a",
        }),
        expect.objectContaining({ tenantId: "a", userId: "two" }),
        expect.objectContaining({ tenantId: "b", userId: "one" }),
      ]),
    );
    release();
    await tick();
  });
  it.each([
    { status: "processing" },
    { pdfRegenerating: true },
    { readyAt: null },
  ])("guards regeneration: %j", async (overrides) => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue(
      targeted("job", overrides),
    );
    await expect(regenerateJobResumeInBackground("job")).rejects.toMatchObject({
      status: "readyAt" in overrides ? 400 : 409,
    });
    expect(regenerateJobResume).not.toHaveBeenCalled();
  });
  it("marks processing immediately, then re-tailors before rendering", async () => {
    expect((await regenerateJobResumeInBackground("job")).status).toBe(
      "processing",
    );
    expect(regenerateJobResume).not.toHaveBeenCalled();
    await tick();
    expect(regenerateJobResume).toHaveBeenCalledOnce();
    expect(generateFinalPdf).toHaveBeenCalledOnce();
    expect(
      vi.mocked(regenerateJobResume).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(generateFinalPdf).mock.invocationCallOrder[0]);
  });
  it("restores the prior status when tailoring fails, without rendering", async () => {
    vi.mocked(jobsRepo.getJobById)
      .mockResolvedValueOnce(targeted("job"))
      .mockResolvedValueOnce(targeted("job", { status: "processing" }));
    vi.mocked(regenerateJobResume).mockRejectedValue(
      new Error("generation failed"),
    );
    await regenerateJobResumeInBackground("job");
    await tick();
    expect(generateFinalPdf).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).toHaveBeenLastCalledWith("job", {
      status: "ready",
    });
  });
  it("keeps a newer job status when tailoring fails", async () => {
    vi.mocked(jobsRepo.getJobById)
      .mockResolvedValueOnce(targeted("job"))
      .mockResolvedValueOnce(targeted("job", { status: "applied" }));
    vi.mocked(regenerateJobResume).mockRejectedValueOnce(
      new Error("generation failed"),
    );
    await regenerateJobResumeInBackground("job");
    await tick();
    expect(generateFinalPdf).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).toHaveBeenCalledExactlyOnceWith("job", {
      status: "processing",
    });
  });
});
