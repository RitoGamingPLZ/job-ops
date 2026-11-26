import type { ResumeV5Document } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureJobResume } from "./job-resume";
import {
  generateDesignResumePdf,
  generatePdf,
  previewDesignResumePdfBytes,
  previewJobPdfBytes,
  setRemotePdfRenderer,
} from "./pdf";

vi.mock("./job-resume", () => ({
  ensureJobResume: vi.fn().mockResolvedValue(null),
}));

// Define mock data in hoisted block
const {
  currentLanguageSettings,
  currentPdfPaperSize,
  currentPdfRenderer,
  mocks,
  mockProfile,
  mockResumeRenderer,
} = vi.hoisted(() => {
  const profile = {
    $schema: "https://rxresu.me/schema.json",
    version: "5.0.0",
    picture: {
      hidden: true,
      url: "",
      size: 96,
      rotation: 0,
      aspectRatio: 1,
      borderRadius: 0,
      borderColor: "#000000",
      borderWidth: 0,
      shadowColor: "#000000",
      shadowWidth: 0,
    },
    basics: {
      name: "",
      headline: "Original Headline",
      email: "",
      phone: "",
      location: "",
      website: {
        url: "",
        label: "",
      },
      customFields: [],
    },
    summary: {
      title: "Summary",
      columns: 1,
      hidden: false,
      content: "Original Summary",
    },
    sections: {
      profiles: { title: "Profiles", columns: 1, hidden: false, items: [] },
      experience: {
        title: "Experience",
        columns: 1,
        hidden: false,
        items: [],
      },
      education: {
        title: "Education",
        columns: 1,
        hidden: false,
        items: [],
      },
      projects: {
        title: "Projects",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "p1",
            hidden: false,
            name: "Project 1",
            period: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
          {
            id: "p2",
            hidden: false,
            name: "Project 2",
            period: "",
            website: { url: "", label: "" },
            description: "",
            options: { showLinkInTitle: false },
          },
        ],
      },
      skills: {
        title: "Skills",
        columns: 1,
        hidden: false,
        items: [
          {
            id: "skill-1",
            hidden: false,
            icon: "",
            name: "Original Skill",
            proficiency: "",
            level: 0,
            keywords: [],
          },
        ],
      },
      languages: {
        title: "Languages",
        columns: 1,
        hidden: false,
        items: [],
      },
      interests: {
        title: "Interests",
        columns: 1,
        hidden: false,
        items: [],
      },
      awards: { title: "Awards", columns: 1, hidden: false, items: [] },
      certifications: {
        title: "Certifications",
        columns: 1,
        hidden: false,
        items: [],
      },
      publications: {
        title: "Publications",
        columns: 1,
        hidden: false,
        items: [],
      },
      volunteer: {
        title: "Volunteer",
        columns: 1,
        hidden: false,
        items: [],
      },
      references: {
        title: "References",
        columns: 1,
        hidden: false,
        items: [],
      },
    },
    customSections: [],
    metadata: {
      template: "rhyhorn",
      layout: {
        sidebarWidth: 220,
        pages: [
          {
            fullWidth: false,
            main: ["summary", "experience", "education", "projects"],
            sidebar: ["profiles", "skills", "languages"],
          },
        ],
      },
      css: {
        enabled: false,
        value: "",
      },
      page: {
        gapX: 18,
        gapY: 18,
        marginX: 18,
        marginY: 18,
        format: "a4",
        locale: "en",
        hideIcons: false,
        options: {
          breakLine: true,
          pageNumbers: true,
        },
      },
      design: {
        level: {
          icon: "circle",
          type: "hidden",
        },
        colors: {
          background: "#ffffff",
          text: "#000000",
          primary: "#2563eb",
        },
      },
      typography: {
        body: {
          fontFamily: "Inter",
          fontWeights: ["regular"],
          fontSize: 14,
          lineHeight: 1.5,
        },
        heading: {
          fontFamily: "Inter",
          fontWeights: ["600"],
          fontSize: 14,
          lineHeight: 1.25,
        },
      },
      notes: "",
    },
  };

  let lastResumeArgs: any = null;
  const renderer = {
    renderResumePdf: vi.fn().mockImplementation(async (args: any) => {
      lastResumeArgs = JSON.parse(JSON.stringify(args));
    }),
    getLastResumeJson: () => lastResumeArgs?.resumeJson ?? null,
    getLastResumeArgs: () => lastResumeArgs,
    clearLastResumeJson: () => {
      lastResumeArgs = null;
    },
  };

  return {
    currentLanguageSettings: {
      mode: "manual" as "manual" | "match-resume" | "match-job-description",
      manual: "english" as "english" | "german" | "french" | "spanish",
    },
    currentPdfPaperSize: { value: null as "auto" | "a4" | "letter" | null },
    currentPdfRenderer: { value: "latex" as "latex" | "typst" },
    mockProfile: profile,
    mocks: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
    mockResumeRenderer: renderer,
  };
});

