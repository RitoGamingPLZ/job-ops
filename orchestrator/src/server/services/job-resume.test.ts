import { conflict } from "@infra/errors";
import { getJobResume, saveJobResume } from "@server/repositories/job-resumes";
import { getJobById } from "@server/repositories/jobs";
import { createJob } from "@shared/testing/factories";
import type { ReactiveResumeV5Document } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeJob } from "../pipeline/orchestrator";
import { ensureJobResume } from "./job-resume";
import { loadBaseResumeSource } from "./pdf";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

vi.mock("@server/repositories/job-resumes", () => ({
  getJobResume: vi.fn(),
  saveJobResume: vi.fn(),
}));
vi.mock("@server/repositories/jobs", () => ({ getJobById: vi.fn() }));
vi.mock("./pdf", () => ({
  loadBaseResumeSource: vi.fn(),
  resolvePdfRenderer: vi.fn(async () => "typst"),
}));
vi.mock("../pipeline/orchestrator", () => ({ summarizeJob: vi.fn() }));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(async () => null),
}));

const document =
  buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
const row = { document, revision: 1, exists: true, updatedAt: "now" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJobResume).mockResolvedValue(null);
  vi.mocked(getJobById).mockResolvedValue(
    createJob({
      id: "job",
      tailoredSummary: "Summary",
      tailoredHeadline: "Headline",
      tailoredSkills: "[]",
    }),
  );
  vi.mocked(loadBaseResumeSource).mockResolvedValue({
    data: document,
    mode: "v5",
  });
  vi.mocked(saveJobResume).mockResolvedValue(row);
  vi.mocked(summarizeJob).mockResolvedValue({ success: true });
});
describe("ensureJobResume", () => {
  it("materializes revision one with deterministic tailoring, without an LLM by default", async () => {
    expect(await ensureJobResume("job")).toBe(row);
    expect(saveJobResume).toHaveBeenCalledWith(
      "job",
      0,
      expect.objectContaining({
        basics: expect.objectContaining({ headline: "Headline" }),
        summary: expect.objectContaining({ content: "Summary" }),
      }),
    );
    expect(summarizeJob).not.toHaveBeenCalled();
  });
  it("returns existing editor edits without loading the base or tailoring", async () => {
    vi.mocked(getJobResume).mockResolvedValue(row);
    expect(await ensureJobResume("job", { tailor: true })).toBe(row);
    expect(saveJobResume).not.toHaveBeenCalled();
    expect(loadBaseResumeSource).not.toHaveBeenCalled();
    expect(summarizeJob).not.toHaveBeenCalled();
  });
  it("skips the LLM when job fields exist", async () => {
    await ensureJobResume("job", { tailor: true });
    expect(summarizeJob).not.toHaveBeenCalled();
  });
  it("tailors missing fields before materializing", async () => {
    vi.mocked(getJobById).mockResolvedValueOnce(createJob({ id: "job" }));
    await ensureJobResume("job", { tailor: true });
    expect(summarizeJob).toHaveBeenCalledWith("job");
    expect(saveJobResume).toHaveBeenCalledOnce();
  });
  it("re-reads the winning insert after a concurrent conflict", async () => {
    let saved: typeof row | null = null;
    vi.mocked(getJobResume).mockImplementation(async () => saved);
    vi.mocked(saveJobResume).mockImplementation(async () => {
      if (saved) throw conflict("Concurrent save");
      saved = row;
      return row;
    });
    const results = await Promise.all([
      ensureJobResume("job"),
      ensureJobResume("job"),
    ]);
    expect(results).toEqual([row, row]);
    expect(saved).toEqual(row);
  });
});
