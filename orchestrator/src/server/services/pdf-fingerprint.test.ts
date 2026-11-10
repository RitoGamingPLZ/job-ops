import { db, schema } from "@server/db";
import { createJob } from "@shared/testing/factories";
import { describe, expect, it, vi } from "vitest";
import type { PdfFingerprintContext } from "./pdf-fingerprint";
import {
  createJobPdfFingerprint,
  getJobPdfFreshness,
  resolvePdfFingerprintContext,
} from "./pdf-fingerprint";

vi.mock("./design-resume", () => ({
  getCurrentDesignResumeOrNullOnLegacy: vi.fn(async () => null),
}));
vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(async () => null),
}));
vi.mock("./rxresume/baseResumeId", () => ({
  getConfiguredRxResumeBaseResumeId: vi.fn(async () => ({ resumeId: null })),
}));

const context: PdfFingerprintContext = {
  version: "v1",
  designResumeDocumentId: "design-resume-1",
  designResumeRevision: 2,
  designResumeUpdatedAt: "2026-05-01T10:00:00.000Z",
  pdfRenderer: "latex",
  typstTheme: "classic",
  pdfPaperSize: "auto",
  rxresumeBaseResumeId: "rxresume-base-1",
  resumeProjects: {
    maxProjects: 3,
    lockedProjectIds: ["must"],
    aiSelectableProjectIds: ["selectable"],
  },
};

