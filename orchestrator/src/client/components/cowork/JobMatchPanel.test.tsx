import { ApiClientError } from "@client/api/core";
import type { Job, ReactiveResumeV5Document, ScreeningReport } from "@shared/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearScreeningCache, findFocusTarget, JobMatchPanel } from "./JobMatchPanel";

const mocks = vi.hoisted(() => ({
  screening: vi.fn(),
  list: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@client/api/cowork", () => ({
  getScreeningReport: mocks.screening,
  listExperienceBullets: mocks.list,
}));
vi.mock("sonner", () => ({
  toast: { message: mocks.toast, success: vi.fn(), error: vi.fn() },
}));

const job = {
  id: "job",
  title: "Engineer",
  employer: "Acme",
  jobDescription: "We need Java.",
} as Job;
const doc = { basics: {} } as unknown as ReactiveResumeV5Document;
const report: ScreeningReport = {
  jobTitle: "Backend Engineer",
  employer: "Acme",
  score: 62,
  summary: "Solid backend fit, missing Kafka.",
  requirements: [
    {
      id: "r1",
      text: "5+ years Java",
      importance: "must",
      category: "skill",
      status: "met",
      evidence: [
        {
          text: "Built Java services",
          focus: {
            kind: "bullet",
            section: "experience",
            itemId: "exp",
            bulletIndex: 1,
            label: "Experience › Citi",
          },
        },
      ],
      libraryBulletIds: [],
      tip: "",
    },
    {
      id: "r2",
      text: "Kafka",
      importance: "must",
      category: "skill",
      status: "missing",
      evidence: [],
      libraryBulletIds: [],
      tip: "Mention streaming work.",
    },
    {
      id: "r3",
      text: "AWS",
      importance: "nice",
      category: "skill",
      status: "in_library",
      evidence: [],
      libraryBulletIds: ["b1"],
      tip: "Add your AWS duty.",
    },
  ],
};
function mount(overrides: Partial<Parameters<typeof JobMatchPanel>[0]> = {}) {
  const props = {
    job,
    active: true,
    getDocument: () => doc,
    targets: [{ id: "exp", label: "Citi · Dev" }],
    onInsert: vi.fn(),
    onAskAi: vi.fn(),
    onFocusRef: vi.fn(),
    ...overrides,
  };
  render(<JobMatchPanel {...props} />);
  return props;
}
beforeEach(() => {
  vi.clearAllMocks();
  clearScreeningCache();
  mocks.screening.mockResolvedValue(report);
  mocks.list.mockResolvedValue({ bullets: [{ id: "b1", text: "Ran AWS" }] });
});
afterEach(cleanup);

describe("JobMatchPanel", () => {
  it("marks edits after a check as stale and checks the current document again", async () => {
    let current = doc;
    const props = {
      job,
      active: true,
      getDocument: () => current,
      targets: [],
      onInsert: vi.fn(),
      onAskAi: vi.fn(),
      onFocusRef: vi.fn(),
    };
    const view = render(<JobMatchPanel {...props} />);
    await screen.findByText(report.summary);
    expect(screen.queryByText("Resume changed since this check")).not.toBeInTheDocument();
    current = { ...doc, basics: { ...doc.basics, headline: "Updated" } };
    view.rerender(<JobMatchPanel {...props} />);
    expect(screen.getByText("Resume changed since this check")).toBeVisible();
    fireEvent.click(screen.getByText("Check again"));
    await waitFor(() =>
      expect(screen.queryByText("Resume changed since this check")).not.toBeInTheDocument(),
    );
    expect(mocks.screening).toHaveBeenLastCalledWith("job", current);
  });
  it("fetches on open, groups requirements and wires actions", async () => {
    const props = mount();
    expect(screen.getByTestId("job-match-loading")).toBeInTheDocument();
    await screen.findByText("Solid backend fit, missing Kafka.");
    expect(mocks.screening).toHaveBeenCalledWith("job", doc);
    expect(screen.getByLabelText("Screening score 62 of 100")).toBeVisible();
    expect(screen.getByText("Must-have")).toBeInTheDocument();
    expect(screen.getByText("Nice-to-have")).toBeInTheDocument();
    expect(screen.getByText("In your library")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Built Java services/));
    expect(props.onFocusRef).toHaveBeenCalledWith(report.requirements[0].evidence[0].focus);
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(props.onAskAi).toHaveBeenCalledWith(expect.stringContaining("Kafka"));
    expect(await screen.findByRole("button", { name: "Drag duty: Ran AWS" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show gaps only"));
    expect(screen.queryByText("5+ years Java")).not.toBeInTheDocument();
    expect(screen.getByText("Kafka")).toBeInTheDocument();
  });

  it("keeps the last report per job and refetches on Check again", async () => {
    mount();
    await screen.findByText("Kafka");
    cleanup();
    mount();
    expect(screen.getByText("Kafka")).toBeInTheDocument();
    expect(mocks.screening).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(mocks.screening).toHaveBeenCalledTimes(2));
  });

  it("auto-runs once per job per session, even after a failure", async () => {
    mocks.screening.mockRejectedValueOnce(new ApiClientError("x", { status: 500 }));
    mount();
    await waitFor(() => expect(mocks.screening).toHaveBeenCalledTimes(1));
    cleanup();
    mount();
    expect(await screen.findByRole("button", { name: "Check match" })).toBeInTheDocument();
    expect(mocks.screening).toHaveBeenCalledTimes(1);
  });

  it("waits until the tab is active", () => {
    mount({ active: false });
    expect(mocks.screening).not.toHaveBeenCalled();
  });

  it.each([404, 501])("shows a toast when the API returns %i", async (status) => {
    mocks.screening.mockRejectedValue(new ApiClientError("nope", { status }));
    mount();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Job match is not available yet."),
    );
    expect(mocks.screening).toHaveBeenCalledTimes(1);
  });
});

describe("findFocusTarget", () => {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-focus-section="experience">
      <section data-focus-item="exp"><li data-focus-bullet="0"></li><li data-focus-bullet="1" id="b"></li></section>
    </div>
    <div data-focus-section="summary" id="sum"></div>`;
  it("resolves bullet, then item, then section", () => {
    expect(
      findFocusTarget(root, {
        kind: "bullet",
        itemId: "exp",
        bulletIndex: 1,
        label: "",
      })?.id,
    ).toBe("b");
    expect(findFocusTarget(root, { kind: "item", itemId: "exp", label: "" })?.tagName).toBe(
      "SECTION",
    );
    expect(
      findFocusTarget(root, {
        kind: "item",
        section: "experience",
        itemId: "gone",
        label: "",
      })?.getAttribute("data-focus-section"),
    ).toBe("experience");
    expect(findFocusTarget(root, { kind: "summary", label: "" })?.id).toBe("sum");
  });
});
