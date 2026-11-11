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
  it("tints reworded linked duties with the shared class and resume wording title", async () => {
    mocks.lines.mockReturnValue([{ ref: "duty", text: "Reworded tools" }]);
    await mount({ jobId: "job", document: doc });
    const row = screen.getByRole("button", {
      name: "Built tools",
    }).parentElement;
    for (const className of REWORDED_TINT_CLASS.split(" "))
      expect(row).toHaveClass(className);
    expect(row).toHaveAttribute("title", "Reworded tools");
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
    expect(mocks.subtract).toHaveBeenCalledWith(doc, "skill");
    expect(next).toBe(doc);
    expect(doc.sections.skills.items[0].keywords).toEqual(["Rust"]);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("creates a keyword in the library and selects it on the open resume", async () => {
    const change = vi.fn();
    await mount({ jobId: "job", document: doc, onDocumentChange: change });
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
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
  it("places new forms under their add button and requires a job company", async () => {
    await mount();
    const add = screen.getByRole("button", { name: "+ Add duty" });
    fireEvent.click(add);
    expect(add.nextElementSibling).toBe(
      screen.getByRole("form", { name: "Edit library item" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add job" }));
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
  it("does not offer experience drag sources for project points", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(
      screen.queryByRole("button", { name: "Drag duty: Parsed code" }),
    ).toBeNull();
  });
  it("keeps rank scores after a tag edit", async () => {
    mocks.rank.mockResolvedValue({
      ranked: [{ bulletId: "duty", score: 88, reason: "Relevant" }],
    });
    await mount({ jobId: "job", document: doc });
    fireEvent.click(screen.getByRole("button", { name: "Rank for this job" }));
    await screen.findByText("88/100");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Tools from Built tools" }),
    );
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
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
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Search or create Languages keywords",
      }),
      { target: { value: "Go" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create 'Go'" }));
    await screen.findByRole("button", { name: "Delete keyword Go" });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete keyword Rust" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Delete keyword Rust" }),
      ).toBeNull(),
    );
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Untick Rust" }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
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
    fireEvent.click(screen.getByRole("button", { name: "Delete Engineer" }));
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