// Configure base mock implementations
mocks.readFile.mockResolvedValue(JSON.stringify(mockProfile));
mocks.writeFile.mockResolvedValue(undefined);

vi.mock("fs/promises", async () => {
  return {
    default: mocks,
    ...mocks,
  };
});

vi.mock("node:fs/promises", async () => {
  return {
    default: mocks,
    ...mocks,
  };
});

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  createWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    }),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  createWriteStream: vi.fn().mockReturnValue({
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  }),
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    createWriteStream: vi.fn().mockReturnValue({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    }),
  },
}));

vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn().mockImplementation((key: string) => {
    if (key === "pdfRenderer") return Promise.resolve(currentPdfRenderer.value);
    if (key === "pdfPaperSize") {
      return Promise.resolve(currentPdfPaperSize.value);
    }
    if (key === "chatStyleLanguageMode") {
      return Promise.resolve(currentLanguageSettings.mode);
    }
    if (key === "chatStyleManualLanguage") {
      return Promise.resolve(currentLanguageSettings.manual);
    }
    return Promise.resolve(null);
  }),
  getAllSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("./profile", () => ({
  getProfile: vi.fn().mockResolvedValue(mockProfile),
}));

vi.mock("./resumeProjects", () => ({
  extractProjectsFromProfile: vi.fn().mockReturnValue({
    catalog: [],
    selectionItems: [
      { id: "p1", name: "Project 1" },
      { id: "p2", name: "Project 2" },
    ],
  }),
  resolveResumeProjectsSettings: vi.fn().mockReturnValue({
    resumeProjects: {
      lockedProjectIds: [],
      aiSelectableProjectIds: ["p1", "p2"],
      maxProjects: 3,
    },
  }),
}));

vi.mock("./resume-renderer", () => ({
  renderResumePdf: mockResumeRenderer.renderResumePdf,
}));

vi.mock("./design-resume", () => ({
  getCurrentDesignResume: vi.fn().mockResolvedValue(null),
  readDesignResumeAssetContent: vi.fn(),
}));

