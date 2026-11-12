import { ApiClientError } from "@client/api/core";
import type {
  CoworkChatContext,
  JobResumeState,
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestionV2,
} from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/client/lib/queryKeys";

const mocks = vi.hoisted(() => ({
  getBase: vi.fn(),
  saveBase: vi.fn(),
  importFile: vi.fn(),
  importRx: vi.fn(),
  basePdf: vi.fn(),
  baseUrl: vi.fn(),
  baseDownload: vi.fn(),
  getResume: vi.fn(),
  listResumes: vi.fn(),
  navigate: vi.fn(),
  library: vi.fn(),
  sync: vi.fn(),
  updateBullet: vi.fn(),
  createBullet: vi.fn(),
  libraryProps: vi.fn(),
  editorProps: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
  getJob: vi.fn(),
  pdf: vi.fn(),
  openPdf: vi.fn(),
  downloadPdf: vi.fn(),
  toast: vi.fn(),
  coworkError: vi.fn(),
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@client/api/cowork", () => ({
  getJobResume: mocks.getResume,
  listResumes: mocks.listResumes,
  listCandidateLibrary: mocks.library,
  syncCandidateLibrary: mocks.sync,
  updateExperienceBullet: mocks.updateBullet,
  createExperienceBullet: mocks.createBullet,
  saveJobResume: mocks.save,
  deleteJobResume: mocks.reset,
}));
vi.mock("@client/api/settings-profile", () => ({
  getDesignResume: mocks.getBase,
  updateDesignResume: mocks.saveBase,
  importDesignResumeFromFile: mocks.importFile,
  importDesignResumeFromRxResume: mocks.importRx,
  generateDesignResumePdf: mocks.basePdf,
}));
vi.mock("@client/api/jobs", () => ({
  getJob: mocks.getJob,
  generateJobPdf: mocks.pdf,
}));
vi.mock("@/client/lib/private-pdf", () => ({
  createDesignResumePdfObjectUrl: mocks.baseUrl,
  downloadDesignResumePdf: mocks.baseDownload,
  createJobPdfObjectUrl: mocks.openPdf,
  downloadJobPdf: mocks.downloadPdf,
}));
vi.mock("@/client/components/cowork/PdfCanvasPreview", () => ({
  PdfCanvasPreview: ({ url }: { url: string }) => (
    <div data-testid="pdf-canvas-preview" data-url={url} />
  ),
}));
vi.mock("sonner", () => ({
  toast: { message: mocks.toast, success: vi.fn() },
}));
vi.mock("@/client/components/ghostwriter/GhostwriterPanel", () => ({
  GhostwriterPanel: ({
    cowork,
    referenceChips,
    initialPrompt,
    onSuggestions,
  }: {
    cowork: () => CoworkChatContext;
    referenceChips: React.ReactNode;
    initialPrompt?: string | null;
    onSuggestions: (items: ResumeSuggestionV2[]) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSuggestions([
            ...["one", "two", "three"].map((id) => ({
              id,
              op: "replace_headline",
              previousText: "Base",
              text: `Edited ${id}`,
              reason: "Review",
            })),
          ] as ResumeSuggestionV2[])
        }
      >
        Suggest edits
      </button>
      <button
        type="button"
        onClick={() =>
          onSuggestions([
            {
              id: "create",
              op: "create_library_item",
              reason: "New fact",
              item: { kind: "skill", text: "TypeScript" },
              includeOnResume: true,
            },
          ])
        }
      >
        Suggest library item
      </button>
      Chat {initialPrompt}
      {referenceChips}
      <output data-testid="focus">
        {JSON.stringify(cowork().focus?.map((f) => f.label))}
      </output>
    </div>
  ),
}));
vi.mock("@/client/components/cowork/JobMatchPanel", () => ({
  focusResumePart: vi.fn(),
  JobMatchPanel: ({
    active,
    onAskAi,
    onInsert,
  }: {
    onInsert: (bullet: { id: string; text: string }, id: string) => void;
    active: boolean;
    onAskAi: (prompt: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onAskAi("Close the Java gap")}>
        Job match {active ? "active" : "idle"}
      </button>
      <button
        type="button"
        onClick={() => onInsert({ id: "duty", text: "Library duty" }, "exp")}
      >
        Insert library duty
      </button>
    </>
  ),
}));
vi.mock("@/client/components/cowork/DutyLibrary", () => ({
  coworkError: mocks.coworkError,
}));
vi.mock("@/client/components/cowork/CandidateLibrary", () => ({
  CandidateLibrary: (props: {
    items?: unknown[];
    onItemsChange?: (items: unknown[]) => void;
    onDocumentChange?: (
      update: (doc: ReactiveResumeV5Document) => ReactiveResumeV5Document,
    ) => void;
    onSync?: () => Promise<unknown>;
  }) => {
    mocks.libraryProps(props);
    return (
      <div>
        Candidate checklist
        <button
          type="button"
          onClick={() => void props.onSync?.().catch(() => {})}
        >
          Sync library
        </button>
        <button
          type="button"
          onClick={() =>
            props.onItemsChange?.([
              { id: "changed", kind: "bullet", text: "Changed from checklist" },
            ])
          }
        >
          Change library items
        </button>
        <button
          type="button"
          onClick={() =>
            props.onDocumentChange?.((doc) => ({
              ...doc,
              basics: { ...doc.basics, headline: "Checklist edit" },
            }))
          }
        >
          Tick library item
        </button>
      </div>
    );
  },
}));
vi.mock("@/client/components/cowork/ResumeEditor", () => ({
  ResumeEditor: ({
    document,
    onChange,
    onAskAi,
    ...extra
  }: {
    library?: unknown;
    onSaveLineToLibrary?: (id: string, text: string) => void;
    document: ReactiveResumeV5Document;
    onChange: (document: ReactiveResumeV5Document) => void;
    onAskAi: (ref: ResumeFocusRef) => void;
  }) => {
    mocks.editorProps(extra);
    return (
      <>
        <button
          type="button"
          onClick={() =>
            extra.onSaveLineToLibrary?.("duty", "New library text")
          }
        >
          Save line to library
        </button>
        <button
          type="button"
          onClick={() => onAskAi({ kind: "headline", label: "Headline" })}
        >
          Ask AI
        </button>
        <input
          aria-label="Headline"
          value={document.basics.headline}
          onChange={(e) =>
            onChange({
              ...document,
              basics: { ...document.basics, headline: e.target.value },
            })
          }
        />
      </>
    );
  },
}));

import { ResumeCoworkPage } from "./ResumeCoworkPage";

function state(headline = "Base", revision = 0): JobResumeState {
  return {
    document: {
      basics: { headline },
      customSections: [],
      sections: { experience: { items: [] } },
    } as unknown as ReactiveResumeV5Document,
    revision,
    exists: revision > 0,
    updatedAt: null,
  };
}
function mount(base = false, queryClient = new QueryClient(), search = "") {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[(base ? "/resumes/base" : "/resumes/job") + search]}
      >
        <Link to="/resumes/job?mode=edit">Route edit</Link>
        <Link to="/resumes/job?mode=preview">Route preview</Link>
        <Link to="/resumes/other?mode=preview">Route other</Link>
        <Routes>
          <Route path="/resumes/base" element={<ResumeCoworkPage base />} />
          <Route path="/resumes/:jobId" element={<ResumeCoworkPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBase.mockResolvedValue({
    resumeJson: state().document,
    revision: 3,
    updatedAt: null,
  });
  mocks.saveBase.mockImplementation(async (input) => ({
    resumeJson: input.document,
    revision: input.baseRevision + 1,
    updatedAt: null,
  }));
  mocks.importRx.mockResolvedValue({});
  mocks.importFile.mockResolvedValue({});
  mocks.basePdf.mockResolvedValue({});
  mocks.baseUrl.mockResolvedValue("blob:base");
  mocks.baseDownload.mockResolvedValue(undefined);
  localStorage.clear();
  window.history.replaceState({ idx: 0 }, "");
  mocks.listResumes.mockResolvedValue({
    resumes: [
      { jobId: "job", title: "Engineer", employer: "Company" },
      { jobId: "other", title: "Designer", employer: "Another company" },
    ],
  });
  mocks.library.mockResolvedValue({
    items: [{ id: "duty", kind: "bullet", text: "Library duty" }],
  });
  mocks.getJob.mockResolvedValue({
    id: "job",
    title: "Engineer",
    employer: "Company",
  });
  mocks.getResume.mockResolvedValue(state());
  mocks.save.mockImplementation(
    async (
      _job: string,
      input: { document: ReactiveResumeV5Document; baseRevision: number },
    ) => ({ ...state("", input.baseRevision + 1), document: input.document }),
  );
  mocks.pdf.mockResolvedValue({});
  mocks.openPdf.mockResolvedValue("blob:fake");
  mocks.downloadPdf.mockResolvedValue(undefined);
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function selectOtherResume() {
  fireEvent.click(screen.getByRole("button", { name: /Switch resume/ }));
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Designer" },
  });
  const search = screen.getByRole("combobox");
  await waitFor(() =>
    expect(search.getAttribute("aria-activedescendant")).toContain(
      "-option-other",
    ),
  );
  fireEvent.keyDown(search, { key: "Enter" });
}