describe("PDF freshness", () => {
  it("marks co-work document changes and reset stale, isolated by job", () => {
    const job = createJob({
      id: "own",
      pdfPath: "generated.pdf",
      pdfSource: "generated",
    });
    const original = {
      ...context,
      jobResumeHashes: { own: "doc-a", other: "other-a" },
    };
    const saved = {
      ...job,
      pdfFingerprint: createJobPdfFingerprint(job, original),
    };
    expect(getJobPdfFreshness(saved, original)).toBe("current");
    expect(
      getJobPdfFreshness(saved, {
        ...context,
        jobResumeHashes: { own: "doc-b" },
      }),
    ).toBe("stale");
    expect(getJobPdfFreshness(saved, context)).toBe("stale");
    expect(
      getJobPdfFreshness(saved, {
        ...context,
        jobResumeHashes: { own: "doc-a", other: "other-b" },
      }),
    ).toBe("current");
  });
  it("ignores base resume and legacy tailoring changes once an editor document exists", () => {
    const job = createJob({ id: "own" });
    const editorContext = {
      ...context,
      jobResumeHashes: { own: "revision-1" },
    };
    const original = createJobPdfFingerprint(job, editorContext);
    expect(
      createJobPdfFingerprint(
        {
          ...job,
          tailoredSummary: "Changed",
          tailoredHeadline: "Changed",
          tailoredSkills: "[]",
          selectedProjectIds: "other",
        },
        {
          ...editorContext,
          designResumeRevision: 99,
          designResumeUpdatedAt: "new",
          designResumeDocumentId: "other",
          rxresumeBaseResumeId: "other",
          resumeProjects: { ...context.resumeProjects, maxProjects: 20 },
        },
      ),
    ).toBe(original);
    expect(
      createJobPdfFingerprint(job, { ...editorContext, pdfRenderer: "typst" }),
    ).not.toBe(original);
    expect(
      createJobPdfFingerprint(job, { ...editorContext, pdfPaperSize: "a4" }),
    ).not.toBe(original);
  });
  it("selects only scoped job resume metadata and hashes revision plus update time", async () => {
    let rows = [{ jobId: "own", revision: 1, updatedAt: "first" }];
    const where = vi.fn(() => ({ all: () => rows }));
    const from = vi.fn(() => ({ where }));
    const select = vi.spyOn(db, "select").mockReturnValue({ from } as never);
    try {
      const first = await resolvePdfFingerprintContext();
      expect(select).toHaveBeenCalledWith({
        jobId: schema.jobResumes.jobId,
        revision: schema.jobResumes.revision,
        updatedAt: schema.jobResumes.updatedAt,
      });
      expect(from).toHaveBeenCalledWith(schema.jobResumes);
      expect(where).toHaveBeenCalledWith(expect.anything());
      rows = [{ jobId: "own", revision: 2, updatedAt: "first" }];
      const revised = await resolvePdfFingerprintContext();
      expect(revised.jobResumeHashes?.own).not.toBe(first.jobResumeHashes?.own);
      rows = [{ jobId: "own", revision: 1, updatedAt: "recreated" }];
      const recreated = await resolvePdfFingerprintContext();
      expect(recreated.jobResumeHashes?.own).not.toBe(
        first.jobResumeHashes?.own,
      );
    } finally {
      select.mockRestore();
    }
  });
  it("maps missing PDFs to missing", () => {
    expect(getJobPdfFreshness(createJob(), context)).toBe("missing");
  });

  it("maps uploaded PDFs to uploaded", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/uploaded.pdf",
          pdfSource: "uploaded",
        }),
        context,
      ),
    ).toBe("uploaded");
  });

  it("maps active PDF generation to regenerating", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/generated.pdf",
          pdfSource: "generated",
          pdfRegenerating: true,
        }),
        context,
      ),
    ).toBe("regenerating");
  });

  it("maps generated PDFs with matching fingerprints to current", () => {
    const job = createJob({
      pdfPath: "data/pdfs/generated.pdf",
      pdfSource: "generated",
      tailoredSummary: "Summary",
    });
    const pdfFingerprint = createJobPdfFingerprint(job, context);

    expect(getJobPdfFreshness({ ...job, pdfFingerprint }, context)).toBe(
      "current",
    );
  });

  it("maps generated PDFs with mismatched fingerprints to stale", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/generated.pdf",
          pdfSource: "generated",
          pdfFingerprint: "old-fingerprint",
        }),
        context,
      ),
    ).toBe("stale");
  });

  it("ignores Typst theme changes for non-Typst renderers", () => {
    const job = createJob({
      pdfPath: "data/pdfs/generated.pdf",
      pdfSource: "generated",
      tailoredSummary: "Summary",
    });

    expect(createJobPdfFingerprint(job, context)).toBe(
      createJobPdfFingerprint(job, {
        ...context,
        typstTheme: "compact",
      }),
    );
  });

  it("includes Typst theme changes for Typst renderers", () => {
    const job = createJob({
      pdfPath: "data/pdfs/generated.pdf",
      pdfSource: "generated",
      tailoredSummary: "Summary",
    });

    expect(
      createJobPdfFingerprint(job, {
        ...context,
        pdfRenderer: "typst",
        typstTheme: "classic",
      }),
    ).not.toBe(
      createJobPdfFingerprint(job, {
        ...context,
        pdfRenderer: "typst",
        typstTheme: "compact",
      }),
    );
  });

  it("keeps existing fingerprints valid while the paper size is left to the renderer", () => {
    const job = createJob({
      id: "job-1",
      tailoredSummary: "Summary",
      jobDescription: "Build things",
      employer: "Acme",
    });

    expect(
      createJobPdfFingerprint(job, { ...context, pdfPaperSize: "auto" }),
    ).toBe("81b507dbebf69af4959b8bde9bb93465e790076876bb6dcdbea1de596e3276c5");
  });

  it("includes paper size changes for every renderer", () => {
    const job = createJob({ tailoredSummary: "Summary" });

    for (const pdfRenderer of ["rxresume", "latex", "typst"] as const) {
      const fingerprints = (["auto", "a4", "letter"] as const).map(
        (pdfPaperSize) =>
          createJobPdfFingerprint(job, {
            ...context,
            pdfRenderer,
            pdfPaperSize,
          }),
      );

      expect(new Set(fingerprints).size, pdfRenderer).toBe(3);
    }
  });

  it("includes resume project policy changes", () => {
    const job = createJob({ tailoredSummary: "Summary" });

    expect(createJobPdfFingerprint(job, context)).not.toBe(
      createJobPdfFingerprint(job, {
        ...context,
        resumeProjects: { ...context.resumeProjects, maxProjects: 4 },
      }),
    );
  });

  it("treats legacy PDFs without a source as generated for freshness", () => {
    expect(
      getJobPdfFreshness(
        createJob({
          pdfPath: "data/pdfs/legacy-generated.pdf",
          pdfSource: null,
          pdfFingerprint: "old-fingerprint",
        }),
        context,
      ),
    ).toBe("stale");
  });
});