vi.mock("./resume-document", async () => {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  return {
    prepareTailoredResumeForPdf: vi.fn().mockImplementation(async (args: any) => {
      const data = clone(args.resumeData);
      if (args.tailedContent?.summary || args.tailoredContent?.summary) {
        const summary = args.tailoredContent?.summary;
        if (data.summary) data.summary.content = summary;
      }
      if (args.tailoredContent?.headline && data.basics) {
        data.basics.headline = args.tailoredContent.headline;
      }

      const selected = ((args.selectedProjectIds as string | null | undefined) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((id) => id === "p2");
      const selectedSet = new Set(["p1", ...selected]);
      for (const item of data.sections?.projects?.items ?? []) {
        item.hidden = !selectedSet.has(item.id);
      }
      if (data.sections?.projects) data.sections.projects.hidden = false;

      return {
        data,
      };
    }),
  };
});

describe("PDF Service Tailoring Logic", () => {
  it("delegates preview and saved PDFs with scoped picture bytes and never falls back locally", async () => {
    const { readDesignResumeAssetContent } = await import("./design-resume");
    const { getTenantId, runWithRequestContext } = await import("@infra/request-context");
    const { notFound } = await import("@infra/errors");
    const document = structuredClone(mockProfile);
    document.picture = {
      ...document.picture,
      hidden: false,
      url: "/api/design-resume/assets/photo-1/content",
    };
    vi.mocked(ensureJobResume).mockResolvedValue({
      document: document as ResumeV5Document,
      revision: 1,
      exists: true,
      updatedAt: "now",
    });
    vi.mocked(readDesignResumeAssetContent).mockImplementation(
      async () =>
        ({
          asset: { mimeType: "image/png" },
          content: Buffer.from(`photo-${getTenantId()}`),
        }) as Awaited<ReturnType<typeof readDesignResumeAssetContent>>,
    );
    currentPdfRenderer.value = "typst";
    const pdfBytes = new TextEncoder().encode("%PDF-remote");
    const remote = vi.fn().mockResolvedValue(pdfBytes);
    setRemotePdfRenderer(remote);
    try {
      for (const tenantId of ["tenant-a", "tenant-b"]) {
        const bytes = await runWithRequestContext(
          { tenantId, userId: "user-1", requestId: `req-${tenantId}` },
          () => previewJobPdfBytes("remote-job", "JD"),
        );
        expect(bytes).toEqual(pdfBytes);
        const [body, requestId] = remote.mock.lastCall!;
        expect(requestId).toBe(`req-${tenantId}`);
        expect(JSON.parse(body)).toMatchObject({
          renderer: "typst",
          language: "english",
          paperSize: "auto",
          jobId: "remote-job",
          picture: {
            mimeType: "image/png",
            base64: Buffer.from(`photo-${tenantId}`).toString("base64"),
          },
        });
      }
      expect(readDesignResumeAssetContent).toHaveBeenCalledWith("photo-1");
      expect(readDesignResumeAssetContent).not.toHaveBeenCalledWith("photo-1", expect.anything());
      expect((await generatePdf("remote-job", "JD")).success).toBe(true);
      expect(mockResumeRenderer.renderResumePdf).not.toHaveBeenCalled();
      expect(mocks.readFile).not.toHaveBeenCalled();

      // A missing or denied asset is omitted; the PDF still renders without the photo.
      remote.mockClear();
      vi.mocked(readDesignResumeAssetContent).mockRejectedValueOnce(
        notFound("Base resume asset not found."),
      );
      await expect(
        runWithRequestContext({ tenantId: "tenant-c", userId: "user-2" }, () =>
          previewJobPdfBytes("remote-job", "JD"),
        ),
      ).resolves.toEqual(pdfBytes);
      expect(JSON.parse(remote.mock.lastCall![0])).not.toHaveProperty("picture");
      remote.mockRejectedValueOnce(new Error("PDF render container failed with HTTP 503."));
      await expect(previewJobPdfBytes("remote-job", "JD")).rejects.toThrow("HTTP 503");
      expect(mockResumeRenderer.renderResumePdf).not.toHaveBeenCalled();
    } finally {
      setRemotePdfRenderer(null);
    }
  });

  it("renders the saved co-work document without applying legacy tailoring or project selection", async () => {
    const document = structuredClone(mockProfile);
    document.basics.headline = "User edited headline";
    document.summary.content = "User edited summary";
    document.sections.projects.items[0].hidden = true;
    document.sections.projects.items[1].hidden = false;
    vi.mocked(ensureJobResume).mockResolvedValue({
      document: document as ResumeV5Document,
      revision: 2,
      exists: true,
      updatedAt: "now",
    });
    const result = await generatePdf("saved-job", "JD", {
      requestOrigin: "https://jobops.example",
    });
    expect(result.success).toBe(true);
    expect(mockResumeRenderer.getLastResumeJson()).toMatchObject({
      basics: { headline: "User edited headline" },
      summary: { content: "User edited summary" },
      sections: {
        projects: {
          items: [
            expect.objectContaining({ hidden: true }),
            expect.objectContaining({ hidden: false }),
          ],
        },
      },
    });
    expect(document.basics.headline).toBe("User edited headline");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureJobResume).mockImplementation(async () => ({
      document: structuredClone(mockProfile) as ResumeV5Document,
      revision: 1,
      exists: true,
      updatedAt: "now",
    }));
    currentPdfRenderer.value = "latex";
    currentPdfPaperSize.value = null;
    currentLanguageSettings.mode = "manual";
    currentLanguageSettings.manual = "english";
    mockProfile.summary.content = "Original Summary";
    mockProfile.sections.projects.items[0].description = "";
    mocks.readFile.mockResolvedValue(JSON.stringify(mockProfile));
    mockResumeRenderer.clearLastResumeJson();
  });

  it("renders the editor document and ignores legacy summary and selectedProjectIds", async () => {
    await generatePdf("job-1", "Job Desc");

    // Verify prepared resume content
    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();

    const projects = savedResumeJson.sections.projects.items;
    const p1 = projects.find((p: any) => p.id === "p1");
    const p2 = projects.find((p: any) => p.id === "p2");

    expect(p2.hidden).toBe(false);
    expect(p1.hidden).toBe(false);

    // 3. Verify Summary Update
    const summary = savedResumeJson.summary.content;
    expect(summary).toBe("Original Summary");
  });

  it("should handle comma-separated project IDs correctly", async () => {
    await generatePdf("job-2", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();
    const projects = savedResumeJson.sections.projects.items;

    expect(projects.find((p: any) => p.id === "p1").hidden).toBe(false);
    expect(projects.find((p: any) => p.id === "p2").hidden).toBe(false);
  });

  it("keeps projects section visible when selected project list is explicitly empty", async () => {
    await generatePdf("job-empty-projects", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();
    const projects = savedResumeJson.sections.projects.items;

    expect(projects.find((p: any) => p.id === "p1").hidden).toBe(false);
    expect(projects.find((p: any) => p.id === "p2").hidden).toBe(false);
    expect(savedResumeJson.sections.projects.hidden).toBe(false);
  });

  it("preserves editor project visibility when legacy selection is absent", async () => {
    await generatePdf("job-3", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalled();
    const savedResumeJson = mockResumeRenderer.getLastResumeJson();

    const p1 = savedResumeJson.sections.projects.items.find((p: any) => p.id === "p1");
    const p2 = savedResumeJson.sections.projects.items.find((p: any) => p.id === "p2");

    expect(p1.hidden).toBe(false);
    expect(p2.hidden).toBe(false);

    const visibleCount = savedResumeJson.sections.projects.items.filter(
      (p: any) => !p.hidden,
    ).length;
    expect(visibleCount).toBe(2);
  });

  it("passes the manual output language to the local LaTeX renderer", async () => {
    currentLanguageSettings.mode = "manual";
    currentLanguageSettings.manual = "spanish";

    await generatePdf("job-spanish-latex", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-spanish-latex",
        language: "spanish",
      }),
    );
  });

  it("detects the resume language for local LaTeX rendering", async () => {
    currentLanguageSettings.mode = "match-resume";
    mockProfile.summary.content =
      "Je construis des systèmes fiables avec une expérience forte dans le développement.";
    mockProfile.sections.projects.items[0].description =
      "Responsable des APIs et du développement pour les équipes produit.";

    await generatePdf("job-french-latex", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-french-latex",
        language: "french",
      }),
    );
  });

  it("detects the job description language for local LaTeX rendering", async () => {
    currentLanguageSettings.mode = "match-job-description";

    await generatePdf(
      "job-german-jd-latex",
      "Wir suchen Erfahrung mit Entwicklung und Verantwortung für APIs.",
    );

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-german-jd-latex",
        language: "german",
      }),
    );
  });

  it("asks for a base resume import before rendering a missing base PDF", async () => {
    const designResume = await import("./design-resume");
    vi.mocked(designResume.getCurrentDesignResume).mockResolvedValueOnce(null);
    await expect(generateDesignResumePdf()).rejects.toThrow(
      "The base resume has not been imported yet.",
    );
  });

  it("returns language-aware filenames for generated Design Resume PDFs", async () => {
    currentLanguageSettings.mode = "manual";
    currentLanguageSettings.manual = "german";

    const designResume = await import("./design-resume");
    vi.mocked(designResume.getCurrentDesignResume).mockResolvedValueOnce({
      id: "design-resume-1",
      title: "Müller Büro",
      sourceResumeId: null,
      sourceMode: "v5",
      importedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      revision: 1,
      resumeJson: mockProfile,
    } as any);

    await expect(generateDesignResumePdf()).resolves.toMatchObject({
      fileName: "Mueller_Buero.pdf",
    });
  });

  it("uses the editor's Navy Serif theme by default for preview and generation", async () => {
    currentPdfRenderer.value = "typst";

    await previewJobPdfBytes("job-typst", "desc");
    await generatePdf("job-typst", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledTimes(2);
    for (const [args] of mockResumeRenderer.renderResumePdf.mock.calls) {
      expect(args).toMatchObject({
        jobId: "job-typst",
        renderer: "typst",
        typstTheme: "navy-serif",
      });
    }
  });

  it("leaves the paper size to the local renderer when none is configured", async () => {
    await generatePdf("job-default-paper", "desc");

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-default-paper",
        paperSize: "auto",
      }),
    );
  });

  it.each(["latex", "typst"] as const)(
    "passes the configured paper size to the local %s renderer",
    async (renderer) => {
      currentPdfRenderer.value = renderer;
      currentPdfPaperSize.value = "letter";

      await generatePdf("job-letter-paper", "desc");

      expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-letter-paper",
          renderer,
          paperSize: "letter",
        }),
      );
    },
  );

  it("passes the configured paper size when rendering the Design Resume preview", async () => {
    currentPdfPaperSize.value = "a4";

    const designResume = await import("./design-resume");
    vi.mocked(designResume.getCurrentDesignResume).mockResolvedValueOnce({
      id: "design-resume-1",
      title: "Jane Doe",
      sourceResumeId: null,
      sourceMode: "v5",
      importedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      revision: 1,
      resumeJson: mockProfile,
    } as any);

    await generateDesignResumePdf();

    expect(mockResumeRenderer.renderResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({ paperSize: "a4" }),
    );
  });

  it("renders preview bytes without writing to BlobStore, and persists on generate", async () => {
    const { getBlobStore, setBlobStore } = await import("@server/infra/blob-store");
    const put = vi.fn().mockResolvedValue(undefined);
    const mockStore = {
      ...getBlobStore(),
      put,
      delete: vi.fn().mockResolvedValue(undefined),
    };
    setBlobStore(mockStore as any);
    mocks.readFile.mockResolvedValueOnce(Buffer.from("%PDF-preview-job"));
    mocks.readFile.mockResolvedValueOnce(Buffer.from("%PDF-preview-design"));
    mocks.readFile.mockResolvedValueOnce(Buffer.from("%PDF-saved-job"));
    mocks.readFile.mockResolvedValueOnce(Buffer.from("%PDF-saved-design"));

    const designResume = await import("./design-resume");
    vi.mocked(designResume.getCurrentDesignResume).mockResolvedValue({
      id: "design-resume-1",
      title: "Resume Studio",
      sourceResumeId: null,
      sourceMode: "v5",
      importedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      revision: 1,
      resumeJson: mockProfile,
    } as any);

    try {
      const jobPreview = await previewJobPdfBytes("preview-job", "JD");
      expect(Buffer.from(jobPreview).toString()).toBe("%PDF-preview-job");
      const designPreview = await previewDesignResumePdfBytes();
      expect(Buffer.from(designPreview).toString()).toBe("%PDF-preview-design");
      expect(put).not.toHaveBeenCalled();

      const generated = await generatePdf("saved-job-r2", "JD");
      expect(generated.success).toBe(true);
      expect(put).toHaveBeenCalledWith(
        expect.stringContaining("resume_saved-job-r2.pdf"),
        expect.any(Uint8Array),
        { contentType: "application/pdf" },
      );

      await generateDesignResumePdf();
      expect(put).toHaveBeenCalledWith(
        expect.stringContaining("design_resume_current.pdf"),
        expect.any(Uint8Array),
        { contentType: "application/pdf" },
      );
    } finally {
      setBlobStore(null);
    }
  });

  it("reuses the stored base resume PDF until the resume or its render settings change", async () => {
    const { setBlobStore } = await import("@server/infra/blob-store");
    const files = new Map<string, Uint8Array>();
    const toBytes = (data: unknown) =>
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(data as Uint8Array);
    setBlobStore({
      get: async (key: string) => {
        const body = files.get(key);
        return body ? { key, body, size: body.length } : null;
      },
      put: async (key: string, data: unknown) => {
        const body = toBytes(data);
        files.set(key, body);
        return { key, size: body.length };
      },
      delete: async (key: string) => {
        files.delete(key);
      },
      list: async () => [],
      exists: async (key: string) => files.has(key),
    });
    const designResume = await import("./design-resume");
    const resume = (revision: number) =>
      ({
        id: "design-resume-1",
        title: "Jane Doe",
        sourceResumeId: null,
        sourceMode: "v5",
        importedAt: "2026-05-02T00:00:00.000Z",
        updatedAt: `2026-05-02T00:00:0${revision}.000Z`,
        revision,
        resumeJson: mockProfile,
      }) as any;
    const renders = () => mockResumeRenderer.renderResumePdf.mock.calls.length;
    const pdfKey = () => [...files.keys()].find((key) => key.endsWith("design_resume_current.pdf"));

    try {
      vi.mocked(designResume.getCurrentDesignResume).mockResolvedValue(resume(1));

      const first = await generateDesignResumePdf();
      expect(renders()).toBe(1);
      expect(pdfKey()).toBeDefined();

      // Nothing changed: the stored PDF is returned without rendering again.
      expect(await generateDesignResumePdf()).toEqual(first);
      expect(renders()).toBe(1);

      // A saved edit makes it stale.
      vi.mocked(designResume.getCurrentDesignResume).mockResolvedValue(resume(2));
      await generateDesignResumePdf();
      expect(renders()).toBe(2);
      await generateDesignResumePdf();
      expect(renders()).toBe(2);

      // So does a render setting.
      currentPdfPaperSize.value = "letter";
      await generateDesignResumePdf();
      expect(renders()).toBe(3);

      // And a stored file that has gone missing.
      files.delete(pdfKey() ?? "");
      await generateDesignResumePdf();
      expect(renders()).toBe(4);
      expect(pdfKey()).toBeDefined();
    } finally {
      setBlobStore(null);
    }
  });
});