describe("resume navigation", () => {
  it("identifies the current resume and quietly falls back when listing fails", async () => {
    mocks.listResumes.mockRejectedValueOnce(new Error("Offline"));
    mount();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Engineer · Company",
      }),
    ).toBeInTheDocument();
    const switcher = screen.getByRole("button", { name: /Switch resume/ });
    expect(switcher).toHaveAccessibleName("Switch resume: Engineer · Company");
    fireEvent.click(switcher);
    const search = screen.getByRole("combobox");
    await waitFor(() =>
      expect(search.getAttribute("aria-activedescendant")).toContain(
        "-option-job",
      ),
    );
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toContain(
      "-option-base",
    );
    fireEvent.change(search, { target: { value: "Designer" } });
    expect(await screen.findByText("No results found.")).toBeVisible();
    expect(mocks.coworkError).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it.each([
    [1, -1],
    [0, "/resumes"],
  ] as const)("goes back with history index %s", async (idx, target) => {
    window.history.replaceState({ idx }, "");
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mocks.navigate).toHaveBeenCalledWith(target);
  });
  it("switches clean resumes immediately", async () => {
    mount();
    await screen.findByLabelText("Headline");
    await selectOtherResume();
    expect(mocks.navigate).toHaveBeenCalledWith("/resumes/other");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  it("keeps edits and stays when switching is cancelled", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    await selectOtherResume();
    expect(
      screen.getByRole("alertdialog", { name: "Unsaved changes" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Headline")).toHaveValue("Mine");
  });
  it("flushes before switching and prevents repeated saves", async () => {
    let resolveSave!: (value: JobResumeState) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<JobResumeState>((resolve) => {
          resolveSave = resolve;
        }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    await selectOtherResume();
    const button = screen.getByRole("button", { name: "Save and switch" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => resolveSave(state("Mine", 1)));
    expect(mocks.navigate).toHaveBeenCalledWith("/resumes/other");
  });
  it("waits for an in-flight save before switching", async () => {
    let resolveSave!: (value: JobResumeState) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<JobResumeState>((resolve) => {
          resolveSave = resolve;
        }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await selectOtherResume();
    fireEvent.click(screen.getByRole("button", { name: "Save and switch" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => resolveSave(state("Mine", 1)));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/resumes/other");
  });
  it.each([
    new Error("Offline"),
    new ApiClientError("Conflict", { status: 409 }),
  ])("stays when saving fails: %s", async (failure) => {
    mocks.save.mockRejectedValueOnce(failure);
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    await selectOtherResume();
    fireEvent.click(screen.getByRole("button", { name: "Save and switch" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "Unsaved changes" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Headline")).toHaveValue("Mine");
    if (failure instanceof ApiClientError)
      expect(
        screen.getByRole("alertdialog", { name: "Resume changed elsewhere" }),
      ).toBeVisible();
    else expect(mocks.coworkError).toHaveBeenCalledWith(failure);
  });
});

describe("resume co-work saving", () => {
  it("does not save the unedited base and debounces user edits", async () => {
    mount();
    await screen.findByLabelText("Headline");
    expect(mocks.save).not.toHaveBeenCalled();
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Draft one" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Draft two" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(699);
    });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][1]).toMatchObject({
      baseRevision: 0,
      document: { basics: { headline: "Draft two" } },
    });
  });
  it("retains edits made during an in-flight save and uses the returned revision", async () => {
    let resolveSave!: (value: JobResumeState) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<JobResumeState>((resolve) => {
          resolveSave = resolve;
        }),
    );
    mount();
    await screen.findByLabelText("Headline");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "First edit" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Second edit" },
    });
    await act(async () => {
      resolveSave(state("First edit", 1));
    });
    expect(screen.getByLabelText("Headline")).toHaveValue("Second edit");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(mocks.save.mock.calls[1][1]).toMatchObject({
      baseRevision: 1,
      document: { basics: { headline: "Second edit" } },
    });
  });
  it("keeps local edits on revision conflict and can load latest with undo", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409 }),
    );
    mocks.getResume
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state("Remote edit", 2));
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Local edit" },
    });
    fireEvent.click(screen.getByText("Save now"));
    await screen.findByText("Keep mine");
    expect(screen.getByLabelText("Headline")).toHaveValue("Local edit");
    fireEvent.click(screen.getByText("Use latest"));
    expect(screen.getByLabelText("Headline")).toHaveValue("Remote edit");
    fireEvent.click(screen.getByText("Undo"));
    expect(screen.getByLabelText("Headline")).toHaveValue("Local edit");
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it("ignores Ctrl+Z behind the conflict dialog and reports dropped edits on leave", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409 }),
    );
    mocks.getResume
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state("Remote", 4));
    const view = mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByText("Save now"));
    await screen.findByText("Keep mine");
    fireEvent.keyDown(screen.getByText("Keep mine"), {
      key: "z",
      ctrlKey: true,
    });
    expect(screen.getByLabelText("Headline")).toHaveValue("Mine");
    view.unmount();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.stringContaining("unsaved edits were not saved"),
      ),
    );
  });
  it("re-saves local edits against the latest revision when choosing Keep mine", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409 }),
    );
    mocks.getResume
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state("Remote", 4));
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByText("Save now"));
    fireEvent.click(await screen.findByText("Keep mine"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][1]).toMatchObject({
      baseRevision: 4,
      document: { basics: { headline: "Mine" } },
    });
    expect(screen.getByLabelText("Headline")).toHaveValue("Mine");
  });
  it("coalesces typing, ignores keyboard undo in fields, and autosaves page undo", async () => {
    mount();
    const field = await screen.findByLabelText("Headline");
    field.focus();
    fireEvent.change(field, { target: { value: "One" } });
    fireEvent.change(field, { target: { value: "Two" } });
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });
    expect(field).toHaveValue("Two");
    field.blur();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(field).toHaveValue("Base");
    expect(screen.getByText("Undo")).toBeDisabled();
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][1].document.basics.headline).toBe("Base");
  });
  it("caps page undo at the last 50 document changes", async () => {
    mount();
    const field = await screen.findByLabelText("Headline");
    for (let index = 1; index <= 55; index++)
      fireEvent.change(field, { target: { value: String(index) } });
    for (let index = 0; index < 50; index++)
      fireEvent.click(screen.getByText("Undo"));
    expect(field).toHaveValue("5");
    expect(screen.getByText("Undo")).toBeDisabled();
  });
  it("announces suggestions and displays their count on the Editor tab", async () => {
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest edits"));
    expect(screen.getByRole("tab", { name: "Editor (3)" })).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(
      "3 suggestions - review in Editor",
    );
  });
  it("dismisses only accepted ids after the resume CAS succeeds", async () => {
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest edits"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      await props.onAccept([props.suggestions[0]]);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Editor (2)" }),
      ).toBeInTheDocument(),
    );
    expect(mocks.save).toHaveBeenCalledWith("job", {
      baseRevision: 0,
      document: expect.objectContaining({ basics: { headline: "Edited one" } }),
    });
  });
  it("retains library failures and their reason without saving the resume", async () => {
    mocks.createBullet.mockRejectedValueOnce(new Error("offline"));
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest library item"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      await props.onAccept(props.suggestions);
    });
    await waitFor(() =>
      expect(
        mocks.editorProps.mock.lastCall?.[0].rejectionReasons.create,
      ).toContain("Library update failed"),
    );
    expect(mocks.editorProps.mock.lastCall?.[0].suggestions).toHaveLength(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("retains accepted suggestions when the resume CAS fails", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Unavailable", { status: 503 }),
    );
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest edits"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      await props.onAccept([props.suggestions[0]]);
    });
    await waitFor(() =>
      expect(
        mocks.editorProps.mock.lastCall?.[0].rejectionReasons.one,
      ).toContain("Resume save failed or conflicted"),
    );
    expect(mocks.editorProps.mock.lastCall?.[0].suggestions).toHaveLength(3);
  });
  it("dismisses applied suggestion ids after Keep mine resolves a CAS conflict", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409 }),
    );
    mocks.getResume
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state("Remote", 4));
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest edits"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      props.onAccept([props.suggestions[0]]);
    });
    fireEvent.click(await screen.findByText("Keep mine"));
    await waitFor(() =>
      expect(
        mocks.editorProps.mock.lastCall?.[0].suggestions.map(
          (s: ResumeSuggestionV2) => s.id,
        ),
      ).toEqual(["two", "three"]),
    );
    expect(mocks.save.mock.calls[1][1]).toMatchObject({
      baseRevision: 4,
      document: { basics: { headline: "Edited one" } },
    });
  });
  it("retains an accepted suggestion after its unsaved edit is undone", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Unavailable", { status: 503 }),
    );
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest edits"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      props.onAccept([props.suggestions[0]]);
    });
    await waitFor(() =>
      expect(
        mocks.editorProps.mock.lastCall?.[0].rejectionReasons.one,
      ).toContain("Resume save failed"),
    );
    fireEvent.click(screen.getByText("Undo"));
    expect(screen.getByLabelText("Headline")).toHaveValue("Base");
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.editorProps.mock.lastCall?.[0].suggestions).toHaveLength(3);
  });
  it("keeps pending accepted ids when undo only removes a later manual edit", async () => {
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Unavailable", { status: 503 }),
    );
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest edits"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      props.onAccept([props.suggestions[0]]);
    });
    await waitFor(() =>
      expect(
        mocks.editorProps.mock.lastCall?.[0].rejectionReasons.one,
      ).toContain("Resume save failed"),
    );
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Manual edit" },
    });
    fireEvent.click(screen.getByText("Undo"));
    expect(screen.getByLabelText("Headline")).toHaveValue("Edited one");
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() =>
      expect(
        mocks.editorProps.mock.lastCall?.[0].suggestions.map(
          (s: ResumeSuggestionV2) => s.id,
        ),
      ).toEqual(["two", "three"]),
    );
  });
  it("explains when an item was created but could not be placed on the resume", async () => {
    mocks.createBullet.mockResolvedValueOnce({
      bullet: {
        id: "created",
        kind: "bullet",
        parentId: "missing-parent",
        text: "New fact",
      },
    });
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Suggest library item"));
    await act(async () => {
      const props = mocks.editorProps.mock.lastCall?.[0];
      props.onAccept(props.suggestions);
    });
    await waitFor(() =>
      expect(mocks.editorProps.mock.lastCall?.[0].rejectionReasons.create).toBe(
        "Added to library; could not place on resume.",
      ),
    );
    expect(mocks.editorProps.mock.lastCall?.[0].suggestions).toHaveLength(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("flushes pending edits before rendering the PDF inline from the middle toolbar", async () => {
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Final edit" },
    });
    const renderButton = screen.getByRole("button", { name: "Preview" });
    expect(renderButton.closest("header")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "Editor" })).toContainElement(
      renderButton,
    );
    fireEvent.click(renderButton);
    expect(await screen.findByTestId("pdf-canvas-preview")).toHaveAttribute(
      "data-url",
      "blob:fake",
    );
    expect(localStorage.getItem("resume-cowork-preview")).toBe("true");
    expect(window.open).not.toHaveBeenCalled();
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pdf.mock.invocationCallOrder[0],
    );
  });
  it("replaces the displayed PDF and revokes its old URL when rendering again", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    mocks.openPdf
      .mockResolvedValueOnce("blob:first")
      .mockResolvedValueOnce("blob:second");
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByTestId("pdf-canvas-preview")).toHaveAttribute(
      "data-url",
      "blob:first",
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(screen.getByTestId("pdf-canvas-preview")).toHaveAttribute(
        "data-url",
        "blob:second",
      ),
    );
    expect(mocks.pdf).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:first");
  });
  it("flushes a pending debounced edit when leaving the job", async () => {
    const view = mount();
    await screen.findByLabelText("Headline");
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Last edit before leaving" },
    });
    view.unmount();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][1]).toMatchObject({
      baseRevision: 0,
      document: { basics: { headline: "Last edit before leaving" } },
    });
  });
  it("prompts before unload while dirty or saving, then allows unload after saving", async () => {
    let resolveSave!: (value: JobResumeState) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<JobResumeState>((resolve) => {
          resolveSave = resolve;
        }),
    );
    mount();
    await screen.findByLabelText("Headline");
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Unsaved" },
    });
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByText("Save now"));
    expect(unload()).toBe(true);
    await act(async () => resolveSave(state("Unsaved", 1)));
    expect(unload()).toBe(false);
  });
  it.each([
    new Error("Offline"),
    new ApiClientError("Conflict", { status: 409 }),
  ])("reports an unmount-flush failure: %s", async (failure) => {
    mocks.save.mockRejectedValueOnce(failure);
    const view = mount();
    await screen.findByLabelText("Headline");
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Last edit" },
    });
    view.unmount();
    await waitFor(() =>
      expect(
        failure instanceof ApiClientError ? mocks.toast : mocks.coworkError,
      ).toHaveBeenCalled(),
    );
  });
  it("requires confirmation before resetting and supports cancel", async () => {
    mocks.reset.mockResolvedValue(undefined);
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Reset to base"));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(mocks.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(mocks.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Reset to base"));
    fireEvent.click(screen.getByText("Reset resume"));
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledWith("job"));
  });
  it("offers the base editor when no base resume exists", async () => {
    mocks.getResume.mockRejectedValueOnce(
      new ApiClientError("Import or create a resume first", { status: 409 }),
    );
    mount();
    expect(
      await screen.findByText("Import or create a resume first."),
    ).toBeVisible();
    expect(screen.getByText("Open base resume")).toHaveAttribute(
      "href",
      "/resumes/base",
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("duty library insert", () => {
  it.each([
    "",
    "<ul><li>Existing</li></ul>",
  ])("preserves raw intro HTML with existing bullets %s", async (list) => {
    const initial = state();
    const intro =
      '<p class="intro">First <a href="https://example.com">link</a></p>\n<p>Second paragraph</p>';
    initial.document.sections.experience.items = [
      { id: "exp", description: intro + list },
    ] as ReactiveResumeV5Document["sections"]["experience"]["items"];
    mocks.getResume.mockResolvedValue(initial);
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByRole("tab", { name: "Job match" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Insert library duty" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Insert library duty" }),
    );
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(
      mocks.save.mock.calls[0][1].document.sections.experience.items[0]
        .description,
    ).toBe(
      intro +
        (list
          ? "<ul><li>Existing</li><li>Library duty</li></ul>"
          : "<ul><li>Library duty</li></ul>"),
    );
    expect(
      mocks.save.mock.calls[0][1].document.sections.experience.items[0]
        .bulletRefs,
    ).toEqual(list ? [null, "duty"] : ["duty"]);
  });
  it("opens Library by default and sends Job match Ask AI prompts to the chat", async () => {
    mount();
    await screen.findByLabelText("Headline");
    expect(screen.getByRole("tab", { name: "Library" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Candidate checklist")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Library & match" }));
    fireEvent.click(screen.getByRole("tab", { name: "Job match" }));
    fireEvent.click(screen.getByRole("button", { name: "Job match active" }));
    expect(screen.getByText("Chat Close the Java gap")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Library" }));
    expect(
      screen.queryByRole("button", { name: "Job match active" }),
    ).not.toBeInTheDocument();
  });
});

describe("resume co-work wide layout", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("activates Job match when all panes are visible", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByRole("tab", { name: "Job match" }));
    expect(
      screen.getByRole("button", { name: "Job match active" }),
    ).toBeInTheDocument();
  });
});

