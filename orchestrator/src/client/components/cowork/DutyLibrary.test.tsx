import { ApiClientError } from "@client/api/core";
import type { ExperienceBullet } from "@shared/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DutyLibrary, groupBulletsByJob, summarizeSkills } from "./DutyLibrary";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  label: vi.fn(),
  update: vi.fn(),
  importResume: vi.fn(),
  toast: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@client/api/cowork", () => ({
  listExperienceBullets: mocks.list,
  createExperienceBullet: mocks.create,
  deleteExperienceBullet: mocks.remove,
  labelExperienceBullets: mocks.label,
  updateExperienceBullet: mocks.update,
  syncCandidateLibrary: mocks.importResume,
}));
vi.mock("sonner", () => ({
  toast: { message: mocks.toast, success: mocks.success },
}));
const bullet: ExperienceBullet = {
  id: "one",
  kind: "bullet" as const,
  data: null,
  parentId: null,
  position: 0,
  text: "Built tools",
  company: "Company",
  role: "Engineer",
  tags: ["Tools"],
  startDate: null,
  endDate: null,
  source: "manual",
  sourceExperienceId: null,
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ bullets: [bullet] });
  mocks.create.mockResolvedValue(bullet);
  mocks.remove.mockResolvedValue(undefined);
});
describe("duty library review regressions", () => {
  it("saves the current tag draft when Enter submits without blur", async () => {
    render(
      <MemoryRouter>
        <DutyLibrary />
      </MemoryRouter>,
    );
    await screen.findByText("Built tools");
    fireEvent.click(screen.getByText("Add duty"));
    fireEvent.change(screen.getByLabelText("Duty"), {
      target: { value: "New duty" },
    });
    const tags = screen.getByLabelText("Tags (comma separated)");
    fireEvent.change(tags, { target: { value: "Machine Learning" } });
    fireEvent.keyDown(tags, { key: "Enter", code: "Enter" });
    // jsdom does not perform the browser's implicit form submission on Enter.
    const form = tags.closest("form");
    if (!form) throw new Error("Tags must be inside the duty form");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ["Machine Learning"] }),
      ),
    );
  });
  it("preserves multi-word tags until blur, omitting empty tags", async () => {
    render(
      <MemoryRouter>
        <DutyLibrary />
      </MemoryRouter>,
    );
    await screen.findByText("Built tools");
    fireEvent.click(screen.getByText("Add duty"));
    fireEvent.change(screen.getByLabelText("Duty"), {
      target: { value: "New duty" },
    });
    const tags = screen.getByLabelText("Tags (comma separated)");
    fireEvent.change(tags, { target: { value: "Machine " } });
    expect(tags).toHaveValue("Machine ");
    fireEvent.change(tags, {
      target: { value: "Machine Learning, Developer Tools, ," },
    });
    fireEvent.blur(tags);
    fireEvent.click(screen.getByText("Save duty"));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["Machine Learning", "Developer Tools"],
        }),
      ),
    );
  });
  it("requires confirmation to delete a duty and supports cancel", async () => {
    render(
      <MemoryRouter>
        <DutyLibrary />
      </MemoryRouter>,
    );
    await screen.findByText("Built tools");
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Delete duty"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("one"));
  });
});

