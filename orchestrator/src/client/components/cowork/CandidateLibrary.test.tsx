import type { ExperienceBullet, ReactiveResumeV5Document } from "@shared/types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateLibrary } from "./CandidateLibrary";
import { REWORDED_TINT_CLASS } from "./rewordTint";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  usage: vi.fn(),
  sync: vi.fn(),
  rank: vi.fn(),
  extract: vi.fn(),
  add: vi.fn(),
  subtract: vi.fn(),
  apply: vi.fn(),
  onResume: vi.fn(),
  lines: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@client/api/cowork", () => ({
  listCandidateLibrary: mocks.list,
  createExperienceBullet: mocks.create,
  updateExperienceBullet: mocks.update,
  deleteExperienceBullet: mocks.remove,
  getLibraryItemUsage: mocks.usage,
  syncCandidateLibrary: mocks.sync,
  rankExperienceBullets: mocks.rank,
  extractExperienceBullets: mocks.extract,
}));
vi.mock("@shared/resume-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/resume-links")>()),
  KIND_SECTION: { role: "experience", project: "projects", skill: "skills" },
  addToResume: mocks.add,
  removeFromResume: mocks.subtract,
  applyLibraryUpdate: mocks.apply,
  isOnResume: mocks.onResume,
  getItemLines: mocks.lines,
  sameLineText: (a: string, b: string) => a.trim() === b.trim(),
}));
vi.mock("@/client/lib/error-toast", () => ({ showErrorToast: mocks.error }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, message: vi.fn() },
}));
const role: ExperienceBullet = {
  id: "role",
  kind: "role",
  text: "Engineer",
  data: { company: "Acme", location: "London", period: "2020–2024" },
  parentId: null,
  position: 0,
  tags: [],
  source: "manual",
  company: "Acme",
  role: null,
  startDate: null,
  endDate: null,
  sourceExperienceId: null,
  createdAt: "2020",
  updatedAt: "2020",
};
const duty: ExperienceBullet = {
  ...role,
  id: "duty",
  kind: "bullet",
  text: "Built tools",
  parentId: role.id,
  data: null,
  tags: ["Tools"],
};
const project = {
  ...role,
  id: "project",
  kind: "project" as const,
  text: "Compiler",
  data: { period: "2024", website: "https://example.test" },
};
const skill = {
  ...role,
  id: "skill",
  kind: "skill" as const,
  text: "Languages",
  data: { keywords: ["TypeScript", "Rust"] },
};
const doc = {
  sections: {
    experience: { items: [{ id: "entry", libraryId: role.id }] },
    skills: {
      items: [{ id: "skills-entry", libraryId: skill.id, keywords: ["Rust"] }],
    },
  },
} as unknown as ReactiveResumeV5Document;
const library = [
  role,
  duty,
  project,
  {
    ...duty,
    id: "point",
    kind: "project_point" as const,
    parentId: project.id,
    text: "Parsed code",
  },
  skill,
  {
    ...role,
    id: "education",
    kind: "education" as const,
    text: "BSc",
    data: { school: "College", location: "Leeds", period: "2018" },
  },
  {
    ...role,
    id: "award",
    kind: "award" as const,
    text: "Prize",
    data: { date: "2020" },
  },
  {
    ...role,
    id: "certification",
    kind: "certification" as const,
    text: "Certificate",
    data: {
      issuer: "Institute",
      website: "https://example.test",
      date: "2021",
    },
  },
];
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ items: library });
  mocks.update.mockImplementation(async (id, input) => ({
    bullet: { ...library.find((item) => item.id === id), ...input },
  }));
  mocks.create.mockResolvedValue({ bullet: duty });
  mocks.remove.mockResolvedValue({ deleted: true });
  mocks.usage.mockResolvedValue({ jobIds: [], frozenJobIds: [] });
  mocks.onResume.mockReturnValue(false);
  mocks.lines.mockReturnValue([]);
  mocks.add.mockImplementation((document) => document);
  mocks.subtract.mockImplementation((document) => document);
  mocks.apply.mockImplementation((document) => document);
});
async function mount(props: Parameters<typeof CandidateLibrary>[0] = {}) {
  render(<CandidateLibrary {...props} />);
  const header = await screen.findByRole("button", {
    name: "Show roles for Acme",
  });
  if (header.getAttribute("aria-expanded") === "false") fireEvent.click(header);
  await screen.findByText("Built tools");
}
const otherRole: ExperienceBullet = {
  ...role,
  id: "other-role",
  text: "Designer",
  data: { company: "Globex", location: "Paris" },
  company: "Globex",
};
const otherDuty = {
  ...duty,
  id: "other-duty",
  parentId: otherRole.id,
  text: "Designed tools",
};
describe("candidate library", () => {
  it("expands only jobs with selected duties and toggles their headers", () => {
    mocks.onResume.mockImplementation((_doc, id) => id === duty.id);
    const props = {
      items: [role, duty, otherRole, otherDuty],
      jobId: "job",
      document: doc,
      onDocumentChange: vi.fn(),
    };
    const view = render(<CandidateLibrary {...props} />);
    const selected = screen.getByRole("button", {
      name: "Show roles for Acme",
    });
    const unselected = screen.getByRole("button", {
      name: "Show roles for Globex",
    });
    expect(selected).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Built tools")).toBeVisible();
    expect(unselected).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Designed tools")).toBeNull();
    fireEvent.click(unselected);
    expect(unselected).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Designed tools")).toBeVisible();
    fireEvent.click(selected);
    expect(selected).toHaveAttribute("aria-expanded", "false");
    // Resume updates change counts without reopening a manually collapsed job.
    view.rerender(<CandidateLibrary {...props} document={{ ...doc }} />);
    expect(selected).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Built tools")).toBeNull();
  });
  it("resets expanded jobs to the selected duties when switching jobs", () => {
    const otherDoc = { ...doc };
    mocks.onResume.mockImplementation((document, id) =>
      document === doc ? id === duty.id : id === otherDuty.id,
    );
    const props = {
      items: [role, duty, otherRole, otherDuty],
      onDocumentChange: vi.fn(),
    };
    const view = render(
      <CandidateLibrary {...props} jobId="first-job" document={doc} />,
    );
    expect(
      screen.getByRole("button", { name: "Show roles for Acme" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Show roles for Globex" }),
    ).toHaveAttribute("aria-expanded", "false");

    view.rerender(
      <CandidateLibrary {...props} jobId="second-job" document={otherDoc} />,
    );
    expect(
      screen.getByRole("button", { name: "Show roles for Acme" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Built tools")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show roles for Globex" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Designed tools")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Include Acme" }),
    ).toBeVisible();
    expect(screen.getByText("1/1 duties")).toBeVisible();
  });
  it("searches duties by text or tag and opens the matching jobs", () => {
    render(
      <CandidateLibrary
        items={[
          role,
          duty,
          { ...duty, id: "d2", text: "Led migrations", tags: ["Postgres"] },
          otherRole,
          otherDuty,
        ]}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "Search duties" });
    fireEvent.change(search, { target: { value: "postgres" } });
    expect(screen.getByText("Led migrations")).toBeVisible();
    expect(screen.queryByText("Built tools")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show roles for Globex" }),
    ).toBeNull();
    fireEvent.change(search, { target: { value: "designed" } });
    expect(screen.getByText("Designed tools")).toBeVisible();
    fireEvent.change(search, { target: { value: "nothing" } });
    expect(screen.getByText("No duties match “nothing”.")).toBeVisible();
  });
  it("opens only the first job in standalone mode after loading", async () => {
    mocks.list.mockResolvedValue({ items: [role, duty, otherRole] });
    render(<CandidateLibrary />);
    expect(
      await screen.findByRole("button", { name: "Show roles for Acme" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Show roles for Globex" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
  it("shows every section and no ticks in library-only mode", async () => {
    await mount();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Acme · London")).toBeVisible();
    for (const [section, text] of [
      ["Projects", "Compiler"],
      ["Skills", "Languages"],
      ["Education", "BSc"],
      ["Awards", "Prize"],
      ["Certifications", "Certificate"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: section }));
      expect(screen.getByText(text, { exact: true })).toBeVisible();
    }
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("ticks duties and grouped jobs through functional document updates", async () => {
    const change = vi.fn();
    await mount({ jobId: "job", document: doc, onDocumentChange: change });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include Built tools" }),
    );
    change.mock.calls[0][0](doc);
    expect(mocks.add).toHaveBeenCalledWith(doc, "duty", library);
    mocks.onResume.mockReturnValue(true);
    cleanup();
    await mount({ jobId: "job", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Acme" }));
    change.mock.calls.at(-1)?.[0](doc);
    expect(mocks.subtract).toHaveBeenCalledWith(doc, "role");
  });
  it("edits on Enter with skipJobId and propagates the before/after pair", async () => {
    const change = vi.fn();
    await mount({ jobId: "job/id", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("button", { name: "Built tools" }));
    const input = screen.getByRole("textbox", { name: "Duty" });
    fireEvent.change(input, { target: { value: "Built better tools" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "duty",
        { text: "Built better tools", data: null, tags: ["Tools"] },
        "job/id",
      ),
    );
    await waitFor(() => expect(change).toHaveBeenCalled());
    change.mock.calls[0][0](doc);
    expect(mocks.apply).toHaveBeenCalledWith(
      doc,
      duty,
      expect.objectContaining({ text: "Built better tools" }),
    );
  });
  it("cancels edits on Escape and refuses blank text", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Built tools" }));
    const input = screen.getByRole("textbox", { name: "Duty" });
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Duty" })).toBeNull(),
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("creates a duty under its role", async () => {
    await mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Add duty to Engineer" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Duty" }), {
      target: { value: "Mentored engineers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "bullet",
          parentId: "role",
          text: "Mentored engineers",
          data: null,
        }),
      ),
    );
  });
  it("confirms deletion with a unique resume count and preserves cancellation", async () => {
    mocks.usage.mockResolvedValue({
      jobIds: ["one", "two"],
      frozenJobIds: ["frozen"],
    });
    const change = vi.fn();
    await mount({ jobId: "one", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("button", { name: "Delete Built tools" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("used by 3 resumes");
    expect(dialog).toHaveTextContent("1 frozen resumes");
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Built tools" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete from library" }),
    );
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith("duty", "one"),
    );
    change.mock.calls[0][0](doc);
    expect(mocks.subtract).toHaveBeenCalledWith(doc, "duty");
  });
  it("deletes an unused project without confirmation and removes its points", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Compiler" }));
    await waitFor(() => expect(screen.queryByText("Parsed code")).toBeNull());
    expect(mocks.remove).toHaveBeenCalledWith("project", undefined);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("tints reworded linked duties with the shared class and resume wording title", async () => {
    mocks.lines.mockReturnValue([{ ref: "duty", text: "Reworded tools" }]);
    await mount({ jobId: "job", document: doc });
    const row = screen.getByRole("button", {
      name: "Built tools",
    }).parentElement;
    for (const className of REWORDED_TINT_CLASS.split(" "))
      expect(row).toHaveClass(className);
    expect(row).toHaveAttribute("title", "Reworded tools");
    expect(screen.getByRole("button", { name: "Built tools" })).toHaveAttribute(
      "title",
      "Reworded tools",
    );
  });
  it("keeps tags, chat references and rank results", async () => {
    const reference = vi.fn();
    mocks.rank.mockResolvedValue({
      ranked: [{ bulletId: "duty", score: 88, reason: "Relevant tools" }],
    });
    await mount({ jobId: "job", document: doc, onReferenceBullet: reference });
    expect(screen.getByText("Tools")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Chat reference: Built tools" }),
    );
    expect(reference).toHaveBeenCalledWith(duty);
    fireEvent.click(screen.getByRole("button", { name: "Rank for this job" }));
    expect(await screen.findByText("88/100")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Paste & extract" }),
    ).toBeVisible();
  });
  it("keeps duty actions on the first line and tags and score on the second", async () => {
    mocks.rank.mockResolvedValue({
      ranked: [{ bulletId: duty.id, score: 88, reason: "Relevant tools" }],
    });
    await mount({ jobId: "job", document: doc, onReferenceBullet: vi.fn() });
    const description = screen.getByRole("button", { name: duty.text });
    expect(description).toHaveClass("truncate");
    expect(description).toHaveAttribute("title", duty.text);
    const firstLine = description.parentElement as HTMLElement;
    const chat = within(firstLine).getByRole("button", {
      name: "Chat reference: Built tools",
    });
    expect(chat.textContent).toBe("");
    expect(chat.querySelector("svg")).not.toBeNull();
    const trash = within(firstLine).getByRole("button", {
      name: `Delete ${duty.text}`,
    });
    expect(trash).not.toHaveClass("opacity-0");
    fireEvent.click(screen.getByRole("button", { name: "Rank for this job" }));
    const score = await screen.findByText("88/100");
    expect(score).toHaveAttribute("title", "Relevant tools");
    expect(score).toHaveAttribute("tabindex", "0");
    expect(score).toHaveAccessibleName("88/100: Relevant tools");
    score.focus();
    expect(score).toHaveFocus();
    expect(screen.queryByText("Relevant tools")).toBeNull();
    expect(score.parentElement).toBe(firstLine.nextElementSibling);
    expect(
      within(score.parentElement as HTMLElement).getByText("Tools"),
    ).toBeVisible();
    fireEvent.click(description);
    expect(screen.getByRole("textbox", { name: "Duty" })).toHaveValue(
      duty.text,
    );
  });
  it.each([
    ["project", "Projects", "Compiler"],
    ["education", "Education", "BSc"],
    ["award", "Awards", "Prize"],
    ["certification", "Certifications", "Certificate"],
  ])("renders, adds and removes tags on a %s", async (id, section, text) => {
    mocks.list.mockResolvedValue({
      items: library.map((item) =>
        item.id === id ? { ...item, tags: ["Existing"] } : item,
      ),
    });
    await mount({ jobId: "job", document: doc });
    fireEvent.click(screen.getByRole("button", { name: section }));
    const description = screen.getByRole("button", {
      name: new RegExp(`^${text} ·`),
    });
    expect(description).toHaveClass("truncate");
    expect(description).toHaveAttribute("title", description.textContent);
    const firstLine = description.parentElement as HTMLElement;
    expect(
      within(firstLine).getByRole("button", { name: `Delete ${text}` }),
    ).toBeVisible();
    const tagsLine = firstLine.nextElementSibling as HTMLElement;
    expect(within(tagsLine).getByText("Existing")).toBeVisible();
    expect(within(tagsLine).queryByRole("button")).toBeNull();
    fireEvent.click(description);
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "New tag" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove tag Existing" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Remove tag New tag" }),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith(
        id,
        expect.objectContaining({ tags: ["New tag"] }),
        "job",
      ),
    );
    expect(await within(tagsLine).findByText("New tag")).toBeVisible();
  });
  it("syncs and reloads the library", async () => {
    mocks.sync.mockResolvedValue({ created: 3, skipped: 4, linked: 5 });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Sync from resumes" }));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "Synced 3; skipped 4; linked 5",
      ),
    );
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it("distinguishes load failure and allows retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    render(<CandidateLibrary />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load library",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Built tools")).toBeVisible();
  });
  it("changes resume keywords without PATCHing library keywords", async () => {
    const change = vi.fn();
    await mount({ jobId: "job", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    const rust = screen.getByRole("button", { name: "Rust" });
    expect(rust).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(rust);
    const next = change.mock.calls[0][0](doc);
    expect(mocks.subtract).toHaveBeenCalledWith(doc, "skill");
    expect(next).toBe(doc);
    expect(doc.sections.skills.items[0].keywords).toEqual(["Rust"]);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("creates a keyword in the library and selects it on the open resume", async () => {
    const change = vi.fn();
    await mount({ jobId: "job", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Languages" }));
    const input = screen.getByLabelText("Add skill");
    fireEvent.change(input, { target: { value: "Go" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "skill",
        expect.objectContaining({
          data: { keywords: ["TypeScript", "Rust", "Go"] },
        }),
        "job",
      ),
    );
    await waitFor(() => expect(change).toHaveBeenCalled());
    expect(
      change.mock.lastCall?.[0](doc).sections.skills.items[0].keywords,
    ).toEqual(["Rust", "Go"]);
  });
  it("scans only experience and project lines for rewording", async () => {
    mocks.lines.mockImplementation((entry) => {
      expect(entry.id).toBe("entry");
      return [];
    });
    await mount({ jobId: "job", document: doc });
    expect(mocks.lines).toHaveBeenCalled();
  });
  it("preserves frozen documents on edits and deletes while allowing ticks", async () => {
    const change = vi.fn();
    await mount({
      jobId: "job",
      frozen: true,
      document: doc,
      onDocumentChange: change,
    });
    fireEvent.click(screen.getByRole("button", { name: "Built tools" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Duty" }), {
      target: { value: "Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Updated" });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Updated" }));
    expect(change).toHaveBeenCalledTimes(1);
    change.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Delete Updated" }));
    await waitFor(() => expect(screen.queryByText("Updated")).toBeNull());
    expect(change).not.toHaveBeenCalled();
  });
  it("places add controls beside their headers and requires a job company", async () => {
    await mount();
    const add = screen.getByRole("button", { name: "Add duty to Engineer" });
    // A single role sits in its job's header, beside the add-duty button.
    expect(add.parentElement?.parentElement).toContainElement(
      screen.getByRole("button", { name: "Engineer · 2020–2024" }),
    );
    fireEvent.click(add);
    expect(
      within(screen.getByRole("dialog", { name: "Add duty" })).getByRole(
        "form",
        { name: "Edit library item" },
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const addRole = screen.getByRole("button", { name: "Add role at Acme" });
    expect(addRole.parentElement?.parentElement).toContainElement(
      screen.getByRole("button", { name: "Acme · London" }),
    );
    expect(
      screen.getByRole("button", { name: "Add job" }).parentElement,
    ).toContainElement(screen.getByRole("button", { name: "Paste & extract" }));
    fireEvent.click(screen.getByRole("button", { name: "Add job" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Position" }), {
      target: { value: "Engineer" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Edit library item" }));
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Company" }), {
      target: { value: "New company" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
  });
  it("keeps rank scores after a tag edit", async () => {
    mocks.rank.mockResolvedValue({
      ranked: [{ bulletId: "duty", score: 88, reason: "Relevant" }],
    });
    await mount({ jobId: "job", document: doc });
    fireEvent.click(screen.getByRole("button", { name: "Rank for this job" }));
    await screen.findByText("88/100");
    fireEvent.click(screen.getByRole("button", { name: "Built tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove tag Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("88/100")).toBeVisible();
  });
  it("keeps frozen resume keywords unchanged on library create and delete", async () => {
    const change = vi.fn();
    await mount({
      jobId: "job",
      frozen: true,
      document: doc,
      onDocumentChange: change,
    });
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Languages" }));
    const input = screen.getByLabelText("Add skill");
    fireEvent.change(input, { target: { value: "Go" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Remove skill Rust" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Go" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Rust" })).toBeNull();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "TypeScript" }));
    expect(change).toHaveBeenCalledTimes(1);
  });
  it("labels certification website editing as Link", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Certifications" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Certificate · Institute/ }),
    );
    expect(screen.getByRole("textbox", { name: "Link" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Website" })).toBeNull();
  });
  it("extracts duties into an explicitly chosen library role", async () => {
    mocks.extract.mockResolvedValue({
      drafts: [{ text: "Extracted duty", tags: ["Tools"] }],
    });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Paste & extract" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Text to extract" }), {
      target: { value: "My notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Extract drafts" }));
    await screen.findByText("Extracted duty");
    fireEvent.click(
      screen.getByRole("button", { name: "Create selected duties" }),
    );
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        text: "Extracted duty",
        tags: ["Tools"],
        kind: "bullet",
        parentId: "role",
        source: "ai_extract",
      }),
    );
  });
});

describe("candidate library workspace integration", () => {
  it("uses supplied items without another load and reports edits to the workspace", async () => {
    const onItemsChange = vi.fn();
    const view = render(
      <CandidateLibrary items={library} onItemsChange={onItemsChange} />,
    );
    expect(screen.getByText("Built tools")).toBeVisible();
    expect(mocks.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Built tools" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Duty" }), {
      target: { value: "Updated duty" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onItemsChange).toHaveBeenCalledWith(
        library.map((item) =>
          item.id === duty.id ? { ...duty, text: "Updated duty" } : item,
        ),
      ),
    );
    const updated = onItemsChange.mock.calls.at(-1)?.[0];
    view.rerender(
      <CandidateLibrary items={updated} onItemsChange={onItemsChange} />,
    );
    expect(
      await screen.findByRole("button", { name: "Updated duty" }),
    ).toBeVisible();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("delegates Sync to the workspace, then refreshes and reports the library", async () => {
    const onSync = vi
      .fn()
      .mockResolvedValue({ created: 1, skipped: 2, linked: 3 });
    const onItemsChange = vi.fn();
    await mount({ items: library, onItemsChange, onSync });
    fireEvent.click(screen.getByText("Sync from resumes"));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "Synced 1; skipped 2; linked 3",
      ),
    );
    expect(onSync).toHaveBeenCalledOnce();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(onItemsChange).toHaveBeenCalledWith(library);
  });
  it.each([
    false,
    true,
  ])("deletes moved child lines along with their parent; frozen=%s", async (frozen) => {
    const links = await vi.importActual<typeof import("@shared/resume-links")>(
      "@shared/resume-links",
    );
    mocks.subtract.mockImplementation(links.removeFromResume);
    const initial = {
      ...doc,
      customSections: [],
      sections: {
        ...doc.sections,
        experience: {
          items: [
            { id: "original", libraryId: role.id, description: "" },
            {
              id: "other",
              libraryId: "other-role",
              description: "<ul><li>Built tools</li><li>Keep me</li></ul>",
              bulletRefs: [duty.id, null],
            },
          ],
        },
      },
    } as unknown as ReactiveResumeV5Document;
    let current = initial;
    const change = vi.fn((update) => {
      current = update(current);
    });
    await mount({
      jobId: "job",
      document: initial,
      frozen,
      onDocumentChange: change,
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete Acme" }));
    await waitFor(() => expect(screen.queryByText("Built tools")).toBeNull());
    expect(mocks.remove).toHaveBeenCalledWith(role.id, "job");
    if (frozen) {
      expect(change).not.toHaveBeenCalled();
      expect(current).toBe(initial);
    } else {
      expect(current.sections.experience.items).toHaveLength(1);
      expect(links.getItemLines(current.sections.experience.items[0])).toEqual([
        { text: "Keep me", ref: null },
      ]);
    }
  });
  it.each(
    (["role", "project", "certification"] as const).flatMap((kind) =>
      [
        {
          website: { url: "https://example.test", label: "Site" },
          label: "Site",
        },
        { website: "https://example.test", label: "" },
      ].map((value) => ({ kind, ...value })),
    ),
  )("displays and edits $kind website URLs with label '$label'", async ({
    kind,
    website,
    label,
  }) => {
    const entry = {
      ...role,
      id: "entry",
      kind,
      text: "Entry",
      data: {
        ...role.data,
        website,
      },
    };
    mocks.update.mockImplementation(async (id, input) => ({
      bullet: { ...entry, id, ...input },
    }));
    render(<CandidateLibrary items={[entry]} />);
    if (kind === "role")
      fireEvent.click(screen.getByRole("button", { name: "Acme · London" }));
    else {
      fireEvent.click(
        screen.getByRole("button", {
          name: kind === "project" ? "Projects" : "Certifications",
        }),
      );
      expect(screen.queryByText(/\[object Object\]/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Entry ·/ }));
    }
    const url = screen.getByRole("textbox", {
      name: kind === "certification" ? "Link" : "Website",
    });
    expect(url).toHaveValue("https://example.test");
    fireEvent.change(url, { target: { value: "https://changed.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "entry",
        expect.objectContaining({
          data: expect.objectContaining({
            website: { url: "https://changed.test", label },
          }),
        }),
        undefined,
      ),
    );
  });
});

it("renders Contact first, edits contact data, and hides standalone ticks", async () => {
  const contact = {
    ...role,
    id: "email",
    kind: "contact" as const,
    text: "a@example.com",
    data: { type: "email", value: "a@example.com" },
  };
  render(<CandidateLibrary items={[contact]} />);
  const sections = screen.getByRole("region", { name: "Library sections" });
  expect(within(sections).getAllByRole("button")[0]).toHaveTextContent(
    "Contact",
  );
  fireEvent.click(screen.getByRole("button", { name: "Contact" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "a@example.com · email" }),
  );
  expect(screen.queryByLabelText("Text")).toBeNull();
  expect(screen.queryByLabelText("Label")).toBeNull();
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "b@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith(
      "email",
      expect.objectContaining({
        text: "b@example.com",
        data: { type: "email", value: "b@example.com" },
      }),
      undefined,
    ),
  );
});
it("derives email ticks from the document and replaces the selected value", () => {
  const contact = {
    ...role,
    id: "email",
    kind: "contact" as const,
    text: "b@example.com",
    data: { type: "email", value: "b@example.com" },
  };
  const document = {
    ...doc,
    basics: { email: "a@example.com" },
  } as ReactiveResumeV5Document;
  const change = vi.fn();
  render(
    <CandidateLibrary
      items={[contact]}
      jobId="job"
      document={document}
      onDocumentChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Contact" }));
  const tick = screen.getByRole("checkbox", { name: "Include b@example.com" });
  expect(tick).not.toBeChecked();
  fireEvent.click(tick);
  expect(change.mock.calls[0][0](document).basics.email).toBe("b@example.com");
});

it("names repeated add controls after their role, company, and item", () => {
  render(
    <CandidateLibrary
      items={[
        role,
        { ...role, id: "manager", text: "Manager" },
        {
          ...role,
          id: "designer",
          text: "Designer",
          data: { company: "Beta" },
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Show roles for Beta" }));
  for (const name of ["Engineer", "Manager", "Designer"])
    expect(
      screen.getByRole("button", { name: `Add duty to ${name}` }),
    ).toBeVisible();
  for (const name of ["Acme", "Beta"])
    expect(
      screen.getByRole("button", { name: `Add role at ${name}` }),
    ).toBeVisible();
});

it("explains contact sync and creates contacts from Value alone", async () => {
  render(<CandidateLibrary items={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Contact" }));
  expect(
    screen.getByText(
      "Add a contact or sync to import missing contacts from your base resume.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  expect(screen.queryByLabelText("Text")).toBeNull();
  expect(screen.queryByLabelText("Label")).toBeNull();
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "a@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "a@example.com",
        data: { type: "email", value: "a@example.com" },
      }),
    ),
  );
});