describe("resume co-work focus chips", () => {
  it("adds focus from Ask AI and chat drops, dedupes, sends and removes", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ask AI" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    const ref = {
      kind: "item",
      section: "experience",
      itemId: "e",
      label: "Experience › Citi",
    };
    const types = ["application/x-jobops-resume-focus"];
    const dataTransfer = { types, getData: () => JSON.stringify(ref) };
    fireEvent.drop(screen.getByRole("tabpanel", { name: "Chat" }), {
      dataTransfer,
    });
    await waitFor(() =>
      expect(screen.getByTestId("focus").textContent).toBe(
        '["Headline","Experience › Citi"]',
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove focus: Headline" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("focus").textContent).toBe(
        '["Experience › Citi"]',
      ),
    );
  });
});

describe("resume co-work chat drop zone", () => {
  it("keeps the highlight while crossing children and adds the dropped duty", async () => {
    mount();
    const chat = await screen.findByRole("tabpanel", { name: "Chat" });
    const child = within(chat).getByText(/^Chat/);
    const duty = { id: "duty", text: "Led the migration" };
    const dataTransfer = {
      types: ["application/x-jobops-bullet"],
      getData: () => JSON.stringify(duty),
    };
    fireEvent.dragEnter(chat, { dataTransfer });
    fireEvent.dragEnter(child, { dataTransfer });
    // Leaving the pane for its child must not drop the highlight.
    fireEvent.dragLeave(chat, { dataTransfer });
    expect(chat).toHaveAttribute("data-drag", "true");
    fireEvent.dragLeave(child, { dataTransfer });
    expect(chat).not.toHaveAttribute("data-drag");
    fireEvent.dragEnter(chat, { dataTransfer });
    fireEvent.drop(chat, { dataTransfer });
    expect(chat).not.toHaveAttribute("data-drag");
    expect(
      screen.getByRole("button", {
        name: "Remove reference: Led the migration",
      }),
    ).toBeInTheDocument();
    // A child unmounting mid-drag skips its dragleave; dragend still clears it.
    fireEvent.dragEnter(chat, { dataTransfer });
    fireEvent.dragEnter(child, { dataTransfer });
    fireEvent.dragEnd(window);
    expect(chat).not.toHaveAttribute("data-drag");
  });
});