describe("job grouping and skill summary", () => {
  it("groups matching jobs, separating roles, dates and ambiguous delimiters", () => {
    const rows = [
      bullet,
      { ...bullet, id: "two" },
      { ...bullet, id: "role", role: "Lead" },
      { ...bullet, id: "dates", startDate: "2020", endDate: "2022" },
      { ...bullet, id: "slash1", company: "A / B", role: "C" },
      { ...bullet, id: "slash2", company: "A", role: "B / C" },
      { ...bullet, id: "missing", company: null, role: null },
    ];
    const groups = groupBulletsByJob(rows);
    expect(groups).toHaveLength(6);
    expect(
      groups
        .find(
          (group) =>
            group.company === "Company" &&
            group.role === "Engineer" &&
            !group.dates,
        )
        ?.bullets.map((b) => b.id),
    ).toEqual(["one", "two"]);
    expect(groups.find((group) => group.dates)?.dates).toBe("2020 – 2022");
    expect(groups[5]).toMatchObject({
      company: "Other",
      role: "Other",
      dates: "",
    });
    expect(groupBulletsByJob([])).toEqual([]);
  });
  it("orders recent stints first, missing company/role last, and duties by creation across refresh", () => {
    const rows = [
      { ...bullet, id: "old", startDate: "2018", endDate: "2019" },
      { ...bullet, id: "present", startDate: "2021", endDate: "Present" },
      { ...bullet, id: "current", startDate: "2023", endDate: null },
      { ...bullet, id: "ended", startDate: "2020", endDate: "2024-03" },
      { ...bullet, id: "unknown", company: null, startDate: "2026" },
      { ...bullet, id: "unknown-role", role: null, startDate: "2027" },
      { ...bullet, id: "earlier", startDate: "2023", createdAt: "2020-01-01" },
    ];
    const groups = groupBulletsByJob(rows);
    expect(groups.map((group) => group.bullets.map((item) => item.id))).toEqual(
      [
        ["earlier", "current"],
        ["present"],
        ["ended"],
        ["old"],
        ["unknown-role"],
        ["unknown"],
      ],
    );
    expect(
      groupBulletsByJob(
        [...rows].reverse().map((item) => ({ ...item, updatedAt: "2030" })),
      ).map((group) => group.bullets.map((item) => item.id)),
    ).toEqual(groups.map((group) => group.bullets.map((item) => item.id)));
  });
  it("counts each tag once per duty, trims and folds case, sorts by count then name", () => {
    expect(
      summarizeSkills([
        { ...bullet, tags: [" TypeScript ", "typescript", "", "Tools"] },
        { ...bullet, tags: ["TYPESCRIPT", "Architecture"] },
      ]),
    ).toEqual([
      { tag: "TypeScript", count: 2 },
      { tag: "Architecture", count: 1 },
      { tag: "Tools", count: 1 },
    ]);
    expect(summarizeSkills([])).toEqual([]);
  });
});

