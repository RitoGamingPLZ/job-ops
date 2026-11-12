import { conflict } from "@infra/errors";
import {
  getRequestContext,
  runWithRequestContext,
} from "@infra/request-context";
import { listExperienceBullets } from "@server/repositories/experience-bullets";
import { getJobResume, saveJobResume } from "@server/repositories/job-resumes";
import { getJobById, updateJob } from "@server/repositories/jobs";
import { createJob } from "@shared/testing/factories";
import type { ReactiveResumeV5Document } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncCandidateLibrary } from "./candidate-library";
import { ensureJobResume, regenerateJobResume } from "./job-resume";
import { loadBaseResumeSource } from "./pdf";
import { generateResumeFromLibrary } from "./resume-from-library";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

vi.mock("@server/repositories/job-resumes", () => ({
  getJobResume: vi.fn(),
  saveJobResume: vi.fn(),
}));
vi.mock("@server/repositories/jobs", () => ({
  getJobById: vi.fn(),
  updateJob: vi.fn(),
}));
vi.mock("./candidate-library", () => ({ syncCandidateLibrary: vi.fn() }));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: vi.fn(async () => []),
}));
vi.mock("./pdf", () => ({
  loadBaseResumeSource: vi.fn(),
  resolvePdfRenderer: vi.fn(async () => "typst"),
}));
vi.mock("./resume-from-library", () => ({
  generateResumeFromLibrary: vi.fn(),
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(async () => null),
}));

const document =
  buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