describe("candidate library page wiring", () => {
  it("loads the library before reading a potentially restamped resume", async () => {
    let resolveLibrary!: (value: { items: [] }) => void;
    mocks.library.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLibrary = resolve;
        }),
    );
    mount();
    expect(mocks.getResume).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.library).toHaveBeenCalled());
    await act(async () => resolveLibrary({ items: [] }));
    await screen.findByLabelText("Headline");
    expect(mocks.library).toHaveBeenCalledOnce();
    expect(mocks.library.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getResume.mock.invocationCallOrder[0],
    );
    expect(mocks.editorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ library: [] }),
    );
  });
  it.each([
    "applied",
    "in_progress",
    "ready",
  ])("passes the frozen flag for %s jobs", async (status) => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      title: "Engineer",
      employer: "Acme",
      status,
    });
    mount();
    await screen.findByLabelText("Headline");
    expect(mocks.libraryProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jobId: "job",
        frozen: status !== "ready",
        document: expect.any(Object),
        onDocumentChange: expect.any(Function),
        onReferenceBullet: expect.any(Function),
      }),
    );
  });
  it("saves a rewording to the library with the open job excluded and refreshes editor data", async () => {
    mocks.updateBullet.mockResolvedValue({
      bullet: { id: "duty", kind: "bullet", text: "New library text" },
    });
    mocks.library
      .mockResolvedValueOnce({
        items: [{ id: "duty", kind: "bullet", text: "Library duty" }],
      })
      .mockResolvedValue({
        items: [{ id: "duty", kind: "bullet", text: "New library text" }],
      });
    const initial = state();
    initial.document.sections.experience.items = [
      {
        id: "exp",
        company: "Acme",
        roles: [],
        position: "Engineer",
        location: "",
        period: "",
        website: { url: "", label: "" },
        hidden: false,
        icon: "",
        description: "<ul><li>Library duty</li><li>My wording</li></ul>",
        bulletRefs: ["duty", "duty"],
      },
    ] as typeof initial.document.sections.experience.items;
    mocks.getResume.mockResolvedValue(initial);
    mount();
    fireEvent.click(await screen.findByText("Save line to library"));
    await waitFor(() =>
      expect(mocks.editorProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          library: [expect.objectContaining({ text: "New library text" })],
        }),
      ),
    );
    expect(mocks.updateBullet).toHaveBeenCalledWith(
      "duty",
      { text: "New library text" },
      "job",
    );
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(
      mocks.save.mock.calls[0][1].document.sections.experience.items[0]
        .description,
    ).toBe("<ul><li>New library text</li><li>My wording</li></ul>");
  });
  it("flushes edits before inline PDF rendering and remembers Preview", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Preview edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = await screen.findByTestId("pdf-canvas-preview");
    expect(preview).toHaveAttribute("data-url", "blob:fake");
    expect(
      screen.getByRole("document", { name: "Resume PDF preview" }),
    ).toContainElement(preview);
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pdf.mock.invocationCallOrder[0],
    );
    expect(localStorage.getItem("resume-cowork-preview")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Headline")).toHaveValue("Preview edit");
    expect(localStorage.getItem("resume-cowork-preview")).toBe("false");
  });
  it("opens and renders the remembered Preview mode", async () => {
    localStorage.setItem("resume-cowork-preview", "true");
    mount();
    expect(await screen.findByTestId("pdf-canvas-preview")).toHaveAttribute(
      "data-url",
      "blob:fake",
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.pdf).toHaveBeenCalledOnce();
  });
});

