import type { ExperienceBullet, ResumeV5Document, ResumeSuggestionV2 } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { executeAcceptedSuggestions } from "./acceptSuggestions";

const row = (id: string, kind: ExperienceBullet["kind"], extra: Partial<ExperienceBullet> = {}) =>
  ({
    id,
    kind,
    text: id,
    parentId: null,
    data: {},
    ...extra,
  }) as ExperienceBullet;
const fixture = () =>
  ({
    basics: { headline: "Engineer" },
    summary: { content: "Summary" },
    customSections: [],
    sections: {
      experience: {
        items: [
          {
            id: "role-entry",
            hidden: false,
            libraryId: "role",
            position: "Engineer",
            company: "Acme",
            description: "<ul><li>Job wording</li></ul>",
            bulletRefs: ["line"],
          },
        ],
      },
      projects: { items: [] },
      skills: { items: [] },
      education: { items: [] },
      awards: { items: [] },
      certifications: { items: [] },
    },
  }) as unknown as ResumeV5Document;
const state = () => ({
  jobId: "job",
  baseRevision: 7,
  document: fixture(),
  library: [row("role", "role"), row("line", "bullet", { parentId: "role", text: "Canonical" })],
});
const create: ResumeSuggestionV2 = {
  id: "create",
  reason: "New fact",
  op: "create_library_item",
  item: { kind: "skill", text: "Input skill", data: { keywords: ["TS"] } },
  includeOnResume: true,
};
const save: ResumeSuggestionV2 = {
  id: "save",
  reason: "Explicit write",
  op: "save_to_library",
  target: {
    kind: "line",
    libraryId: "line",
    target: {
      section: "experience",
      itemId: "role-entry",
      bulletIndex: 0,
      previousText: "Job wording",
    },
  },
};
const headline: ResumeSuggestionV2 = {
  id: "headline",
  reason: "Specific",
  op: "replace_headline",
  previousText: "Engineer",
  text: "Senior Engineer",
};

describe("accept suggestions executor", () => {
  it("serializes creates, applies document ops, then saves using dedupe's returned row", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const existing = row("existing", "skill", {
      text: "Canonical skill",
      data: { keywords: ["JS"] },
    });
    const api = {
      createItem: vi.fn(async () => {
        events.push("create");
        await gate;
        return { bullet: existing };
      }),
      updateItem: vi.fn(async () => {
        events.push("save");
        return {
          bullet: row("line", "bullet", {
            parentId: "role",
            text: "Job wording",
          }),
        };
      }),
    };
    const original = state();
    const pending = executeAcceptedSuggestions(original, [headline, save, create], api);
    expect(events).toEqual(["create"]);
    expect(original.document.basics.headline).toBe("Engineer");
    release();
    const result = await pending;
    expect(events).toEqual(["create", "save"]);
    expect(api.createItem).toHaveBeenCalledWith({
      ...create.item,
      source: "job_resume",
    });
    expect(api.updateItem).toHaveBeenCalledWith("line", { text: "Job wording" }, "job");
    expect(result.document.basics.headline).toBe("Senior Engineer");
    expect(result.document.sections.skills.items[0]).toMatchObject({
      libraryId: "existing",
      name: "Canonical skill",
      keywords: ["JS"],
    });
    expect(result.applied).toEqual(expect.arrayContaining(["create", "save", "headline"]));
    expect(result.rejected).toEqual([]);
  });
  it("keeps failed library operations unapplied while independent edits succeed", async () => {
    const api = {
      createItem: vi.fn().mockRejectedValue(new Error("offline")),
      updateItem: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const result = await executeAcceptedSuggestions(state(), [create, save, headline], api);
    expect(result.applied).toEqual(["headline"]);
    expect(result.rejected).toEqual([
      { id: "create", code: "FAILED" },
      { id: "save", code: "FAILED" },
    ]);
    expect(result.document.sections.skills.items).toEqual([]);
    expect(result.library).toEqual(state().library);
  });
  it("does not PATCH stale lines or mismatched library links", async () => {
    const api = { createItem: vi.fn(), updateItem: vi.fn() };
    const original = state();
    original.document.sections.experience.items[0].description = "<ul><li>Changed</li></ul>";
    expect((await executeAcceptedSuggestions(original, [save], api)).rejected).toEqual([
      { id: "save", code: "STALE" },
    ]);
    original.document.sections.experience.items[0].bulletRefs = ["other"];
    expect((await executeAcceptedSuggestions(original, [save], api)).rejected).toEqual([
      { id: "save", code: "INVALID_TARGET" },
    ]);
    expect(api.updateItem).not.toHaveBeenCalled();
  });
  it("saves current structured entry fields, never model supplied patches", async () => {
    const original = state();
    original.library.push(row("education", "education"));
    original.document.sections.education.items.push({
      id: "edu",
      hidden: false,
      libraryId: "education",
      degree: "MSc",
      school: "School",
      location: "City",
      period: "2020",
      area: "CS",
      grade: "A",
      description: "<p>Research</p>",
      website: { url: "https://school.test", label: "School" },
    });
    const api = {
      createItem: vi.fn(),
      updateItem: vi.fn().mockResolvedValue({
        bullet: row("education", "education", { text: "MSc" }),
      }),
    };
    const suggestion: ResumeSuggestionV2 = {
      id: "edu-save",
      reason: "Explicit",
      op: "save_to_library",
      target: {
        kind: "entry",
        section: "education",
        itemId: "edu",
        libraryId: "education",
      },
    };
    const result = await executeAcceptedSuggestions(original, [suggestion], api);
    expect(api.updateItem).toHaveBeenCalledWith(
      "education",
      {
        text: "MSc",
        data: {
          schemaVersion: 2,
          school: "School",
          location: "City",
          period: "2020",
          area: "CS",
          grade: "A",
          description: "<p>Research</p>",
          website: { url: "https://school.test", label: "School" },
        },
      },
      "job",
    );
    expect(result.applied).toEqual(["edu-save"]);
  });
  it("returns stale document ops without applying them", async () => {
    const result = await executeAcceptedSuggestions(
      state(),
      [{ ...headline, previousText: "Old" }],
      { createItem: vi.fn(), updateItem: vi.fn() },
    );
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([{ id: "headline", code: "STALE" }]);
  });
});

