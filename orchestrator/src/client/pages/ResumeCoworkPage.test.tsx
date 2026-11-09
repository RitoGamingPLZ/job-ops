import { ApiClientError } from "@client/api/core";
import type { JobResumeState, ReactiveResumeV5Document } from "@shared/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
vi.mock("@/client/lib/private-pdf", () => ({ openJobPdf: mocks.openPdf }));
vi.mock("sonner", () => ({
  toast: { message: mocks.toast, success: vi.fn() },
}));
vi.mock("@/client/components/ghostwriter/GhostwriterPanel", () => ({
  GhostwriterPanel: () => <div>Chat</div>,
}));
vi.mock("@/client/components/cowork/DutyLibrary", () => ({
  DutyLibrary: () => <div>Library</div>,
  coworkError: mocks.coworkError,
}));
vi.mock("@/client/components/cowork/ResumeEditor", () => ({
  ResumeEditor: ({
    document,
    onChange,
  }: {
    document: ReactiveResumeV5Document;
    onChange: (document: ReactiveResumeV5Document) => void;
  }) => (
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
  mocks.openPdf.mockResolvedValue(undefined);
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
  it("reloads on revision conflict and stops PDF rendering", async () => {
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
    await waitFor(() =>
      expect(screen.getByLabelText("Headline")).toHaveValue("Remote edit"),
    );
    expect(mocks.toast).toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it("flushes pending edits before rendering and opening the PDF", async () => {
    mount();
    await screen.findByLabelText("Headline");
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Final edit" },
    });
    fireEvent.click(screen.getByText("Render PDF"));
    await waitFor(() => expect(mocks.openPdf).toHaveBeenCalledWith("job"));
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