describe("workspace library coordination", () => {
  it("shares checklist changes with the editor without another request", async () => {
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Change library items"));
    expect(mocks.editorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        library: [
          { id: "changed", kind: "bullet", text: "Changed from checklist" },
        ],
      }),
    );
    expect(mocks.library).toHaveBeenCalledOnce();
  });
  it("flushes before Sync and blocks edits until the stamped revision has reloaded", async () => {
    let finishSync!: (result: {
      created: number;
      skipped: number;
      linked: number;
    }) => void;
    let finishReload!: (result: JobResumeState) => void;
    mocks.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }),
    );
    mocks.getResume.mockResolvedValueOnce(state()).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReload = resolve;
        }),
    );
    mount();
    const headline = await screen.findByLabelText("Headline");
    fireEvent.change(headline, { target: { value: "Before sync" } });
    fireEvent.click(screen.getByText("Sync library"));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sync.mock.invocationCallOrder[0],
    );
    fireEvent.change(headline, { target: { value: "During sync" } });
    expect(headline).toHaveValue("Before sync");
    await act(async () => finishSync({ created: 1, skipped: 0, linked: 2 }));
    await waitFor(() => expect(mocks.getResume).toHaveBeenCalledTimes(2));
    fireEvent.change(headline, { target: { value: "During reload" } });
    expect(headline).toHaveValue("Before sync");
    expect(screen.getByText("Save now")).toBeDisabled();
    await act(async () => finishReload(state("Stamped", 9)));
    expect(headline).toHaveValue("Stamped");
    expect(screen.getByText("Undo")).toBeDisabled();
    fireEvent.change(headline, { target: { value: "After sync" } });
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][1]).toMatchObject({
      baseRevision: 9,
      document: { basics: { headline: "After sync" } },
    });
  });
  it("leaves an unstamped resume in place when Sync linked nothing", async () => {
    mocks.sync.mockResolvedValueOnce({ created: 0, skipped: 2, linked: 0 });
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Sync library"));
    await waitFor(() => expect(screen.getByText("Save now")).toBeEnabled());
    expect(mocks.getResume).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("requires a successful reload after Sync failure before allowing another save", async () => {
    mocks.sync.mockResolvedValueOnce({ created: 1, skipped: 0, linked: 2 });
    mocks.getResume
      .mockResolvedValueOnce(state())
      .mockRejectedValueOnce(new Error("Reload unavailable"))
      .mockResolvedValueOnce(state("Reloaded", 12));
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByText("Sync library"));
    expect(
      await screen.findByText("Could not load this job’s resume."),
    ).toBeVisible();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Retry"));
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Safe edit" },
    });
    fireEvent.click(screen.getByText("Save now"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][1].baseRevision).toBe(12);
  });
  it("does not Sync if pending edits cannot be saved", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Offline"));
    mount();
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Keep my edit" },
    });
    fireEvent.click(screen.getByText("Sync library"));
    await waitFor(() => expect(mocks.coworkError).toHaveBeenCalled());
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Headline")).toHaveValue("Keep my edit");
  });
});