function renderLibrary() {
  return render(
    <MemoryRouter>
      <DutyLibrary />
    </MemoryRouter>,
  );
}
describe("library skills", () => {
  it("labels unlabeled duties and merges the response without losing other duties", async () => {
    mocks.list.mockResolvedValue({
      bullets: [
        bullet,
        { ...bullet, id: "two", text: "Built services", tags: [] },
      ],
    });
    let resolveLabel!: (value: {
      bullets: ExperienceBullet[];
      labeled: number;
    }) => void;
    mocks.label.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLabel = resolve;
        }),
    );
    renderLibrary();
    const button = await screen.findByRole("button", {
      name: "Label with AI (1 unlabeled)",
    });
    fireEvent.click(button);
    expect(mocks.label).toHaveBeenCalledWith();
    expect(button).toBeDisabled();
    resolveLabel({
      bullets: [
        { ...bullet, id: "two", text: "Built services", tags: ["Services"] },
      ],
      labeled: 1,
    });
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Labeled 1 duty"),
    );
    expect(screen.getByText("Built tools")).toBeVisible();
    expect(screen.getByText("Built services")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Label with AI (0 unlabeled)" }),
    ).toBeDisabled();
    expect(
      within(screen.getByRole("region", { name: "Skills" })).getByRole(
        "button",
        { name: "Services (1)" },
      ),
    ).toBeVisible();
  });
  it("reports zero labeled duties as information", async () => {
    mocks.list.mockResolvedValue({ bullets: [{ ...bullet, tags: [] }] });
    mocks.label.mockResolvedValue({ bullets: [], labeled: 0 });
    renderLibrary();
    const button = await screen.findByRole("button", {
      name: "Label with AI (1 unlabeled)",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("Nothing to label"),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });
  it("caps chips at eight and keeps skills out of the job summary", async () => {
    const tags = Array.from({ length: 12 }, (_, index) => `Skill ${index}`);
    mocks.list.mockResolvedValue({ bullets: [{ ...bullet, tags }] });
    renderLibrary();
    const text = await screen.findByText("Built tools");
    const skills = screen.getByRole("region", { name: "Skills" });
    expect(
      within(skills).getAllByRole("button", { pressed: false }),
    ).toHaveLength(8);
    fireEvent.click(within(skills).getByRole("button", { name: "+4" }));
    expect(
      within(skills).getAllByRole("button", { pressed: false }),
    ).toHaveLength(12);
    const details = text.closest("details") as HTMLElement;
    const summary = details.querySelector("summary") as HTMLElement;
    expect(summary).not.toHaveTextContent("Skill");
    expect(details.querySelector("summary + div")?.children).toHaveLength(9);
    const article = text.closest("article") as HTMLElement;
    expect(
      within(article).getAllByRole("button", { name: /^Remove / }),
    ).toHaveLength(8);
    fireEvent.click(within(article).getByRole("button", { name: "+4" }));
    expect(
      within(article).getAllByRole("button", { name: /^Remove / }),
    ).toHaveLength(12);
  });
  it.each([
    404, 501,
  ])("shows an unavailable toast for HTTP %s and allows retry", async (status) => {
    mocks.list.mockResolvedValue({ bullets: [{ ...bullet, tags: [] }] });
    mocks.label.mockRejectedValue(
      new ApiClientError("Unavailable", { status }),
    );
    renderLibrary();
    const button = await screen.findByRole("button", {
      name: "Label with AI (1 unlabeled)",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "AI labeling is not available yet.",
      ),
    );
    expect(button).toBeEnabled();
    expect(screen.getByText("Built tools")).toBeVisible();
  });
  it("filters by a summary skill and toggles it off", async () => {
    mocks.list.mockResolvedValue({
      bullets: [
        bullet,
        { ...bullet, id: "two", text: "Led teams", tags: ["Leadership"] },
      ],
    });
    renderLibrary();
    await screen.findByText("Led teams");
    const skill = within(
      screen.getByRole("region", { name: "Skills" }),
    ).getByRole("button", { name: "Tools (1)" });
    fireEvent.click(skill);
    expect(screen.queryByText("Led teams")).not.toBeInTheDocument();
    expect(skill).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(skill);
    expect(screen.getByText("Led teams")).toBeVisible();
  });
  it("adds and removes tags inline through PATCH", async () => {
    mocks.update.mockImplementation(async (_id, input) => ({
      bullet: { ...bullet, ...input },
    }));
    renderLibrary();
    await screen.findByText("Built tools");
    expect(
      screen.queryByRole("textbox", { name: "Add skill to Built tools" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ tag" }));
    const input = screen.getByRole("textbox", {
      name: "Add skill to Built tools",
    });
    fireEvent.change(input, {
      target: { value: "TypeScript, React, tools, typescript, ," },
    });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("one", {
        tags: ["Tools", "TypeScript", "React"],
      }),
    );
    const remove = await screen.findByRole("button", {
      name: "Remove Tools from Built tools",
    });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith("one", {
        tags: ["TypeScript", "React"],
      }),
    );
  });
  it("syncs resumes and reports created, skipped and linked counts", async () => {
    mocks.importResume.mockResolvedValue({ created: 2, skipped: 1, linked: 3 });
    renderLibrary();
    await screen.findByText("Built tools");
    fireEvent.click(screen.getByRole("button", { name: "Sync from resumes" }));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "Synced 2; skipped 1; linked 3",
      ),
    );
  });
  it("inserts into an experience and references a duty through the menu", async () => {
    const onInsert = vi.fn();
    const onReference = vi.fn();
    render(
      <MemoryRouter>
        <DutyLibrary
          targets={[{ id: "experience", label: "Current role" }]}
          onInsert={onInsert}
          onReference={onReference}
        />
      </MemoryRouter>,
    );
    await screen.findByText("Built tools");
    const trigger = screen.getByRole("button", { name: "Insert into…" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Current role" }),
    );
    expect(onInsert).toHaveBeenCalledWith(bullet, "experience");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Chat reference" }),
    );
    expect(onReference).toHaveBeenCalledWith(bullet);
  });
  it("preserves native drag payloads and collapsible job headers", async () => {
    renderLibrary();
    const text = await screen.findByText("Built tools");
    const setData = vi.fn();
    const handle = screen.getByRole("button", {
      name: "Drag duty: Built tools",
    });
    expect(handle).toHaveAttribute("draggable", "true");
    expect(text.closest("article")).not.toHaveAttribute("draggable");
    fireEvent.click(screen.getByRole("button", { name: "+ tag" }));
    expect(
      screen
        .getByRole("textbox", { name: "Add skill to Built tools" })
        .closest("[draggable=true]"),
    ).toBeNull();
    const dataTransfer = { setData, effectAllowed: "none" };
    fireEvent.dragStart(handle, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(setData).toHaveBeenCalledWith(
      "application/x-jobops-bullet",
      JSON.stringify({ id: "one", text: "Built tools" }),
    );
    expect(text.closest("details")).toHaveAttribute("open");
    expect(
      screen.getByText("Company → Engineer").closest("summary"),
    ).toBeInTheDocument();
  });
});
