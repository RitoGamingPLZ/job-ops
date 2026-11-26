import { ApiClientError } from "@client/api/core";
import type { ExperienceBullet } from "@shared/types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    render(<DutyLibraryTools jobId="job" roles={[role]} onRefresh={vi.fn()} onRanked={onRanked} />);
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
    render(<DutyLibraryTools roles={[role]} onRefresh={refresh} onRanked={vi.fn()} />);
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
    render(<DutyLibraryTools roles={[]} onRefresh={vi.fn()} onRanked={vi.fn()} />);
    fireEvent.click(screen.getByText("Paste & extract"));
    fireEvent.change(screen.getByLabelText("Text to extract"), {
      target: { value: "My duties" },
    });
    fireEvent.click(screen.getByText("Extract drafts"));
    expect(await screen.findByText("Create selected duties")).toBeDisabled();
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
        return this.textContent?.startsWith("Tag") ? 40 : 20;
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
    const tags = Array.from({ length: 10 }, (_, index) => `Tag ${index}`);
    const visible = () =>
      screen.getAllByText(/^Tag \d$/).filter((chip) => !chip.hasAttribute("aria-hidden"));
    try {
      render(<InlineTags bullet={{ ...role, tags }} />);
      expect(visible()).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Show 8 more tags for Engineer" }),
      ).toHaveTextContent("+8");
      width = 240;
      act(() => resize());
      expect(visible()).toHaveLength(4);
      fireEvent.click(screen.getByRole("button", { name: "Show 6 more tags for Engineer" }));
      expect(screen.getByTitle("Tag 9")).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    } finally {
      clientWidth.mockRestore();
      offsetWidth.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it("renders all tags inline without overflow popover when expanded", () => {
    const tags = Array.from({ length: 10 }, (_, index) => `Tag ${index}`);
    const { container } = render(<InlineTags bullet={{ ...role, tags }} expanded />);
    for (const tag of tags) {
      const chip = screen.getByText(tag);
      expect(chip).toBeVisible();
      expect(chip).not.toHaveAttribute("aria-hidden");
    }
    expect(screen.queryByRole("button", { name: /more tags/ })).toBeNull();
    expect(container.firstChild).not.toBeNull();

    cleanup();
    const empty = render(<InlineTags bullet={{ ...role, tags: [] }} expanded />);
    expect(empty.container).toBeEmptyDOMElement();
  });
  it("reports unavailable and other failures through shared error helpers", () => {
    coworkError(new ApiClientError("Unavailable", { status: 501 }));
    expect(mocks.message).toHaveBeenCalledWith("Co-work is not available yet.");
    const failure = new Error("Offline");
    coworkError(failure);
    expect(mocks.error).toHaveBeenCalledWith(failure, "Could not complete resume action");
  });
});