describe("base resume mode", () => {
  it("loads and saves the base with its revision and omits job tools", async () => {
    mount(true);
    expect(
      await screen.findByRole("heading", { name: "Base resume" }),
    ).toBeInTheDocument();
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.getResume).not.toHaveBeenCalled();
    expect(screen.queryByText("Co-work chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Job match idle")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset to base")).not.toBeInTheDocument();
    expect(mocks.libraryProps.mock.lastCall?.[0].jobId).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Updated base" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() =>
      expect(mocks.saveBase).toHaveBeenCalledWith({
        baseRevision: 3,
        document: expect.objectContaining({
          basics: { headline: "Updated base" },
        }),
      }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("invalidates cached base document and status after saving", async () => {
    const queryClient = new QueryClient();
    const keys = [
      queryKeys.designResume.current(),
      queryKeys.designResume.status(),
    ];
    for (const key of keys) queryClient.setQueryData(key, null);
    mount(true, queryClient);
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Saved base" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => {
      for (const key of keys)
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });
  it.each([
    "RxResume",
    "file",
  ])("invalidates base and onboarding caches after %s import", async (source) => {
    const queryClient = new QueryClient();
    const keys = [
      queryKeys.designResume.current(),
      queryKeys.designResume.status(),
      queryKeys.onboarding.status(),
    ];
    for (const key of keys) queryClient.setQueryData(key, null);
    mount(true, queryClient);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    if (source === "file")
      fireEvent.change(screen.getByLabelText("Import resume file"), {
        target: {
          files: [
            new File(["resume"], "resume.json", { type: "application/json" }),
          ],
        },
      });
    fireEvent.click(
      screen.getByRole("button", {
        name: source === "file" ? "Import file" : "Import from RxResume",
      }),
    );
    await waitFor(() => {
      for (const key of keys)
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });
  it("renders the saved base resume before downloading, so it matches the preview", async () => {
    mount(true);
    const download = await screen.findByRole("button", {
      name: "Download PDF",
    });
    expect(download).toBeEnabled();
    fireEvent.click(download);
    await waitFor(() =>
      expect(mocks.baseDownload).toHaveBeenCalledWith("resume.pdf"),
    );
    expect(mocks.basePdf.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.baseDownload.mock.invocationCallOrder[0],
    );
  });
  it("surfaces missing base PDF download errors", async () => {
    const failure = new ApiClientError("Missing PDF", { status: 404 });
    mocks.baseDownload.mockRejectedValueOnce(failure);
    mount(true);
    fireEvent.click(
      await screen.findByRole("button", { name: "Download PDF" }),
    );
    await waitFor(() =>
      expect(mocks.coworkError).toHaveBeenCalledWith(failure),
    );
  });
  it("closes import when flushing edits encounters a conflict", async () => {
    mount(true);
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    mocks.saveBase.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Import from RxResume" }),
    );
    await screen.findByRole("heading", { name: "Resume changed elsewhere" });
    expect(
      screen.queryByRole("heading", {
        name: "Import base resume?",
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(mocks.importRx).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use latest" }));
  });
  it("resets imported preview locally while preserving the shared preference", async () => {
    localStorage.setItem("resume-cowork-preview", "true");
    mount(true);
    await screen.findByTestId("pdf-canvas-preview");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Import from RxResume" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Import base resume?" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Headline")).toBeInTheDocument();
    expect(localStorage.getItem("resume-cowork-preview")).toBe("true");
  });
  it("offers Base resume in the job title switcher", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Switch resume/ }),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Base resume" },
    });
    const search = screen.getByRole("combobox");
    await waitFor(() =>
      expect(search.getAttribute("aria-activedescendant")).toContain(
        "-option-base",
      ),
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(mocks.navigate).toHaveBeenCalledWith("/resumes/base");
  });
  it("confirms RxResume import and reloads the editor", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect(mocks.importRx).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.importRx).not.toHaveBeenCalled();
    mocks.getBase.mockResolvedValue({
      resumeJson: state("Imported", 5).document,
      revision: 5,
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Import from RxResume" }),
    );
    expect(await screen.findByDisplayValue("Imported")).toBeInTheDocument();
    expect(mocks.importRx).toHaveBeenCalledOnce();
    expect(mocks.getBase).toHaveBeenCalledTimes(2);
  });
  it("imports a chosen file only after confirmation", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("Import resume file"), {
      target: {
        files: [
          new File(["resume"], "resume.json", { type: "application/json" }),
        ],
      },
    });
    expect(mocks.importFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    await waitFor(() =>
      expect(mocks.importFile).toHaveBeenCalledWith({
        fileName: "resume.json",
        mediaType: "application/json",
        dataBase64: "cmVzdW1l",
      }),
    );
    await waitFor(() => expect(mocks.getBase).toHaveBeenCalledTimes(2));
  });
  it("uses the base PDF APIs for render and download", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    expect(await screen.findByTestId("pdf-canvas-preview")).toHaveAttribute(
      "data-url",
      "blob:base",
    );
    expect(mocks.basePdf).toHaveBeenCalledOnce();
    expect(mocks.pdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() =>
      expect(mocks.baseDownload).toHaveBeenCalledWith("resume.pdf"),
    );
  });
  it("uses the same conflict dialog and latest base revision", async () => {
    mount(true);
    await screen.findByLabelText("Headline");
    mocks.saveBase.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409, code: "CONFLICT" }),
    );
    mocks.getBase.mockResolvedValue({
      resumeJson: state("Remote").document,
      revision: 8,
    });
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await screen.findByRole("heading", { name: "Resume changed elsewhere" });
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() =>
      expect(mocks.saveBase).toHaveBeenLastCalledWith({
        baseRevision: 8,
        document: expect.objectContaining({ basics: { headline: "Mine" } }),
      }),
    );
  });
});