const row = { document, revision: 1, exists: true, updatedAt: "now" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(syncCandidateLibrary).mockReset();
  vi.mocked(getJobResume).mockResolvedValue(null);
  vi.mocked(getJobById).mockResolvedValue(
    createJob({
      id: "job",
      status: "discovered",
      readyAt: null,
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
  vi.mocked(generateResumeFromLibrary).mockResolvedValue(document);
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
    expect(generateResumeFromLibrary).not.toHaveBeenCalled();
  });
  it("returns existing editor edits without loading the base or tailoring", async () => {
    vi.mocked(getJobResume).mockResolvedValue(row);
    expect(await ensureJobResume("job", { tailor: true })).toBe(row);
    expect(saveJobResume).not.toHaveBeenCalled();
    expect(loadBaseResumeSource).not.toHaveBeenCalled();
    expect(generateResumeFromLibrary).not.toHaveBeenCalled();
  });
  it("selects from the library even when legacy job fields exist", async () => {
    await ensureJobResume("job", { tailor: true });
    expect(generateResumeFromLibrary).toHaveBeenCalledOnce();
    expect(syncCandidateLibrary).toHaveBeenCalledWith(document);
    expect(listExperienceBullets).toHaveBeenCalledWith(true);
    expect(updateJob).toHaveBeenCalledWith(
      "job",
      expect.objectContaining({
        tailoredHeadline: document.basics.headline,
        tailoredSummary: document.summary.content,
        tailoredSkills: "[]",
      }),
    );
  });
  it("tailors missing fields before materializing", async () => {
    vi.mocked(getJobById).mockResolvedValueOnce(createJob({ id: "job" }));
    await ensureJobResume("job", { tailor: true });
    expect(generateResumeFromLibrary).toHaveBeenCalledOnce();
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
  it("lets a plain call join an in-flight tailoring instead of freezing the base", async () => {
    const untailored = createJob({ id: "job" });
    const tailored = createJob({
      id: "job",
      tailoredSummary: "Tailored summary",
      tailoredHeadline: "Tailored headline",
      tailoredSkills: "[]",
    });
    let jobRow = untailored;
    vi.mocked(getJobById).mockImplementation(async () => jobRow);
    let finishTailoring!: () => void;
    vi.mocked(generateResumeFromLibrary).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishTailoring = () => {
            jobRow = tailored;
            resolve({
              ...document,
              summary: { ...document.summary, content: "Tailored summary" },
            });
          };
        }),
    );
    vi.mocked(saveJobResume).mockImplementation(async (_id, _rev, doc) => ({
      ...row,
      document: doc,
    }));
    const target = ensureJobResume("job", { tailor: true });
    await vi.waitFor(() =>
      expect(generateResumeFromLibrary).toHaveBeenCalledOnce(),
    );
    const editorOpen = ensureJobResume("job");
    finishTailoring();
    const [fromTarget, fromEditor] = await Promise.all([target, editorOpen]);
    expect(fromEditor).toBe(fromTarget);
    expect(fromEditor.document.summary.content).toBe("Tailored summary");
    expect(saveJobResume).toHaveBeenCalledOnce();
    expect(generateResumeFromLibrary).toHaveBeenCalledOnce();
  });
  it("tailors a targeted job even for a plain caller", async () => {
    vi.mocked(getJobById).mockResolvedValueOnce(
      createJob({ id: "job", status: "discovered", readyAt: "2026-01-01" }),
    );
    await ensureJobResume("job");
    expect(generateResumeFromLibrary).toHaveBeenCalledOnce();
  });
  it("gives a joiner the failed tailoring instead of saving a plain row", async () => {
    vi.mocked(getJobById).mockResolvedValue(createJob({ id: "job" }));
    let failTailoring!: () => void;
    vi.mocked(generateResumeFromLibrary).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failTailoring = () => reject(new Error("LLM down"));
        }),
    );
    const target = ensureJobResume("job", { tailor: true });
    await vi.waitFor(() =>
      expect(generateResumeFromLibrary).toHaveBeenCalledOnce(),
    );
    const editorOpen = ensureJobResume("job");
    failTailoring();
    await expect(target).rejects.toThrow("LLM down");
    await expect(editorOpen).rejects.toThrow("LLM down");
    expect(saveJobResume).not.toHaveBeenCalled();
    expect(updateJob).not.toHaveBeenCalled();
  });
  it("passes requestOrigin through to base loading", async () => {
    await ensureJobResume("job", {
      tailor: true,
      requestOrigin: "https://tenant.example",
    });
    expect(loadBaseResumeSource).toHaveBeenCalledWith({
      renderer: "typst",
      requestOrigin: "https://tenant.example",
    });
  });
  it("keeps concurrent generation and library reads separate across tenants", async () => {
    const releases: (() => void)[] = [];
    vi.mocked(listExperienceBullets).mockImplementation(async () => []);
    vi.mocked(generateResumeFromLibrary).mockImplementation(async () => {
      const tenant = getRequestContext()?.tenantId;
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return {
        ...document,
        summary: { ...document.summary, content: tenant ?? "unknown" },
      };
    });
    vi.mocked(saveJobResume).mockImplementation(
      async (_id, _revision, doc) => ({ ...row, document: doc }),
    );
    const a = runWithRequestContext(
      { tenantId: "tenant-a", userId: "user-a" },
      () => ensureJobResume("job", { tailor: true }),
    );
    const b = runWithRequestContext(
      { tenantId: "tenant-b", userId: "user-b" },
      () => ensureJobResume("job", { tailor: true }),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    for (const release of releases) release();
    const [first, second] = await Promise.all([a, b]);
    expect(first.document.summary.content).toBe("tenant-a");
    expect(second.document.summary.content).toBe("tenant-b");
    expect(listExperienceBullets).toHaveBeenCalledTimes(2);
    expect(syncCandidateLibrary).toHaveBeenCalledTimes(2);
  });
  it("tailors in place a plain row a tailoring caller waited for", async () => {
    vi.mocked(getJobById).mockResolvedValue(
      createJob({ id: "job", status: "discovered", readyAt: null }),
    );
    let finishBase!: () => void;
    vi.mocked(loadBaseResumeSource).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBase = () => resolve({ data: document, mode: "v5" });
        }),
    );
    const editorOpen = ensureJobResume("job");
    await vi.waitFor(() => expect(loadBaseResumeSource).toHaveBeenCalled());
    const target = ensureJobResume("job", { tailor: true });
    finishBase();
    await Promise.all([editorOpen, target]);
    expect(generateResumeFromLibrary).toHaveBeenCalledOnce();
    expect(vi.mocked(saveJobResume).mock.calls.map((c) => c[1])).toEqual([
      0, 1,
    ]);
  });
  it("does not re-save a targeted job's plain row that already tailored", async () => {
    let jobRow = createJob({
      id: "job",
      status: "discovered",
      readyAt: "2026-01-01",
    });
    vi.mocked(getJobById).mockImplementation(async () => jobRow);
    vi.mocked(generateResumeFromLibrary).mockImplementation(async () => {
      jobRow = {
        ...jobRow,
        tailoredSummary: "S",
        tailoredHeadline: "H",
        tailoredSkills: "[]",
      };
      return document;
    });
    let finishBase!: () => void;
    vi.mocked(loadBaseResumeSource).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBase = () => resolve({ data: document, mode: "v5" });
        }),
    );
    const editorOpen = ensureJobResume("job");
    await vi.waitFor(() => expect(loadBaseResumeSource).toHaveBeenCalled());
    const target = ensureJobResume("job", { tailor: true });
    finishBase();
    const [fromEditor, fromTarget] = await Promise.all([editorOpen, target]);
    expect(fromTarget).toBe(fromEditor);
    expect(fromTarget.revision).toBe(1);
    expect(generateResumeFromLibrary).toHaveBeenCalledOnce();
    expect(saveJobResume).toHaveBeenCalledOnce();
  });
});

