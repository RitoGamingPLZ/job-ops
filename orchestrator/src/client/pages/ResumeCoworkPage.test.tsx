import { ApiClientError } from "@client/api/core";
import type {
  CoworkChatContext,
  JobResumeState,
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
} from "@shared/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResume: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
  getJob: vi.fn(),
  pdf: vi.fn(),
  openPdf: vi.fn(),
  downloadPdf: vi.fn(),
  toast: vi.fn(),
  coworkError: vi.fn(),
}));
vi.mock("@client/api/cowork", () => ({
  getJobResume: mocks.getResume,
  saveJobResume: mocks.save,
  deleteJobResume: mocks.reset,
}));
vi.mock("@client/api/jobs", () => ({
  getJob: mocks.getJob,
  generateJobPdf: mocks.pdf,
}));
vi.mock("@/client/lib/private-pdf", () => ({
  createJobPdfObjectUrl: mocks.openPdf,
  downloadJobPdf: mocks.downloadPdf,
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
    onSuggestions: (items: ResumeSuggestion[]) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSuggestions([
            { id: "one" },
            { id: "two" },
            { id: "three" },
          ] as ResumeSuggestion[])
        }
      >
        Suggest edits
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
  }: {
    active: boolean;
    onAskAi: (prompt: string) => void;
  }) => (
    <button type="button" onClick={() => onAskAi("Close the Java gap")}>
      Job match {active ? "active" : "idle"}
    </button>
  ),
}));
vi.mock("@/client/components/cowork/DutyLibrary", () => ({
  DutyLibrary: ({
    onInsert,
  }: {
    onInsert: (bullet: { text: string }, id: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onInsert({ text: "Library duty" }, "exp")}
    >
      Insert library duty
    </button>
  ),
  coworkError: mocks.coworkError,
}));
vi.mock("@/client/components/cowork/ResumeEditor", () => ({
  ResumeEditor: ({
    document,
    onChange,
    onAskAi,
  }: {
    document: ReactiveResumeV5Document;
    onChange: (document: ReactiveResumeV5Document) => void;
    onAskAi: (ref: ResumeFocusRef) => void;
  }) => (
    <>
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
  ),
}));

import { ResumeCoworkPage } from "./ResumeCoworkPage";

function state(headline = "Base", revision = 0): JobResumeState {
  return {
    document: {
      basics: { headline },
      sections: { experience: { items: [] } },
    } as unknown as ReactiveResumeV5Document,
    revision,
    exists: revision > 0,
    updatedAt: null,
  };
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/resumes/job"]}>
      <Routes>
        <Route path="/resumes/:jobId" element={<ResumeCoworkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
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
    fireEvent.click(screen.getByText("Render PDF"));
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
  it("flushes pending edits before rendering and opening the PDF", async () => {
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Final edit" },
    });
    fireEvent.click(screen.getByText("Render PDF"));
    await waitFor(() =>
      expect(mocks.downloadPdf).toHaveBeenCalledWith("job", "resume.pdf"),
    );
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pdf.mock.invocationCallOrder[0],
    );
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
  it("offers Resume Studio when no base resume exists", async () => {
    mocks.getResume.mockRejectedValueOnce(
      new ApiClientError("Import or create a resume first", { status: 409 }),
    );
    mount();
    expect(
      await screen.findByText("Import or create a resume first."),
    ).toBeVisible();
    expect(screen.getByText("Open Resume Studio")).toHaveAttribute(
      "href",
      "/design-resume",
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
    fireEvent.click(screen.getByRole("tab", { name: "Duties" }));
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
  });
  it("opens Job match by default and sends Ask AI prompts to the chat", async () => {
    mount();
    await screen.findByLabelText("Headline");
    expect(screen.getByRole("tab", { name: "Job match" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Narrow screen: the pane is hidden until its outer tab is shown.
    expect(
      screen.getByRole("button", { name: "Job match idle" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Match & duties" }));
    fireEvent.click(screen.getByRole("button", { name: "Job match active" }));
    expect(screen.getByText("Chat Close the Java gap")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Duties" }));
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