it("can import a base resume when none exists yet", async () => {
  mocks.getBase.mockRejectedValueOnce(
    new ApiClientError("Missing", { status: 404 }),
  );
  mount(true);
  fireEvent.click(await screen.findByRole("button", { name: "Import" }));
  expect(screen.queryByText("Open base resume")).not.toBeInTheDocument();
  expect(mocks.importRx).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import from RxResume" }));
  expect(
    await screen.findByRole("heading", { name: "Base resume" }),
  ).toBeInTheDocument();
  expect(mocks.importRx).toHaveBeenCalledOnce();
});

describe("explicit resume opening", () => {
  it.each([
    "current",
    "uploaded",
  ] as const)("previews a %s PDF without materializing editable data", async (pdfFreshness) => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      title: "Selected",
      employer: "Company",
      status: "ready",
      pdfFreshness,
      pdfSource: pdfFreshness === "uploaded" ? "uploaded" : "generated",
    });
    localStorage.setItem("resume-cowork-preview", "false");
    mount(false, new QueryClient(), "?mode=preview");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await screen.findByRole("document", { name: "Resume PDF preview" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Selected · Company" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(mocks.getJob).toHaveBeenCalledWith("job");
    expect(mocks.library).not.toHaveBeenCalled();
    expect(mocks.getResume).not.toHaveBeenCalled();
    expect(mocks.getBase).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() =>
      expect(mocks.downloadPdf).toHaveBeenCalledWith("job", "resume.pdf"),
    );
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it("loads Edit lazily and exposes its explicit missing-source error", async () => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      title: "Engineer",
      employer: "Company",
      status: "ready",
      pdfFreshness: "uploaded",
      pdfSource: "uploaded",
    });
    mocks.getResume.mockRejectedValueOnce(
      new ApiClientError("Import or create a resume first", { status: 409 }),
    );
    mount(false, new QueryClient(), "?mode=preview");
    await screen.findByRole("document");
    expect(mocks.getResume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      await screen.findByText("Import or create a resume first."),
    ).toBeVisible();
    expect(mocks.getResume).toHaveBeenCalledWith("job");
    expect(mocks.library.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getResume.mock.invocationCallOrder[0],
    );
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "stale",
  ])("renders the saved tailored document for a %s PDF after the library load", async (pdfFreshness) => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      title: "Engineer",
      employer: "Company",
      status: "ready",
      pdfFreshness,
    });
    mocks.getResume.mockResolvedValue(state("Saved tailored", 7));
    mount(false, new QueryClient(), "?mode=preview");
    await screen.findByRole("document");
    expect(mocks.getResume).toHaveBeenCalledTimes(1);
    expect(mocks.library.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getResume.mock.invocationCallOrder[0],
    );
    expect(mocks.getResume.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pdf.mock.invocationCallOrder[0],
    );
    expect(mocks.pdf).toHaveBeenCalledWith("job");
    expect(mocks.pdf.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openPdf.mock.invocationCallOrder[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Headline")).toHaveValue("Saved tailored");
    expect(mocks.getBase).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "?mode=invalid",
  ])("keeps remembered preview for a compatible bare/invalid entry %s", async (search) => {
    localStorage.setItem("resume-cowork-preview", "true");
    mount(false, new QueryClient(), search);
    await screen.findByRole("document");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("overrides remembered preview with explicit Edit before first display", async () => {
    localStorage.setItem("resume-cowork-preview", "true");
    mount(false, new QueryClient(), "?mode=edit");
    expect(await screen.findByLabelText("Headline")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it("keeps a dirty document across same-job query changes and waits for its save before rendering", async () => {
    let completeSave!: (value: JobResumeState) => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<JobResumeState>((resolve) => {
          completeSave = resolve;
        }),
    );
    mount(false, new QueryClient(), "?mode=edit");
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Keep this edit" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Route preview" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.pdf).not.toHaveBeenCalled();
    await act(async () => completeSave(state("Keep this edit", 2)));
    await screen.findByRole("document");
    expect(mocks.pdf.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.save.mock.invocationCallOrder[0],
    );
    fireEvent.click(screen.getByRole("link", { name: "Route edit" }));
    expect(await screen.findByLabelText("Headline")).toHaveValue(
      "Keep this edit",
    );
    expect(mocks.getResume).toHaveBeenCalledTimes(1);
  });

  it("preserves uploaded bytes for manual Preview and download even with editable JSON", async () => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      title: "Engineer",
      employer: "Company",
      status: "ready",
      pdfFreshness: "uploaded",
      pdfSource: "uploaded",
    });
    mount(false, new QueryClient(), "?mode=edit");
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Editable JSON" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("document");
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() =>
      expect(mocks.downloadPdf).toHaveBeenCalledWith("job", "resume.pdf"),
    );
    expect(mocks.pdf).not.toHaveBeenCalled();
  });

  it("shows a failed authenticated fetch and retries the actual operation", async () => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      title: "Engineer",
      employer: "Company",
      status: "ready",
      pdfFreshness: "current",
    });
    mocks.openPdf.mockRejectedValueOnce(
      new ApiClientError("Please sign in again", { status: 401 }),
    );
    mount(false, new QueryClient(), "?mode=preview");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please sign in again",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("document");
    expect(mocks.openPdf).toHaveBeenCalledTimes(2);
    expect(mocks.getResume).not.toHaveBeenCalled();
  });

  it.each([
    { status: "processing", pdfFreshness: "missing" },
    { status: "discovered", readyAt: "2026-01-01", pdfFreshness: "missing" },
    { status: "discovered", readyAt: null, pdfFreshness: "missing" },
    { status: "ready", pdfFreshness: "current", pdfRegenerating: true },
  ])("guards unavailable or regenerating entry %# and allows retry", async (variant) => {
    mocks.getJob.mockResolvedValueOnce({
      id: "job",
      title: "Engineer",
      employer: "Company",
      ...variant,
    });
    mount(false, new QueryClient(), "?mode=preview");
    await screen.findByRole("alert");
    expect(mocks.library).not.toHaveBeenCalled();
    expect(mocks.getResume).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.openPdf).not.toHaveBeenCalled();
    mocks.getJob.mockResolvedValue({
      id: "job",
      status: "ready",
      pdfFreshness: "current",
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("document");
  });

  it("rejects a late PDF response after selecting a different job and revokes its URL", async () => {
    let resolveFirst!: (url: string) => void;
    mocks.getJob.mockImplementation(async (id) => ({
      id,
      title: id,
      employer: "Company",
      status: "ready",
      pdfFreshness: "current",
    }));
    mocks.openPdf
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("blob:other");
    mount(false, new QueryClient(), "?mode=preview");
    await waitFor(() => expect(mocks.openPdf).toHaveBeenCalledWith("job"));
    fireEvent.click(screen.getByRole("link", { name: "Route other" }));
    await waitFor(() =>
      expect(screen.getByTestId("pdf-canvas-preview")).toHaveAttribute(
        "data-url",
        "blob:other",
      ),
    );
    await act(async () => resolveFirst("blob:late"));
    expect(screen.getByTestId("pdf-canvas-preview")).toHaveAttribute(
      "data-url",
      "blob:other",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late");
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it("guards an Edit deep link whose job has started preparation", async () => {
    mocks.getJob.mockResolvedValueOnce({
      id: "job",
      title: "Engineer",
      employer: "Company",
      status: "processing",
    });
    mount(false, new QueryClient(), "?mode=edit");
    expect(
      await screen.findByText("Could not load this job’s resume."),
    ).toBeVisible();
    expect(mocks.library).not.toHaveBeenCalled();
    expect(mocks.getResume).not.toHaveBeenCalled();
  });

  it("retries a failed generated render using the same saved document", async () => {
    mocks.getJob.mockResolvedValue({
      id: "job",
      status: "ready",
      pdfFreshness: "stale",
    });
    mocks.pdf.mockRejectedValueOnce(new Error("Renderer unavailable"));
    mount(false, new QueryClient(), "?mode=preview");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Renderer unavailable",
    );
    expect(mocks.openPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("document");
    expect(mocks.pdf).toHaveBeenCalledTimes(2);
    expect(mocks.getResume).toHaveBeenCalledTimes(1);
  });
  it("waits for conflict resolution before an explicit same-job Preview renders", async () => {
    mount(false, new QueryClient(), "?mode=edit");
    fireEvent.change(await screen.findByLabelText("Headline"), {
      target: { value: "Mine" },
    });
    mocks.save.mockRejectedValueOnce(
      new ApiClientError("Conflict", { status: 409 }),
    );
    mocks.getResume.mockResolvedValue(state("Remote", 5));
    fireEvent.click(screen.getByRole("link", { name: "Route preview" }));
    await screen.findByRole("heading", { name: "Resume changed elsewhere" });
    expect(mocks.pdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use latest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "resolve any conflict",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("document");
    fireEvent.click(screen.getByRole("link", { name: "Route edit" }));
    expect(await screen.findByLabelText("Headline")).toHaveValue("Remote");
  });

  it("does not load or render a previously selected job after its late full-job read", async () => {
    let resolveJob!: (value: unknown) => void;
    mocks.getJob
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveJob = resolve;
          }),
      )
      .mockImplementation(async (id) => ({
        id,
        title: id,
        employer: "Company",
        status: "ready",
        pdfFreshness: "current",
      }));
    mount(false, new QueryClient(), "?mode=preview");
    await waitFor(() => expect(mocks.getJob).toHaveBeenCalledWith("job"));
    fireEvent.click(screen.getByRole("link", { name: "Route other" }));
    await screen.findByRole("document");
    await act(async () =>
      resolveJob({ id: "job", status: "ready", pdfFreshness: "stale" }),
    );
    expect(mocks.library).not.toHaveBeenCalled();
    expect(mocks.getResume).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.openPdf).toHaveBeenCalledExactlyOnceWith("other");
    expect(
      screen.getByRole("heading", { name: "other · Company" }),
    ).toBeVisible();
  });
});