describe("regenerateJobResume", () => {
  it("does not yield between the before-read and library sync", async () => {
    let beforeReadInCurrentTurn = false;
    vi.mocked(getJobResume)
      .mockResolvedValue(row)
      .mockResolvedValueOnce(row)
      .mockImplementationOnce(async () => {
        beforeReadInCurrentTurn = true;
        queueMicrotask(() => {
          beforeReadInCurrentTurn = false;
        });
        return row;
      });
    vi.mocked(syncCandidateLibrary).mockImplementationOnce(() => {
      expect(getJobResume).toHaveBeenCalledTimes(2);
      expect(beforeReadInCurrentTurn).toBe(true);
      return { created: 0, skipped: 0, linked: 0 };
    });
    await regenerateJobResume("job");
    expect(syncCandidateLibrary).toHaveBeenCalledOnce();
  });
  it("keeps regeneration's sync revisions separate across tenants", async () => {
    const revisions = new Map([
      ["tenant-a", 7],
      ["tenant-b", 20],
    ]);
    const tenant = () => getRequestContext()?.tenantId ?? "unknown";
    vi.mocked(getJobResume).mockImplementation(async () => ({
      ...row,
      revision: revisions.get(tenant()) ?? 0,
    }));
    vi.mocked(syncCandidateLibrary).mockImplementation(() => {
      revisions.set(tenant(), (revisions.get(tenant()) ?? 0) + 1);
      return { created: 0, skipped: 0, linked: 1 };
    });
    vi.mocked(saveJobResume).mockImplementation(async (_id, revision) => {
      expect(revision).toBe(revisions.get(tenant()));
      return { ...row, revision: revision + 1 };
    });
    const results = await Promise.all(
      ["tenant-a", "tenant-b"].map((tenantId) =>
        runWithRequestContext({ tenantId, userId: tenantId }, () =>
          regenerateJobResume("job"),
        ),
      ),
    );
    expect(results.map((result) => result.revision)).toEqual([9, 22]);
  });
  it.each([
    false,
    true,
  ])("saves against the revision after sync (sync changed it: %s)", async (syncChangesRevision) => {
    let current = { ...row, revision: 7 };
    vi.mocked(getJobResume).mockImplementation(async () => current);
    vi.mocked(syncCandidateLibrary).mockImplementationOnce(() => {
      if (syncChangesRevision) current = { ...current, revision: 8 };
      return { created: 0, skipped: 0, linked: syncChangesRevision ? 1 : 0 };
    });
    vi.mocked(saveJobResume).mockImplementationOnce(
      async (_id, baseRevision, doc) => {
        if (baseRevision !== current.revision) throw conflict("Resume changed");
        current = {
          ...current,
          document: doc,
          revision: baseRevision + 1,
        };
        return current;
      },
    );
    const result = await regenerateJobResume("job");
    expect(result.revision).toBe(syncChangesRevision ? 9 : 8);
    expect(saveJobResume).toHaveBeenCalledWith(
      "job",
      syncChangesRevision ? 8 : 7,
      document,
    );
  });
  it("rejects an edit made while loading the base before sync", async () => {
    let current = { ...row, revision: 7 };
    vi.mocked(getJobResume).mockImplementation(async () => current);
    vi.mocked(loadBaseResumeSource).mockImplementationOnce(async () => {
      current = { ...current, revision: 8 };
      return { data: document, mode: "v5" };
    });
    await expect(regenerateJobResume("job")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(generateResumeFromLibrary).not.toHaveBeenCalled();
    expect(saveJobResume).not.toHaveBeenCalled();
    expect(updateJob).not.toHaveBeenCalled();
  });
  it("still conflicts on an editor save during generation after sync stamps refs", async () => {
    let current = { ...row, revision: 7 };
    vi.mocked(getJobResume).mockImplementation(async () => current);
    vi.mocked(syncCandidateLibrary).mockImplementationOnce(() => {
      current = { ...current, revision: 8 };
      return { created: 0, skipped: 0, linked: 1 };
    });
    let finish!: (value: ReactiveResumeV5Document) => void;
    vi.mocked(generateResumeFromLibrary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(saveJobResume).mockImplementationOnce(async (_id, revision) => {
      if (revision !== current.revision) throw conflict("Resume changed");
      return current;
    });
    const pending = regenerateJobResume("job");
    await vi.waitFor(() =>
      expect(generateResumeFromLibrary).toHaveBeenCalledOnce(),
    );
    const edited = {
      ...document,
      summary: { ...document.summary, content: "Editor saved this" },
    };
    current = { ...current, revision: 9, document: edited };
    finish(document);
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    expect(saveJobResume).toHaveBeenCalledWith("job", 8, document);
    expect(current.document).toBe(edited);
    expect(updateJob).not.toHaveBeenCalled();
  });
  it("replaces the saved document at its current revision only after tailoring succeeds", async () => {
    vi.mocked(getJobResume).mockResolvedValue({ ...row, revision: 7 });
    let finish!: (value: ReactiveResumeV5Document) => void;
    vi.mocked(generateResumeFromLibrary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = regenerateJobResume("job");
    await vi.waitFor(() =>
      expect(generateResumeFromLibrary).toHaveBeenCalledOnce(),
    );
    expect(saveJobResume).not.toHaveBeenCalled();
    finish(document);
    await pending;
    expect(saveJobResume).toHaveBeenCalledWith("job", 7, document);
  });
  it("keeps the old document and revision on generation failure", async () => {
    vi.mocked(getJobResume).mockResolvedValue({ ...row, revision: 7 });
    vi.mocked(generateResumeFromLibrary).mockRejectedValueOnce(
      new Error("LLM down"),
    );
    await expect(regenerateJobResume("job")).rejects.toThrow("LLM down");
    expect(saveJobResume).not.toHaveBeenCalled();
    expect(updateJob).not.toHaveBeenCalled();
  });
  it("does not hide an editor save conflict during regeneration", async () => {
    vi.mocked(getJobResume).mockResolvedValue(row);
    vi.mocked(saveJobResume).mockRejectedValueOnce(conflict("Resume changed"));
    await expect(regenerateJobResume("job")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