it("saves a same-batch rewrite from the post-apply document", async () => {
  const original = state();
  const api = {
    createItem: vi.fn(),
    updateItem: vi.fn().mockResolvedValue({
      bullet: row("line", "bullet", {
        parentId: "role",
        text: "New wording",
      }),
    }),
  };
  const rewrite: ResumeSuggestionV2 = {
    id: "rewrite",
    reason: "Review",
    op: "replace_bullet",
    section: "experience",
    itemId: "role-entry",
    bulletIndex: 0,
    previousText: "Job wording",
    text: "New wording",
  };
  const result = await executeAcceptedSuggestions(original, [save, rewrite], api);
  expect(api.updateItem).toHaveBeenCalledWith("line", { text: "New wording" }, "job");
  expect(result.applied).toEqual(["rewrite", "save"]);
  expect(result.rejected).toEqual([]);
  expect(result.document.sections.experience.items[0].description).toContain("New wording");
});

it("reports successful create with failed placement as INVALID_TARGET and keeps the returned row", async () => {
  const created = row("created-line", "bullet", { parentId: "missing" });
  const api = {
    createItem: vi.fn().mockResolvedValue({ bullet: created }),
    updateItem: vi.fn(),
  };
  const result = await executeAcceptedSuggestions(state(), [create], api);
  expect(result.applied).toEqual([]);
  expect(result.rejected).toEqual([{ id: "create", code: "INVALID_TARGET" }]);
  expect(result.library).toContainEqual(created);
});

it("reports stale guarded text separately from invalid targets and permutations", async () => {
  const api = { createItem: vi.fn(), updateItem: vi.fn() };
  const result = await executeAcceptedSuggestions(
    state(),
    [
      {
        id: "exclude",
        reason: "Review",
        op: "exclude_library_item",
        libraryId: "line",
      },
      {
        id: "stale-line",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "role-entry",
        bulletIndex: 0,
        previousText: "Old wording",
        text: "New",
      },
      {
        id: "missing",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "missing",
        bulletIndex: 0,
        previousText: "Old",
        text: "New",
      },
      {
        id: "bad-order",
        reason: "Review",
        op: "reorder_bullets",
        section: "experience",
        itemId: "role-entry",
        previousTexts: [],
        order: [0],
      },
    ],
    api,
  );
  expect(result.rejected).toEqual(
    expect.arrayContaining([
      { id: "stale-line", code: "STALE" },
      { id: "missing", code: "INVALID_TARGET" },
      { id: "bad-order", code: "INVALID_TARGET" },
    ]),
  );
});

it("does not save a derived company placeholder as library data", async () => {
  const original = state();
  original.document.sections.experience.items[0].company = "—";
  original.library[0].data = { company: "" };
  const api = {
    createItem: vi.fn(),
    updateItem: vi.fn().mockResolvedValue({ bullet: original.library[0] }),
  };
  await executeAcceptedSuggestions(
    original,
    [
      {
        id: "role-save",
        reason: "Review",
        op: "save_to_library",
        target: {
          kind: "entry",
          section: "experience",
          itemId: "role-entry",
          libraryId: "role",
        },
      },
    ],
    api,
  );
  expect(api.updateItem).toHaveBeenCalledWith(
    "role",
    expect.objectContaining({ data: expect.objectContaining({ company: "" }) }),
    "job",
  );
});
