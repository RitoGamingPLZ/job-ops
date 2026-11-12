import type { CoworkChatContext, ExperienceBullet } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultReactiveResumeDocument } from "./rxresume/document";

const { callJson, list, reserve, update } = vi.hoisted(() => ({
  callJson: vi.fn(),
  list: vi.fn(),
  reserve: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./hosted-usage", () => ({ withHostedUsageReservation: reserve }));
vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "mock-model"),
}));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: list,
  updateExperienceBullet: update,
}));

import {
  buildCoworkPrompt,
  COWORK_RESPONSE_SCHEMA,
  coworkChatContextSchema,
  extractExperienceBullets,
  filterCoworkSuggestions,
  labelExperienceBullets,
  rankExperienceBullets,
} from "./cowork-ai";

function context(): CoworkChatContext {
  const document =
    buildDefaultReactiveResumeDocument() as CoworkChatContext["document"];
  document.sections.experience.items = [
    {
      id: "exp",
      company: "Acme",
      position: "Dev",
      description: "<ul><li>Built APIs</li></ul>",
      hidden: false,
      location: "",
      period: "",
      website: { url: "", label: "" },
      roles: [],
    },
  ];
  return { document, referencedBulletIds: ["own"] };
}
function withSections(): CoworkChatContext {
  const cowork = context();
  const sections = cowork.document.sections;
  const website = { url: "", label: "" };
  sections.education.items = [
    {
      id: "ed",
      hidden: false,
      school: "MIT",
      degree: "BSc",
      area: "CS",
      grade: "",
      location: "",
      period: "2010",
      website,
      description: "",
    },
  ];
  sections.awards.items = [
    {
      id: "aw",
      hidden: false,
      title: "Prize",
      awarder: "IEEE",
      date: "2020",
      website,
      description: "<p>Won <b>it</b></p>",
    },
  ];
  sections.certifications.items = [
    {
      id: "ce",
      hidden: false,
      title: "AWS",
      issuer: "Amazon",
      date: "",
      website,
      description: "",
    },
  ];
  sections.projects.items = [
    {
      id: "pr",
      hidden: false,
      name: "Tool",
      period: "",
      website,
      description: "",
    },
    {
      id: "hiddenpr",
      hidden: true,
      name: "Secret",
      period: "",
      website,
      description: "",
    },
  ];
  return cowork;
}
const bullet = (id: string, text = "Built tools"): ExperienceBullet => ({
  id,
  kind: "bullet" as const,
  data: null,
  parentId: null,
  position: 0,
  text,
  tags: [],
  company: null,
  role: null,
  startDate: null,
  endDate: null,
  source: "manual",
  sourceExperienceId: null,
  createdAt: "",
  updatedAt: "",
});
beforeEach(() => {
  vi.clearAllMocks();
  reserve.mockImplementation(async (_args, work) => (await work()).result);
  list.mockResolvedValue([bullet("own")]);
});
describe("cowork AI", () => {
  it("extracts unsaved validated drafts, strips injected provenance", async () => {
    callJson.mockResolvedValue({
      success: true,
      data: {
        drafts: [
          { text: "Built APIs", source: "resume", sourceExperienceId: "fake" },
        ],
      },
    });
    expect(await extractExperienceBullets("Built APIs")).toEqual([
      { text: "Built APIs", source: "ai_extract" },
    ]);
    expect(callJson.mock.calls[0][0].jsonSchema.name).toBe(
      "experience_extract",
    );
    callJson.mockResolvedValue({
      success: true,
      data: { drafts: [{ text: "" }] },
    });
    expect(await extractExperienceBullets("input")).toEqual([]);
  });
  it("ranks only scoped IDs, removes duplicates and invalid scores", async () => {
    list.mockResolvedValue([bullet("own"), bullet("second")]);
    callJson.mockResolvedValue({
      success: true,
      data: {
        ranked: [
          { bulletId: "own", score: 30, reason: "ok" },
          { bulletId: "foreign", score: 100, reason: "bad" },
          { bulletId: "second", score: 90, reason: "best" },
          { bulletId: "own", score: 80, reason: "duplicate" },
          { bulletId: "second", score: 999, reason: "bad" },
        ],
      },
    });
    expect(
      (await rankExperienceBullets("tools")).map((b) => b.bulletId),
    ).toEqual(["second", "own"]);
  });
  it("does not call the LLM for an empty library", async () => {
    list.mockResolvedValue([]);
    expect(await rankExperienceBullets("job")).toEqual([]);
    expect(callJson).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("reserves tailoring usage for extract/rank and propagates quota rejection", async () => {
    callJson.mockResolvedValue({
      success: true,
      data: { drafts: [], ranked: [] },
    });
    await extractExperienceBullets("text");
    await rankExperienceBullets("job");
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenNthCalledWith(
      1,
      { action: "tailoring" },
      expect.any(Function),
    );
    expect(reserve).toHaveBeenNthCalledWith(
      2,
      { action: "tailoring" },
      expect.any(Function),
    );
    callJson.mockClear();
    reserve.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(extractExperienceBullets("text")).rejects.toThrow(
      "quota exceeded",
    );
    reserve.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(rankExperienceBullets("job")).rejects.toThrow(
      "quota exceeded",
    );
    expect(callJson).not.toHaveBeenCalled();
  });

  it("prefilters rank to the top 200 by keyword overlap and caps the JD", async () => {
    list.mockResolvedValue([
      ...Array.from({ length: 205 }, (_, i) => bullet(`b${i}`, "unrelated")),
      bullet("match", "Python"),
    ]);
    callJson.mockResolvedValue({
      success: true,
      data: {
        ranked: [{ bulletId: "b204", score: 100, reason: "not supplied" }],
      },
    });
    expect(await rankExperienceBullets(`Python ${"x".repeat(21000)}`)).toEqual(
      [],
    );
    const data = JSON.parse(callJson.mock.calls[0][0].messages[1].content);
    expect(data.jobDescription).toHaveLength(20000);
    expect(data.bullets).toHaveLength(200);
    expect(data.bullets[0].id).toBe("match");
    expect(data.bullets.some((item: any) => item.id === "b204")).toBe(false);
  });
  it("keeps valid extraction items, validates each cap and limits input drafts to 200", async () => {
    callJson.mockResolvedValue({
      success: true,
      data: {
        drafts: [
          { text: "Good" },
          { text: "x".repeat(10001) },
          { text: "Bad tag", tags: ["x".repeat(101)] },
          ...Array.from({ length: 197 }, () => ({ text: "Valid" })),
          { text: "Beyond cap" },
        ],
      },
    });
    const drafts = await extractExperienceBullets("text");
    expect(drafts).toHaveLength(198);
    expect(drafts[0].text).toBe("Good");
    expect(drafts.some((item) => item.text === "Beyond cap")).toBe(false);
    callJson.mockResolvedValue({ success: true, data: { drafts: "invalid" } });
    await expect(extractExperienceBullets("text")).rejects.toThrow(
      "Unable to extract",
    );
  });
  it("validates document shape, reference count and byte cap", () => {
    expect(coworkChatContextSchema.safeParse(context()).success).toBe(true);
    expect(
      coworkChatContextSchema.safeParse({
        document: {},
        referencedBulletIds: [],
      }).success,
    ).toBe(false);
    const huge = context();
    huge.document.basics.headline = "x".repeat(250001);
    expect(coworkChatContextSchema.safeParse(huge).success).toBe(false);
  });
  it("validates focus refs (strict, max 20)", () => {
    const ref = {
      kind: "item",
      section: "experience",
      itemId: "exp",
      label: "Acme",
    };
    expect(
      coworkChatContextSchema.safeParse({ ...context(), focus: [ref] }).success,
    ).toBe(true);
    for (const focus of [
      Array(21).fill(ref),
      [{ ...ref, kind: "page" }],
      [{ ...ref, label: "" }],
      [{ ...ref, extra: 1 }],
      [{ ...ref, bulletIndex: -1 }],
    ])
      expect(
        coworkChatContextSchema.safeParse({ ...context(), focus }).success,
      ).toBe(false);
  });

  it("strict schema includes nullable field object", () => {
    const item = COWORK_RESPONSE_SCHEMA.schema.properties as Record<
      string,
      any
    >;
    const props = item.suggestions.items;
    expect(props.required).toContain("field");
    expect(props.properties.op.enum).toContain("replace_field");
    expect(props.properties.field).toMatchObject({
      type: ["object", "null"],
      required: ["section", "itemId", "name"],
      additionalProperties: false,
    });
    expect(Object.keys(props.properties).sort()).toEqual(
      [...props.required].sort(),
    );
  });
});

describe("experience labeling", () => {
  it("filters to scoped IDs, merges existing tags, trims, dedupes and caps tags", async () => {
    const own = { ...bullet("own"), tags: [" TypeScript ", "React"] };
    list.mockResolvedValue([own]);
    update.mockImplementation(async (_id, input) => ({ ...own, ...input }));
    callJson.mockResolvedValue({
      success: true,
      data: {
        labels: [
          { bulletId: "foreign", tags: ["Secret"] },
          {
            bulletId: "own",
            tags: [
              "typescript",
              " React  ",
              "",
              ...Array.from({ length: 20 }, (_, i) => `Skill${i}`),
            ],
          },
          { bulletId: "own", tags: ["Duplicate"] },
        ],
      },
    });
    const result = await labelExperienceBullets(["own", "foreign"]);
    expect(result.labeled).toBe(1);
    expect(result.bullets[0].tags).toHaveLength(12);
    expect(result.bullets[0].tags.slice(0, 3)).toEqual([
      "TypeScript",
      "React",
      "Skill0",
    ]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe("own");
    expect(callJson.mock.calls[0][0].messages[1].content).not.toContain(
      "foreign",
    );
    const root = callJson.mock.calls[0][0].jsonSchema.schema;
    expect(root.required).toEqual(["labels"]);
    expect(root.additionalProperties).toBe(false);
    expect(root.properties.labels.items.required).toEqual(["bulletId", "tags"]);
    expect(root.properties.labels.items.additionalProperties).toBe(false);
  });
  it("defaults to untagged only and skips explicit empty/foreign IDs without usage", async () => {
    list.mockResolvedValue([{ ...bullet("tagged"), tags: ["Existing"] }]);
    expect(await labelExperienceBullets()).toEqual({
      bullets: [],
      labeled: 0,
      remaining: 0,
    });
    expect(await labelExperienceBullets([])).toEqual({
      bullets: [],
      labeled: 0,
      remaining: 0,
    });
    expect(await labelExperienceBullets(["foreign"])).toEqual({
      bullets: [],
      labeled: 0,
      remaining: 0,
    });
    expect(reserve).not.toHaveBeenCalled();
  });
  it("batches at 40 with bounded text and reserves each call", async () => {
    list.mockResolvedValue(
      Array.from({ length: 81 }, (_, i) => bullet(`b${i}`, "x".repeat(10000))),
    );
    callJson.mockResolvedValue({ success: true, data: { labels: [] } });
    await labelExperienceBullets();
    expect(reserve).toHaveBeenCalledTimes(3);
    expect(
      callJson.mock.calls.map(
        ([input]) => JSON.parse(input.messages[1].content).bullets.length,
      ),
    ).toEqual([40, 40, 1]);
    expect(callJson.mock.calls[0][0].messages[1].content.length).toBeLessThan(
      55000,
    );
  });
  it.each([
    false,
    true,
  ])("caps calls at five batches and reports remaining (explicit=%s)", async (explicit) => {
    const library = Array.from({ length: 205 }, (_, i) => bullet(`b${i}`));
    list.mockResolvedValue(library);
    update.mockImplementation(async (id, input) => {
      const current = library.find((item) => item.id === id);
      if (!current) throw new Error("Unexpected bullet ID");
      Object.assign(current, input);
      return current;
    });
    callJson.mockImplementation(async (input) => ({
      success: true,
      data: {
        labels: JSON.parse(input.messages[1].content).bullets.map(
          (item: { id: string }) => ({ bulletId: item.id, tags: ["APIs"] }),
        ),
      },
    }));
    const result = await labelExperienceBullets(
      explicit ? library.map((item) => item.id) : undefined,
    );
    expect(callJson).toHaveBeenCalledTimes(5);
    expect(reserve).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ labeled: 200, remaining: 5 });
    expect(result.bullets).toHaveLength(200);
  });
  it("sanitizes oversized model output without discarding valid labels", async () => {
    list.mockResolvedValue([bullet("own"), bullet("second")]);
    update.mockImplementation(async (id, input) => ({
      ...bullet(id),
      ...input,
    }));
    callJson.mockResolvedValue({
      success: true,
      data: {
        labels: [
          {
            bulletId: "own",
            tags: [
              "x".repeat(101),
              ...Array.from({ length: 110 }, (_, i) => `Skill${i}`),
            ],
          },
          { bulletId: "second", tags: ["Valid"] },
          ...Array.from({ length: 39 }, () => ({
            bulletId: "own",
            tags: ["Ignored"],
          })),
        ],
      },
    });
    const result = await labelExperienceBullets(["own", "second"]);
    expect(result).toMatchObject({ labeled: 2, remaining: 0 });
    expect(result.bullets[0].tags).toEqual(
      Array.from({ length: 12 }, (_, i) => `Skill${i}`),
    );
    expect(result.bullets[1].tags).toEqual(["Valid"]);
  });
  it("counts unlabeled omissions and empty tags as remaining", async () => {
    list.mockResolvedValue([bullet("own"), bullet("second")]);
    update.mockImplementation(async (id, input) => ({
      ...bullet(id),
      ...input,
    }));
    callJson.mockResolvedValue({
      success: true,
      data: { labels: [{ bulletId: "own", tags: [] }] },
    });
    expect(await labelExperienceBullets()).toMatchObject({
      labeled: 1,
      remaining: 2,
    });
    expect(await labelExperienceBullets(["own", "second"])).toMatchObject({
      labeled: 1,
      remaining: 1,
    });
  });
  it("rejects invalid upstream output and propagates quota failures", async () => {
    callJson.mockResolvedValue({
      success: false,
      error: "raw upstream secret",
    });
    await expect(labelExperienceBullets()).rejects.toThrow(
      "Unable to label experience bullets",
    );
    reserve.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(labelExperienceBullets()).rejects.toThrow("quota exceeded");
  });
});

describe("V2 cowork producer", () => {
  const proposal = (op: string, fields: Record<string, unknown> = {}) => ({
    op,
    reason: "Relevant",
    previousText: "stale",
    ...fields,
  });
  it("uses the shared strict provider schema", () => {
    expect(COWORK_RESPONSE_SCHEMA.schema.properties).toMatchObject({
      suggestions: {
        items: {
          properties: {
            itemJson: expect.any(Object),
            op: {
              enum: expect.arrayContaining([
                "include_library_item",
                "replace_intro",
                "set_skill_keywords",
              ]),
            },
          },
        },
      },
    });
  });
  it("whitelists all library kinds, removes contacts/URLs/emails/raw data and caps bytes", () => {
    const kinds = [
      "role",
      "bullet",
      "project",
      "project_point",
      "skill",
      "education",
      "award",
      "certification",
      "contact",
    ] as const;
    const library = kinds.map((kind) => ({
      ...bullet(kind),
      kind,
      parentId:
        kind === "bullet"
          ? "role"
          : kind === "project_point"
            ? "project"
            : null,
      text:
        kind === "contact"
          ? "CONTACT SECRET"
          : "<b>Fact</b> https://example.com user@example.com",
      data: {
        school: "School",
        area: "CS",
        grade: "A",
        description: "<p>Detail</p>",
        issuer: "Issuer",
        awarder: "Awarder",
        website: { url: "URL SECRET" },
        secret: "RAW SECRET",
      },
    }));
    const prompt = buildCoworkPrompt(withSections(), "Job", library);
    const data = JSON.parse(prompt.split("\n").slice(1).join("\n"));
    expect(
      data.library.map((item: ExperienceBullet) => item.kind).sort(),
    ).toEqual([...kinds.slice(0, -1)].sort());
    expect(
      data.library.find((item: ExperienceBullet) => item.kind === "education"),
    ).toMatchObject({
      school: "School",
      area: "CS",
      grade: "A",
      description: "Detail",
    });
    for (const secret of [
      "CONTACT SECRET",
      "URL SECRET",
      "RAW SECRET",
      "https://example.com",
      "user@example.com",
    ])
      expect(prompt).not.toContain(secret);
    const large = buildCoworkPrompt(
      context(),
      "Job",
      Array.from({ length: 100 }, (_, i) =>
        bullet(String(i), "x".repeat(10000)),
      ),
    );
    expect(
      Buffer.byteLength(large.split("\n").slice(1).join("\n")),
    ).toBeLessThanOrEqual(250000);
  });
  it("includes every editable item id, hidden/link state and project lines/intros", () => {
    const ctx = withSections();
    Object.assign(ctx.document.sections.projects.items[0], {
      libraryId: "project",
      bulletRefs: ["point"],
      description: "<p>Intro</p><ul><li>Point</li></ul>",
    });
    ctx.document.sections.certifications.hidden = true;
    const data = JSON.parse(
      buildCoworkPrompt(ctx, "Job", []).split("\n").slice(1).join("\n"),
    );
    expect(data.resume.projects[0]).toMatchObject({
      id: "pr",
      libraryId: "project",
      intro: "Intro",
      bullets: [{ index: 0, text: "Point", libraryId: "point" }],
    });
    expect(data.resume.projects[1]).toMatchObject({
      id: "hiddenpr",
      hidden: true,
    });
    expect(data.resume.certifications[0].id).toBe("ce");
  });
  it("emits linked replace_field locally and stamps all snapshot guards", () => {
    const ctx = withSections();
    Object.assign(ctx.document.sections.projects.items[0], {
      libraryId: "project",
      bulletRefs: ["point"],
      description: "<p>Intro</p><ul><li>Point</li></ul>",
    });
    const out = filterCoworkSuggestions(
      [
        proposal("replace_field", {
          field: { section: "projects", itemId: "pr", name: "name" },
          text: "Better",
        }),
        proposal("replace_bullet", {
          section: "projects",
          itemId: "pr",
          bulletIndex: 0,
          text: "Clear point",
          previousText: "Point",
        }),
        proposal("replace_intro", {
          section: "projects",
          itemId: "pr",
          text: "Clear intro",
        }),
        proposal("reorder_bullets", {
          section: "projects",
          itemId: "pr",
          order: [0],
          previousTexts: [],
        }),
        proposal("replace_summary", { text: "Summary" }),
      ],
      ctx,
      [],
    );
    expect(out).toMatchObject([
      { op: "replace_field", previousText: "Tool" },
      { op: "replace_bullet", previousText: "Point" },
      { op: "replace_intro", previousText: "Intro" },
      { op: "reorder_bullets", previousTexts: ["Point"] },
      { op: "replace_summary", previousText: "" },
    ]);
  });
  it("accepts valid V2 entry, library, skill and line operations", () => {
    const ctx = withSections();
    Object.assign(ctx.document.sections.experience.items[0], {
      libraryId: "role",
      bulletRefs: ["old-line"],
    });
    ctx.document.sections.skills.items = [
      {
        id: "skill-item",
        name: "Tools",
        icon: "",
        proficiency: "",
        keywords: ["TS"],
        level: 2,
        hidden: true,
        libraryId: "skill-library",
      },
    ];
    const library = [
      { ...bullet("role"), kind: "role" as const },
      { ...bullet("old-line"), parentId: "role" },
      { ...bullet("new-line"), parentId: "role" },
    ];
    const input = [
      proposal("include_library_item", { libraryId: "new-line" }),
      proposal("exclude_library_item", { libraryId: "old-line" }),
      proposal("create_library_item", {
        itemJson: JSON.stringify({
          kind: "bullet",
          parentId: "role",
          text: "User stated fact",
        }),
        includeOnResume: true,
      }),
      proposal("save_to_library", {
        target: {
          kind: "entry",
          section: "experience",
          itemId: "exp",
          libraryId: "role",
        },
      }),
      proposal("save_to_library", {
        target: {
          kind: "line",
          libraryId: "old-line",
          target: {
            section: "experience",
            itemId: "exp",
            bulletIndex: 0,
            previousText: "Built APIs",
          },
        },
      }),
      proposal("add_entry", {
        section: "projects",
        index: 1,
        itemJson: JSON.stringify({ name: "User stated fact" }),
      }),
      proposal("remove_entry", { section: "projects", itemId: "hiddenpr" }),
      proposal("reorder_entries", {
        section: "projects",
        itemIds: ["hiddenpr", "pr"],
      }),
      proposal("insert_bullet", {
        section: "experience",
        itemId: "exp",
        bulletIndex: 1,
        text: "Linked line",
        libraryId: "new-line",
      }),
      proposal("delete_bullet", {
        section: "experience",
        itemId: "exp",
        bulletIndex: 0,
        previousText: "Built APIs",
      }),
      proposal("set_skill_keywords", {
        itemId: "skill-item",
        previousKeywords: [],
        keywords: ["TS", "SQL"],
      }),
    ];
    const out = filterCoworkSuggestions(input, ctx, library);
    expect(out).toHaveLength(input.length);
    expect(out[4]).toMatchObject({
      target: { target: { previousText: "Built APIs" } },
    });
    expect(out[10]).toMatchObject({ previousKeywords: ["TS"] });
    expect(
      filterCoworkSuggestions(
        [
          proposal("insert_bullet", {
            section: "experience",
            itemId: "exp",
            bulletIndex: 1,
            text: "Duplicate",
            libraryId: "old-line",
          }),
        ],
        ctx,
        library,
      ),
    ).toEqual([]);
  });
  it("keeps prose out of bullet indexes and preserves focus context", () => {
    const ctx = context();
    ctx.document.sections.experience.items[0].description =
      "<p>Intro &amp; detail</p>";
    ctx.focus = [
      { kind: "item", section: "experience", itemId: "exp", label: "Role" },
    ];
    const data = JSON.parse(
      buildCoworkPrompt(ctx, "Job", []).split("\n").slice(1).join("\n"),
    );
    expect(data.resume.experience[0]).toMatchObject({
      intro: "Intro & detail",
      bullets: [],
    });
    expect(data.FOCUS[0].current).toEqual(data.resume.experience[0]);
    expect(
      filterCoworkSuggestions(
        [
          proposal("delete_bullet", {
            section: "experience",
            itemId: "exp",
            bulletIndex: 0,
          }),
        ],
        ctx,
        [],
      ),
    ).toEqual([]);
  });
  it("anchors replace/delete and line saves by previousText before the model index", () => {
    const ctx = context();
    Object.assign(ctx.document.sections.experience.items[0], {
      libraryId: "role",
      description: "<ul><li>First</li><li>Second point</li><li>Third</li></ul>",
      bulletRefs: ["first", "second", "third"],
    });
    const library = ["first", "second", "third"].map((id) => ({
      ...bullet(id),
      parentId: "role",
    }));
    const line = {
      section: "experience",
      itemId: "exp",
      bulletIndex: 0,
      previousText: " Second   point ",
    };
    for (const op of ["replace_bullet", "delete_bullet", "save_to_library"]) {
      const input =
        op === "save_to_library"
          ? proposal(op, {
              target: { kind: "line", libraryId: "second", target: line },
            })
          : proposal(op, { ...line, text: "Better" });
      const out = filterCoworkSuggestions([input], ctx, library);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject(
        op === "save_to_library"
          ? {
              target: {
                target: { bulletIndex: 1, previousText: "Second point" },
              },
            }
          : { bulletIndex: 1, previousText: "Second point" },
      );
      const stale =
        op === "save_to_library"
          ? proposal(op, {
              target: {
                kind: "line",
                libraryId: "first",
                target: { ...line, previousText: "missing" },
              },
            })
          : proposal(op, { ...line, previousText: "missing", text: "Better" });
      expect(filterCoworkSuggestions([stale], ctx, library)).toEqual([]);
      const fallback =
        op === "save_to_library"
          ? proposal(op, {
              target: {
                kind: "line",
                libraryId: "first",
                target: { ...line, previousText: "" },
              },
            })
          : proposal(op, { ...line, previousText: "", text: "Better" });
      expect(
        filterCoworkSuggestions([fallback], ctx, library)[0],
      ).toMatchObject(
        op === "save_to_library"
          ? { target: { target: { bulletIndex: 0, previousText: "First" } } }
          : { bulletIndex: 0, previousText: "First" },
      );
    }
  });
  it("checks include/exclude against linked entries and lines including hidden items", () => {
    const ctx = withSections();
    Object.assign(ctx.document.sections.experience.items[0], {
      libraryId: "role",
      bulletRefs: ["linked"],
    });
    Object.assign(ctx.document.sections.projects.items[1], {
      libraryId: "hidden-project",
    });
    const library: ExperienceBullet[] = [
      { ...bullet("role"), kind: "role" },
      { ...bullet("hidden-project"), kind: "project" },
      { ...bullet("absent-project"), kind: "project" },
      { ...bullet("linked"), parentId: "role" },
      { ...bullet("new"), parentId: "role" },
      { ...bullet("orphan"), parentId: "absent-role" },
      {
        ...bullet("hidden-point"),
        kind: "project_point",
        parentId: "hidden-project",
      },
    ];
    for (const op of ["include_library_item", "exclude_library_item"]) {
      const out = filterCoworkSuggestions(
        library.map((item) => proposal(op, { libraryId: item.id })),
        ctx,
        library,
      );
      expect(out.map((s) => ("libraryId" in s ? s.libraryId : null))).toEqual(
        op === "include_library_item"
          ? ["absent-project", "new", "hidden-point"]
          : ["role", "hidden-project", "linked"],
      );
    }
  });
  it("filters sourceBulletIds without applying libraryId attachment restrictions", () => {
    const ctx = context();
    const inputs = [
      proposal("insert_bullet", {
        section: "experience",
        itemId: "exp",
        bulletIndex: 1,
        text: "New",
        sourceBulletIds: ["own", "foreign"],
      }),
      proposal("insert_bullet", {
        section: "experience",
        itemId: "exp",
        bulletIndex: 1,
        text: "New",
        libraryId: "own",
      }),
    ];
    expect(filterCoworkSuggestions(inputs, ctx, [bullet("own")])).toMatchObject(
      [{ op: "insert_bullet", sourceBulletIds: ["own"] }],
    );
    Object.assign(ctx.document.sections.experience.items[0], {
      libraryId: "role",
      bulletRefs: ["own"],
    });
    expect(
      filterCoworkSuggestions(inputs, ctx, [
        { ...bullet("own"), parentId: "other-role" },
      ]),
    ).toMatchObject([{ op: "insert_bullet", sourceBulletIds: ["own"] }]);
  });
  it("budgets catalog at 50 KB in priority order and retains parents for lines", () => {
    const ctx = context();
    Object.assign(ctx.document.sections.experience.items[0], {
      libraryId: "role",
      bulletRefs: ["linked"],
    });
    ctx.referencedBulletIds = ["referenced"];
    const library: ExperienceBullet[] = [
      ...Array.from({ length: 40 }, (_, i) => ({
        ...bullet(`line-${i}`, "irrelevant ".repeat(200)),
        parentId: "role",
      })),
      { ...bullet("ranked", "Python ".repeat(300)), parentId: "role" },
      { ...bullet("parent", "Other role"), kind: "role" },
      { ...bullet("linked"), parentId: "role" },
      { ...bullet("referenced"), kind: "project_point", parentId: "project" },
      { ...bullet("role", "Role"), kind: "role" },
      { ...bullet("project", "Project"), kind: "project" },
      { ...bullet("orphan"), parentId: "missing" },
    ];
    const prompt = buildCoworkPrompt(ctx, "Python", library);
    const data = JSON.parse(prompt.split("\n").slice(1).join("\n"));
    const ids = data.library.map((item: ExperienceBullet) => item.id);
    expect(ids.slice(0, 7)).toEqual([
      "role",
      "linked",
      "project",
      "referenced",
      "parent",
      "ranked",
      "line-0",
    ]);
    expect(ids).not.toContain("orphan");
    expect(ids).not.toContain("line-39");
    expect(Buffer.byteLength(JSON.stringify(data.library))).toBeLessThanOrEqual(
      50_000,
    );
    expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(250_000);
    expect(
      data.library.find((item: ExperienceBullet) => item.id === "role"),
    ).toEqual({ id: "role", kind: "role", text: "Role" });
    for (const item of data.library)
      if (item.kind === "bullet" || item.kind === "project_point")
        expect(ids).toContain(item.parentId);
  });
  it("trims the catalog first without throwing on oversized fixed context", () => {
    const ctx = context();
    ctx.document.summary.content = "x".repeat(245_000);
    const prompt = buildCoworkPrompt(ctx, "Job", [
      { ...bullet("role", "y".repeat(10_000)), kind: "role" },
    ]);
    const data = JSON.parse(prompt.split("\n").slice(1).join("\n"));
    expect(data.library).toEqual([]);
    expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(250_000);
    ctx.document.summary.content = "x".repeat(260_000);
    const oversized = buildCoworkPrompt(ctx, "Job", [
      { ...bullet("role"), kind: "role" },
    ]);
    const largeData = JSON.parse(oversized.split("\n").slice(1).join("\n"));
    expect(largeData.library).toEqual([]);
    expect(largeData.resume.summary).toHaveLength(260_000);
  });
  it("drops markup-only intro replacements but permits an explicit empty clear", () => {
    const out = filterCoworkSuggestions(
      ["<p></p>", "", "Clear intro"].map((text) =>
        proposal("replace_intro", {
          section: "experience",
          itemId: "exp",
          text,
        }),
      ),
      context(),
      [],
    );
    expect(out).toMatchObject([{ text: "" }, { text: "Clear intro" }]);
  });
  it("drops missing/foreign targets for every structural and library operation", () => {
    const ctx = withSections();
    const invalid = [
      proposal("include_library_item", { libraryId: "foreign" }),
      proposal("exclude_library_item", { libraryId: "foreign" }),
      proposal("create_library_item", {
        itemJson: JSON.stringify({
          kind: "bullet",
          text: "Fact",
          parentId: "foreign",
        }),
        includeOnResume: true,
      }),
      proposal("save_to_library", {
        target: {
          kind: "entry",
          section: "projects",
          itemId: "pr",
          libraryId: "foreign",
        },
      }),
      proposal("add_entry", {
        section: "projects",
        index: 99,
        itemJson: JSON.stringify({ name: "Fact" }),
      }),
      proposal("remove_entry", { section: "projects", itemId: "foreign" }),
      proposal("reorder_entries", { section: "projects", itemIds: ["pr"] }),
      proposal("replace_bullet", {
        section: "projects",
        itemId: "pr",
        bulletIndex: 0,
        text: "x",
      }),
      proposal("delete_bullet", {
        section: "experience",
        itemId: "foreign",
        bulletIndex: 0,
      }),
      proposal("insert_bullet", {
        section: "projects",
        itemId: "pr",
        bulletIndex: 0,
        text: "x",
        libraryId: "foreign",
      }),
      proposal("reorder_bullets", {
        section: "experience",
        itemId: "exp",
        order: [1],
        previousTexts: [],
      }),
      proposal("replace_intro", {
        section: "projects",
        itemId: "foreign",
        text: "x",
      }),
      proposal("replace_field", {
        field: { section: "projects", itemId: "pr", name: "website" },
        text: "x",
      }),
      proposal("set_skill_keywords", {
        itemId: "foreign",
        previousKeywords: [],
        keywords: ["x"],
      }),
    ];
    expect(filterCoworkSuggestions(invalid, ctx, [])).toEqual([]);
  });
});
