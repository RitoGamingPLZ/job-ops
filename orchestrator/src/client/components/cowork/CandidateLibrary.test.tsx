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
vi.mock("@shared/resume-links", () => ({
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
  await screen.findByText("Built tools");
}
describe("candidate library", () => {
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
    const input = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(input, { target: { value: "Built better tools" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "duty",
        { text: "Built better tools", data: null },
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
  it("cancels inline edits on Escape and refuses blank text", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Built tools" }));
    const input = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Text" })).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("creates a duty under its role", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add duty" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
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
  it("tints reworded linked duties with the shared class and original text title", async () => {
    mocks.lines.mockReturnValue([{ ref: "duty", text: "Reworded tools" }]);
    await mount({ jobId: "job", document: doc });
    const row = screen.getByRole("button", {
      name: "Built tools",
    }).parentElement;
    for (const className of REWORDED_TINT_CLASS.split(" "))
      expect(row).toHaveClass(className);
    expect(row).toHaveAttribute("title", duty.text);
  });
  it("keeps tags, drag payload, chat references and rank results", async () => {
    const reference = vi.fn();
    mocks.rank.mockResolvedValue({
      ranked: [{ bulletId: "duty", score: 88, reason: "Relevant tools" }],
    });
    await mount({ jobId: "job", document: doc, onReferenceBullet: reference });
    expect(
      screen.getByRole("button", { name: "Remove Tools from Built tools" }),
    ).toBeVisible();
    const setData = vi.fn();
    fireEvent.dragStart(
      screen.getByRole("button", { name: "Drag duty: Built tools" }),
      { dataTransfer: { setData } },
    );
    expect(setData).toHaveBeenCalledWith(
      "application/x-jobops-bullet",
      JSON.stringify({ id: duty.id, text: duty.text }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat reference" }));
    expect(reference).toHaveBeenCalledWith(duty);
    fireEvent.click(screen.getByRole("button", { name: "Rank for this job" }));
    expect(await screen.findByText("88/100")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Paste & extract" }),
    ).toBeVisible();
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
    fireEvent.click(screen.getByRole("button", { name: "Untick Rust" }));
    const next = change.mock.calls[0][0](doc);
    expect(next.sections.skills.items[0].keywords).toEqual([]);
    expect(doc.sections.skills.items[0].keywords).toEqual(["Rust"]);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("creates a keyword in the library and selects it on the open resume", async () => {
    const change = vi.fn();
    await mount({ jobId: "job", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create / delete keywords" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Search or create Languages keywords",
      }),
      { target: { value: "Go" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create 'Go'" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        "skill",
        { data: { keywords: ["TypeScript", "Rust", "Go"] } },
        "job",
      ),
    );
    await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
    expect(
      change.mock.calls[1][0](doc).sections.skills.items[0].keywords,
    ).toEqual(["Rust", "Go"]);
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
