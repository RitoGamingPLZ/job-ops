import { ApiClientError } from "@client/api/core";
import type { ExperienceBullet } from "@shared/types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coworkError, DutyLibraryTools, InlineTags } from "./DutyLibrary";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  create: vi.fn(),
  rank: vi.fn(),
  message: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@client/api/cowork", () => ({
  extractExperienceBullets: mocks.extract,
  createExperienceBullet: mocks.create,
  rankExperienceBullets: mocks.rank,
}));
vi.mock("sonner", () => ({
  toast: { message: mocks.message, success: vi.fn() },
}));
vi.mock("@/client/lib/error-toast", () => ({ showErrorToast: mocks.error }));
const role: ExperienceBullet = {
  id: "role",
  kind: "role",
  text: "Engineer",
  data: { company: "Acme" },
  parentId: null,
  position: 0,
  company: null,
  role: null,
  startDate: null,
  endDate: null,
  tags: [],
  source: "manual",
  sourceExperienceId: null,
  createdAt: "2026-11-11",
  updatedAt: "2026-11-11",
};
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("candidate library duty tools", () => {
  it("ranks for the current job", async () => {
    const ranked = [{ bulletId: "duty", score: 90 }];
    mocks.rank.mockResolvedValue({ ranked });
    const onRanked = vi.fn();
    render(
      <DutyLibraryTools
        jobId="job"
        roles={[role]}
        onRefresh={vi.fn()}
        onRanked={onRanked}
      />,
    );
    fireEvent.click(screen.getByText("Rank for this job"));
    await waitFor(() => expect(onRanked).toHaveBeenCalledWith(ranked));
    expect(mocks.rank).toHaveBeenCalledWith("job");
  });
  it("extracts duties into the selected parent role and refreshes", async () => {
    mocks.extract.mockResolvedValue({
      drafts: [{ text: "Built tools", tags: [] }],
    });
    mocks.create.mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <DutyLibraryTools
        roles={[role]}
        onRefresh={refresh}
        onRanked={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Paste & extract"));
    fireEvent.change(screen.getByLabelText("Text to extract"), {
      target: { value: "My duties" },
    });
    fireEvent.click(screen.getByText("Extract drafts"));
    fireEvent.click(await screen.findByText("Create selected duties"));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      text: "Built tools",
      tags: [],
      kind: "bullet",
      parentId: "role",
      source: "ai_extract",
    });
  });
  it("requires a role before creating extracted duties", async () => {
    mocks.extract.mockResolvedValue({
      drafts: [{ text: "Built tools", tags: [] }],
    });
    render(
      <DutyLibraryTools roles={[]} onRefresh={vi.fn()} onRanked={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Paste & extract"));
    fireEvent.change(screen.getByLabelText("Text to extract"), {
      target: { value: "My duties" },
    });
    fireEvent.click(screen.getByText("Extract drafts"));
    expect(await screen.findByText("Create selected duties")).toBeDisabled();
  });
  it("adds deduplicated tags and removes existing tags", () => {
    const onSave = vi.fn();
    render(
      <InlineTags
        bullet={{ ...role, text: "Built tools", tags: ["Tools"] }}
        busy={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText("+ tag"));
    const input = screen.getByLabelText("Add skill to Built tools");
    fireEvent.change(input, { target: { value: "React, tools, react" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSave).toHaveBeenCalledWith(["Tools", "React"]);
    fireEvent.click(screen.getByLabelText("Remove Tools from Built tools"));
    expect(onSave).toHaveBeenLastCalledWith([]);
  });
  it("collapses tags to the available width and exposes overflow in a popover", () => {
    let width = 140;
    let resize = () => {};
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(() => width);
    const offsetWidth = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.textContent === "+ tag") return 30;
        if (this.tagName === "SPAN") return 20;
        return 40;
      });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const onSave = vi.fn();
    const tags = Array.from({ length: 10 }, (_, index) => `Tag ${index}`);
    try {
      render(
        <InlineTags bullet={{ ...role, tags }} busy={false} onSave={onSave} />,
      );
      expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(
        1,
      );
      expect(
        screen.getByRole("button", { name: "Show 9 more tags" }),
      ).toHaveTextContent("+9");
      fireEvent.click(screen.getByRole("button", { name: "+ tag" }));
      width = 240;
      act(() => resize());
      expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(
        4,
      );
      // Resize while the add button is unmounted, then close without changing tags.
      width = 220;
      act(() => resize());
      const input = screen.getByLabelText("Add skill to Engineer");
      fireEvent.change(input, { target: { value: "Tag 0" } });
      fireEvent.submit(input.closest("form") as HTMLFormElement);
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "+ tag" })).toBeVisible();
      expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(
        3,
      );
      width = 240;
      act(() => resize());
      expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(
        4,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show 6 more tags" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Tag 9 from Engineer" }),
      );
      expect(onSave).toHaveBeenCalledWith(tags.slice(0, 9));
    } finally {
      clientWidth.mockRestore();
      offsetWidth.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("reports unavailable and other failures through shared error helpers", () => {
    coworkError(new ApiClientError("Unavailable", { status: 501 }));
    expect(mocks.message).toHaveBeenCalledWith("Co-work is not available yet.");
    const failure = new Error("Offline");
    coworkError(failure);
    expect(mocks.error).toHaveBeenCalledWith(
      failure,
      "Could not complete resume action",
    );
  });
});

it("cancels tag creation with Escape, empty blur, or the cancel button", () => {
  const onSave = vi.fn();
  render(<InlineTags bullet={role} busy={false} onSave={onSave} />);
  fireEvent.click(screen.getByText("+ tag"));
  fireEvent.change(screen.getByLabelText("Add skill to Engineer"), {
    target: { value: "discard" },
  });
  fireEvent.keyDown(screen.getByLabelText("Add skill to Engineer"), {
    key: "Escape",
  });
  expect(screen.queryByLabelText("Add skill to Engineer")).toBeNull();
  fireEvent.click(screen.getByText("+ tag"));
  fireEvent.blur(screen.getByLabelText("Add skill to Engineer"));
  expect(screen.queryByLabelText("Add skill to Engineer")).toBeNull();
  fireEvent.click(screen.getByText("+ tag"));
  fireEvent.change(screen.getByLabelText("Add skill to Engineer"), {
    target: { value: "discard" },
  });
  fireEvent.click(screen.getByLabelText("Cancel adding tag to Engineer"));
  expect(screen.queryByLabelText("Add skill to Engineer")).toBeNull();
  expect(onSave).not.toHaveBeenCalled();
});
