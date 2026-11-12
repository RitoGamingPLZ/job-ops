import { getItemLines, setItemLines } from "@shared/resume-links";
import type {
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
  ResumeSuggestionV2,
} from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import {
  addFocus,
  applySuggestion,
  applySuggestions,
  dropBullet,
  MAX_FOCUS,
  readBulletTransfer,
  readFocusTransfer,
  suggestionTarget,
} from "./editor";

// These helpers only inspect the sections exercised by each operation.
const fixture = () =>
  ({
    basics: { headline: "Engineer" },
    summary: { content: "Summary" },
    customSections: [],
    sections: {
      experience: {
        items: [
          {
            id: "one",
            hidden: false,
            description: "<ul><li>First</li><li>Second</li></ul>",
          },
          {
            id: "two",
            hidden: false,
            description: "<p><strong>Keep formatting</strong></p>",
          },
        ],
      },
      skills: { items: [] },
    },
  }) as unknown as ReactiveResumeV5Document;
const suggestion = (
  overrides: Partial<ResumeSuggestion> = {},
): ResumeSuggestionV2 => {
  const s = {
    id: "s",
    op: "replace_bullet",
    experienceId: "one",
    bulletIndex: 0,
    previousText: "Second",
    text: "Improved",
    reason: "More specific",
    ...overrides,
  };
  return {
    ...s,
    section: "experience",
    itemId: s.experienceId,
    previousText:
      s.previousText ??
      (s.op === "replace_field"
        ? ""
        : s.op === "replace_summary"
          ? "Summary"
          : s.bulletIndex === 2
            ? "C"
            : "First"),
  } as unknown as ResumeSuggestionV2;
};

describe("resume suggestion application", () => {
  it("matches previous text ahead of an obsolete index and preserves other HTML", () => {
    const original = fixture();
    const result = applySuggestion(original, suggestion());
    expect(result?.sections.experience.items[0].description).toBe(
      "<ul><li>First</li><li>Improved</li></ul>",
    );
    expect(result?.sections.experience.items[1].description).toBe(
      original.sections.experience.items[1].description,
    );
    expect(original.sections.experience.items[0].description).toContain(
      "Second",
    );
  });
  it("falls back to the index when previous text is absent", () => {
    expect(
      applySuggestion(
        fixture(),
        suggestion({ previousText: undefined, bulletIndex: 0 }),
      )?.sections.experience.items[0].description,
    ).toContain("<li>Improved</li><li>Second</li>");
  });
  it("rejects stale, missing and hidden targets", () => {
    expect(
      applySuggestion(fixture(), suggestion({ previousText: "Changed" })),
    ).toBeNull();
    expect(
      applySuggestion(fixture(), suggestion({ experienceId: "missing" })),
    ).toBeNull();
    const doc = fixture();
    doc.sections.experience.items[0].hidden = true;
    expect(suggestionTarget(doc, suggestion())).toBeNull();
  });
  it("inserts at the end and deletes the matched bullet", () => {
    expect(
      applySuggestion(
        fixture(),
        suggestion({ op: "insert_bullet", bulletIndex: 2 }),
      )?.sections.experience.items[0].description,
    ).toContain("<li>Second</li><li>Improved</li>");
    expect(
      applySuggestion(fixture(), suggestion({ op: "delete_bullet" }))?.sections
        .experience.items[0].description,
    ).toBe("<ul><li>First</li></ul>");
    expect(
      applySuggestion(
        fixture(),
        suggestion({ op: "insert_bullet", bulletIndex: 99 }),
      ),
    ).toBeNull();
  });
  it("resolves [A,B,C] insert@0 and delete@2 against the original document", () => {
    const document = fixture();
    document.sections.experience.items[0].description =
      "<ul><li>A</li><li>B</li><li>C</li></ul>";
    const insert = suggestion({
      id: "insert",
      op: "insert_bullet",
      bulletIndex: 0,
      previousText: undefined,
      text: "X",
    });
    const remove = suggestion({
      id: "delete",
      op: "delete_bullet",
      bulletIndex: 2,
      previousText: undefined,
    });
    for (const items of [
      [insert, remove],
      [remove, insert],
    ]) {
      const result = applySuggestions(document, items);
      expect(result.document.sections.experience.items[0].description).toBe(
        "<ul><li>X</li><li>A</li><li>B</li></ul>",
      );
      expect(result.applied).toHaveLength(2);
    }
  });
  it("keeps multiple insertions at their original positions and preserves equal-index order", () => {
    const result = applySuggestions(fixture(), [
      suggestion({ id: "a", op: "insert_bullet", bulletIndex: 0, text: "A" }),
      suggestion({ id: "b", op: "insert_bullet", bulletIndex: 1, text: "B" }),
      suggestion({ id: "c", op: "insert_bullet", bulletIndex: 0, text: "C" }),
    ]);
    expect(result.document.sections.experience.items[0].description).toBe(
      "<ul><li>A</li><li>C</li><li>First</li><li>B</li><li>Second</li></ul>",
    );
  });
  it("compares and displays formatted summaries as plain text without index fallback", () => {
    const document = fixture();
    document.summary.content = "<p>Built <strong>tools</strong> &amp; APIs</p>";
    expect(
      suggestionTarget(
        document,
        suggestion({
          op: "replace_summary",
          previousText: "Built tools & APIs",
        }),
      ),
    ).toEqual({ old: "Built tools & APIs" });
    expect(
      suggestionTarget(
        document,
        suggestion({ op: "replace_summary", previousText: "Old summary" }),
      ),
    ).toBeNull();
  });
  it("escapes inserted text and plain summary suggestions", () => {
    expect(
      applySuggestion(fixture(), suggestion({ text: "<script>&" }))?.sections
        .experience.items[0].description,
    ).toContain("&lt;script&gt;&amp;");
    expect(
      applySuggestion(
        fixture(),
        suggestion({
          op: "replace_summary",
          previousText: undefined,
          text: "<script>",
        }),
      )?.summary.content,
    ).toBe("&lt;script&gt;");
  });
  it("applies headline replacements without losing other sections", () => {
    expect(
      applySuggestion(
        fixture(),
        suggestion({
          op: "replace_headline",
          previousText: "Engineer",
          text: "Senior Engineer",
        }),
      )?.basics.headline,
    ).toBe("Senior Engineer");
    expect(
      applySuggestion(
        fixture(),
        suggestion({ op: "replace_headline", previousText: "Old" }),
      ),
    ).toBeNull();
  });
});
describe("library bullet drops", () => {
  it("inserts between bullets and replaces only the target", () => {
    const original = ["A", "B"];
    expect(dropBullet(original, 1, "C", "insert")).toEqual(["A", "C", "B"]);
    expect(dropBullet(original, 0, "C", "replace")).toEqual(["C", "B"]);
    expect(dropBullet(original, 2, "C", "insert")).toEqual(["A", "B", "C"]);
    expect(original).toEqual(["A", "B"]);
  });
  it("ignores invalid positions and malformed external data", () => {
    expect(dropBullet(["A"], -1, "C", "insert")).toEqual(["A"]);
    expect(dropBullet(["A"], 1, "C", "replace")).toEqual(["A"]);
    expect(readBulletTransfer("broken")).toBeNull();
    expect(readBulletTransfer("null")).toBeNull();
    expect(readBulletTransfer('{"id":"one","text":4}')).toBeNull();
    expect(readBulletTransfer('{"id":"one","text":"Duty"}')).toEqual({
      id: "one",
      text: "Duty",
    });
  });
});

describe("description-aware suggestions", () => {
  const intro =
    '<p class="kept">First <a href="https://example.com">link</a></p>\n<p><b>Second</b> paragraph.</p>';
  it.each([
    "replace_bullet",
    "insert_bullet",
    "delete_bullet",
  ] as const)("preserves original intro for %s", (op) => {
    const original = fixture();
    original.sections.experience.items[0].description = `${intro}<ul><li>First</li><li>Second</li></ul>`;
    const result = applySuggestion(original, suggestion({ op }));
    expect(
      result?.sections.experience.items[0].description.startsWith(intro),
    ).toBe(true);
  });
  it("treats prose-only descriptions as zero bullets in targeting and batch apply", () => {
    const original = fixture();
    original.sections.experience.items[0].description = intro;
    expect(
      suggestionTarget(original, suggestion({ previousText: undefined })),
    ).toBeNull();
    expect(
      suggestionTarget(
        original,
        suggestion({ op: "delete_bullet", previousText: "First" }),
      ),
    ).toBeNull();
    expect(
      suggestionTarget(
        original,
        suggestion({ op: "insert_bullet", bulletIndex: 1 }),
      ),
    ).toBeNull();
    const result = applySuggestions(original, [
      suggestion({
        op: "insert_bullet",
        bulletIndex: 0,
        previousText: undefined,
      }),
    ]);
    expect(result.document.sections.experience.items[0].description).toBe(
      `${intro}<ul><li>Improved</li></ul>`,
    );
  });
});

describe("replace_field", () => {
  const doc = () =>
    ({
      ...fixture(),
      sections: {
        ...fixture().sections,
        education: {
          hidden: false,
          items: [{ id: "edu", hidden: false, school: "MIT", degree: "BSc" }],
        },
        awards: {
          hidden: false,
          items: [
            {
              id: "aw",
              hidden: false,
              title: "Prize",
              description: "<p>Old</p>",
            },
          ],
        },
      },
    }) as unknown as ReactiveResumeV5Document;
  const field = (overrides: Partial<ResumeSuggestion> = {}) =>
    suggestion({
      op: "replace_field",
      experienceId: undefined,
      bulletIndex: undefined,
      field: { section: "education", itemId: "edu", name: "school" },
      previousText: "MIT",
      text: "Harvard",
      ...overrides,
    });

  it("replaces a plain field", () => {
    expect(suggestionTarget(doc(), field())).toEqual({ old: "MIT" });
    const next = applySuggestion(doc(), field());
    expect(
      (next?.sections.education.items[0] as unknown as { school: string })
        .school,
    ).toBe("Harvard");
  });

  it("writes HTML fields as escaped paragraphs", () => {
    const s = field({
      field: { section: "awards", itemId: "aw", name: "description" },
      previousText: "Old",
      text: "A <b> & c",
    });
    expect(suggestionTarget(doc(), s)).toEqual({ old: "Old" });
    expect(
      applySuggestion(doc(), s)?.sections.awards.items[0].description,
    ).toBe("<p>A &lt;b&gt; &amp; c</p>");
  });

  it("compares HTML fields as decoded plain text and skips lists", () => {
    const d = doc();
    d.sections.awards.items[0].description = "<p>R&amp;D   <b>lead</b></p>";
    const s = field({
      field: { section: "awards", itemId: "aw", name: "description" },
      previousText: "R&D lead",
      text: "New",
    });
    expect(suggestionTarget(d, s)).toEqual({ old: "R&D lead" });
    d.sections.awards.items[0].description = "<ul><li>R&amp;D lead</li></ul>";
    expect(suggestionTarget(d, s)).toBeNull();
  });

  it("is stale when previousText differs", () => {
    expect(suggestionTarget(doc(), field({ previousText: "Yale" }))).toBeNull();
    expect(applySuggestion(doc(), field({ previousText: "Yale" }))).toBeNull();
  });

  it("rejects unknown sections, items and field names", () => {
    for (const f of [
      { section: "nope", itemId: "edu", name: "school" },
      { section: "education", itemId: "missing", name: "school" },
      { section: "education", itemId: "edu", name: "id" },
    ])
      expect(suggestionTarget(doc(), field({ field: f }))).toBeNull();
  });

  it("applies alongside bullet edits", () => {
    const result = applySuggestions(doc(), [
      field(),
      suggestion({ id: "b", text: "New first" }),
    ]);
    expect(result.applied).toEqual(expect.arrayContaining(["s", "b"]));
  });
});

describe("focus refs", () => {
  const ref = (itemId: string) => ({
    kind: "item" as const,
    itemId,
    label: itemId,
  });
  it("dedupes and caps at MAX_FOCUS", () => {
    expect(addFocus([ref("a")], ref("a"))).toHaveLength(1);
    let list: ResumeFocusRef[] = [ref("a")];
    for (let i = 0; i < 30; i++) list = addFocus(list, ref(String(i)));
    expect(list).toHaveLength(MAX_FOCUS);
  });
  it("reads transfers and ignores junk", () => {
    expect(readFocusTransfer(JSON.stringify(ref("a")))).toEqual(ref("a"));
    expect(readFocusTransfer("{")).toBeNull();
    expect(readFocusTransfer('{"kind":"item"}')).toBeNull();
  });
});

// Use the merged shared helpers; spies also cover omitted optional refs.
vi.mock("@shared/resume-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/resume-links")>();
  return {
    ...actual,
    getItemLines: vi.fn(actual.getItemLines),
    setItemLines: vi.fn(actual.setItemLines),
  };
});

describe("linked suggestion lines", () => {
  it("keeps a replaced line's ref and aligns refs after insert/delete", () => {
    const original = fixture();
    original.sections.experience.items[0].bulletRefs = ["first", "second"];
    const replaced = applySuggestion(original, suggestion());
    if (!replaced) throw new Error("Expected replacement to apply");
    expect(replaced.sections.experience.items[0].bulletRefs).toEqual([
      "first",
      "second",
    ]);
    const inserted = applySuggestion(
      replaced,
      suggestion({
        op: "insert_bullet",
        previousText: undefined,
        bulletIndex: 0,
        text: "New",
      }),
    );
    if (!inserted) throw new Error("Expected insertion to apply");
    expect(inserted.sections.experience.items[0].bulletRefs).toEqual([
      null,
      "first",
      "second",
    ]);
    const deleted = applySuggestion(
      inserted,
      suggestion({ op: "delete_bullet", previousText: "First" }),
    );
    if (!deleted) throw new Error("Expected deletion to apply");
    expect(deleted.sections.experience.items[0].bulletRefs).toEqual([
      null,
      "second",
    ]);
    expect(original.sections.experience.items[0].bulletRefs).toEqual([
      "first",
      "second",
    ]);
  });
  it("rejects blank rewording and permits local field edits on linked entries", () => {
    const original = fixture();
    original.sections.experience.items[0].libraryId = "role";
    original.sections.experience.items[0].bulletRefs = ["first", "second"];
    expect(applySuggestion(original, suggestion({ text: " " }))).toBeNull();
    const result = applySuggestion(
      original,
      suggestion({
        op: "replace_field",
        field: { section: "experience", itemId: "one", name: "company" },
        previousText: "",
      }),
    );
    expect(result?.sections.experience.items[0]).toMatchObject({
      company: "Improved",
      libraryId: "role",
    });
  });
});

it("replaces items when setItemLines omits refs", () => {
  const original = fixture();
  original.sections.experience.items[0].bulletRefs = ["first", null];
  vi.mocked(setItemLines).mockImplementationOnce((item) => {
    const { bulletRefs: _refs, ...rest } = item;
    return { ...rest, description: "<ul><li>Second</li></ul>" };
  });
  const next = applySuggestion(
    original,
    suggestion({ op: "delete_bullet", previousText: "First" }),
  );
  expect(next?.sections.experience.items[0]).not.toHaveProperty("bulletRefs");
});

describe("V2 document operations", () => {
  const doc = () => {
    const document = fixture();
    document.customSections = [];
    document.sections.projects = {
      items: [
        {
          id: "project",
          hidden: false,
          libraryId: "p",
          description: '<p>Intro</p><ul class="keep"><li>A</li><li>B</li></ul>',
          bulletRefs: ["a", "b"],
        },
      ],
    } as typeof document.sections.projects;
    document.sections.skills.items = [
      {
        id: "skill",
        libraryId: "sk",
        hidden: true,
        icon: "code",
        proficiency: "Expert",
        level: 4,
        name: "Languages",
        keywords: ["TS"],
        options: { showLinkInTitle: true },
      },
    ];
    return document;
  };

  it("changes only skill keywords, including a hidden linked group", () => {
    const original = doc();
    const result = applySuggestion(original, {
      id: "skill-edit",
      reason: "Review",
      op: "set_skill_keywords",
      itemId: "skill",
      previousKeywords: ["TS"],
      keywords: ["JS"],
    });
    expect(result?.sections.skills.items[0]).toEqual({
      ...original.sections.skills.items[0],
      keywords: ["JS"],
    });
    expect(original.sections.skills.items[0].keywords).toEqual(["TS"]);
  });
  it("reorders project lines and refs, rejecting incomplete, duplicate and foreign permutations", () => {
    const s: ResumeSuggestionV2 = {
      id: "reorder",
      reason: "Review",
      op: "reorder_bullets",
      section: "projects",
      itemId: "project",
      previousTexts: ["A", "B"],
      order: [1, 0],
    };
    expect(
      applySuggestion(doc(), s)?.sections.projects.items[0].bulletRefs,
    ).toEqual(["b", "a"]);
    for (const order of [[0], [0, 0], [1, 2], [0, 1, 2]])
      expect(applySuggestion(doc(), { ...s, order })).toBeNull();
  });
  it("replaces project intros without changing list markup or refs", () => {
    const result = applySuggestion(doc(), {
      id: "intro",
      reason: "Review",
      op: "replace_intro",
      section: "projects",
      itemId: "project",
      previousText: "Intro",
      text: "New & intro",
    });
    expect(result?.sections.projects.items[0].description).toBe(
      '<p>New &amp; intro</p><ul class="keep"><li>A</li><li>B</li></ul>',
    );
    expect(result?.sections.projects.items[0].bulletRefs).toEqual(["a", "b"]);
  });
  it("inserts a rewritten linked project line only for the correct parent and without duplicates", () => {
    const library = [
      { id: "new", kind: "project_point", parentId: "p", text: "Canonical" },
    ] as import("@shared/types").ExperienceBullet[];
    const s: ResumeSuggestionV2 = {
      id: "insert",
      reason: "Review",
      op: "insert_bullet",
      section: "projects",
      itemId: "project",
      bulletIndex: 1,
      text: "Rewrite",
      libraryId: "new",
    };
    const result = applySuggestion(doc(), s, library);
    expect(result?.sections.projects.items[0].bulletRefs).toEqual([
      "a",
      "new",
      "b",
    ]);
    expect(
      applySuggestion(doc(), s, [{ ...library[0], parentId: "foreign" }]),
    ).toBeNull();
    if (!result) throw new Error("Expected linked insert");
    expect(applySuggestion(result, s, library)).toBeNull();
  });
  it("adds, removes and reorders entries including hidden entries with exact permutations", () => {
    const original = doc();
    original.sections.experience.items[1].hidden = true;
    const reorder: ResumeSuggestionV2 = {
      id: "order",
      reason: "Review",
      op: "reorder_entries",
      section: "experience",
      itemIds: ["two", "one"],
    };
    expect(
      applySuggestion(original, reorder)?.sections.experience.items.map(
        (i) => i.id,
      ),
    ).toEqual(["two", "one"]);
    for (const itemIds of [
      ["one"],
      ["one", "one"],
      ["one", "foreign"],
      ["one", "two", "extra"],
    ])
      expect(applySuggestion(original, { ...reorder, itemIds })).toBeNull();
    const added = applySuggestion(original, {
      id: "add",
      reason: "Review",
      op: "add_entry",
      section: "projects",
      index: 0,
      item: { name: "New" },
    });
    if (!added) throw new Error("Expected added entry");
    expect(added.sections.projects.items[0]).toMatchObject({
      id: "cowork-entry-add",
      name: "New",
      hidden: false,
    });
    expect(
      applySuggestion(added, {
        id: "remove",
        reason: "Review",
        op: "remove_entry",
        section: "projects",
        itemId: "cowork-entry-add",
      })?.sections.projects.items,
    ).toEqual(original.sections.projects.items);
  });
});

it("includes hidden library entries, excludes them, and never writes the library", () => {
  const document = fixture();
  document.customSections = [];
  const item = document.sections.experience.items[0];
  item.libraryId = "role";
  item.hidden = true;
  const library = [
    { id: "role", kind: "role", text: "Role" },
  ] as import("@shared/types").ExperienceBullet[];
  const include: ResumeSuggestionV2 = {
    id: "include",
    reason: "Review",
    op: "include_library_item",
    libraryId: "role",
  };
  const included = applySuggestion(document, include, library);
  expect(included?.sections.experience.items[0].hidden).toBe(false);
  expect(item.hidden).toBe(true);
  if (!included) throw new Error("Expected include");
  const excluded = applySuggestion(
    included,
    { ...include, op: "exclude_library_item" },
    library,
  );
  expect(excluded?.sections.experience.items.map((i) => i.id)).toEqual(["two"]);
  expect(library).toEqual([{ id: "role", kind: "role", text: "Role" }]);
});

describe("batch line targeting after library membership changes", () => {
  it.each([
    "replace_bullet",
    "delete_bullet",
  ] as const)("resolves %s by current text and keeps the correct ref", (op) => {
    const document = fixture();
    document.customSections = [];
    document.sections.experience.items[0] = {
      ...document.sections.experience.items[0],
      libraryId: "role",
      description: "<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>",
      bulletRefs: ["a", "b", "c", "d"],
    };
    const library = [
      { id: "b", kind: "bullet", parentId: "role", text: "B" },
    ] as import("@shared/types").ExperienceBullet[];
    const result = applySuggestions(
      document,
      [
        {
          id: "exclude",
          reason: "Review",
          op: "exclude_library_item",
          libraryId: "b",
        },
        {
          id: "edit",
          reason: "Review",
          op,
          section: "experience",
          itemId: "one",
          bulletIndex: 2,
          previousText: "C",
          ...(op === "replace_bullet" ? { text: "C2" } : {}),
        } as ResumeSuggestionV2,
      ],
      library,
    );
    const item = result.document.sections.experience.items[0];
    expect(item.description).toBe(
      op === "replace_bullet"
        ? "<ul><li>A</li><li>C2</li><li>D</li></ul>"
        : "<ul><li>A</li><li>D</li></ul>",
    );
    expect(item.bulletRefs).toEqual(
      op === "replace_bullet" ? ["a", "c", "d"] : ["a", "d"],
    );
    expect(result.applied).toEqual(["edit", "exclude"]);
  });
  it("includes a line by unhiding both its existing parent and section", () => {
    const document = fixture();
    document.customSections = [];
    document.sections.experience.hidden = true;
    document.sections.experience.items[0].hidden = true;
    document.sections.experience.items[0].libraryId = "role";
    const library = [
      { id: "role", kind: "role", text: "Engineer" },
      { id: "new", kind: "bullet", parentId: "role", text: "New" },
    ] as import("@shared/types").ExperienceBullet[];
    const result = applySuggestion(
      document,
      {
        id: "include",
        reason: "Review",
        op: "include_library_item",
        libraryId: "new",
      },
      library,
    );
    expect(result?.sections.experience.hidden).toBe(false);
    expect(result?.sections.experience.items[0].hidden).toBe(false);
    expect(result?.sections.experience.items[0].bulletRefs).toContain("new");
    expect(document.sections.experience.hidden).toBe(true);
    expect(document.sections.experience.items[0].hidden).toBe(true);
  });
});

describe("snapshot positions before library membership changes", () => {
  const original = () => {
    const document = fixture();
    document.customSections = [];
    document.sections.experience.items[0] = {
      ...document.sections.experience.items[0],
      libraryId: "role",
      description: "<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>",
      bulletRefs: ["a", "b", "c", "d"],
    };
    return document;
  };
  const library = [
    { id: "b", kind: "bullet", parentId: "role", text: "B" },
  ] as import("@shared/types").ExperienceBullet[];
  it.each([
    3, 4,
  ])("inserts at snapshot position %i before excluding an earlier line", (bulletIndex) => {
    const result = applySuggestions(
      original(),
      [
        {
          id: "exclude",
          reason: "Review",
          op: "exclude_library_item",
          libraryId: "b",
        },
        {
          id: "insert",
          reason: "Review",
          op: "insert_bullet",
          section: "experience",
          itemId: "one",
          bulletIndex,
          text: "New",
        },
      ],
      library,
    );
    const item = result.document.sections.experience.items[0];
    expect(item.description).toBe(
      bulletIndex === 3
        ? "<ul><li>A</li><li>C</li><li>New</li><li>D</li></ul>"
        : "<ul><li>A</li><li>C</li><li>D</li><li>New</li></ul>",
    );
    expect(item.bulletRefs).toEqual(
      bulletIndex === 3 ? ["a", "c", null, "d"] : ["a", "c", "d", null],
    );
    expect(result.applied).toEqual(["insert", "exclude"]);
  });
  it.each([
    "replace_bullet",
    "delete_bullet",
  ] as const)("targets the second linked duplicate for %s after excluding b", (op) => {
    const document = original();
    document.sections.experience.items[0].description =
      "<ul><li>X</li><li>B</li><li>X</li></ul>";
    document.sections.experience.items[0].bulletRefs = ["x1", "b", "x2"];
    const result = applySuggestions(
      document,
      [
        {
          id: "exclude",
          reason: "Review",
          op: "exclude_library_item",
          libraryId: "b",
        },
        {
          id: "edit",
          reason: "Review",
          op,
          section: "experience",
          itemId: "one",
          bulletIndex: 2,
          previousText: "X",
          ...(op === "replace_bullet" ? { text: "Y" } : {}),
        } as ResumeSuggestionV2,
      ],
      library,
    );
    expect(result.document.sections.experience.items[0]).toMatchObject({
      description:
        op === "replace_bullet"
          ? "<ul><li>X</li><li>Y</li></ul>"
          : "<ul><li>X</li></ul>",
      bulletRefs: op === "replace_bullet" ? ["x1", "x2"] : ["x1"],
    });
  });
  it("prefers the snapshot ref over a newly introduced closer text match", () => {
    const document = original();
    document.sections.experience.items[0].description =
      "<ul><li>X</li><li>B</li><li>C</li><li>D</li></ul>";
    document.sections.experience.items[0].bulletRefs = ["x1", "b", "c", "d"];
    const result = applySuggestions(document, [
      {
        id: "new-match",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "one",
        bulletIndex: 2,
        previousText: "C",
        text: "X",
      },
      {
        id: "target",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "one",
        bulletIndex: 3,
        previousText: "X",
        text: "Y",
      },
    ]);
    expect(result.document.sections.experience.items[0]).toMatchObject({
      description: "<ul><li>Y</li><li>B</li><li>X</li><li>D</li></ul>",
      bulletRefs: ["x1", "b", "c", "d"],
    });
  });
  it("falls back to the closest text match when no snapshot ref is available", () => {
    const document = original();
    document.sections.experience.items[0].description =
      "<ul><li>X</li><li>B</li><li>X</li><li>D</li></ul>";
    document.sections.experience.items[0].bulletRefs = [];
    expect(
      suggestionTarget(document, {
        id: "near",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "one",
        bulletIndex: 3,
        previousText: "X",
        text: "Y",
      }),
    ).toEqual({ old: "X", index: 2 });
  });
  it("adds entries at the snapshot position before excluding an earlier entry", () => {
    const document = original();
    const result = applySuggestions(
      document,
      [
        {
          id: "exclude",
          reason: "Review",
          op: "exclude_library_item",
          libraryId: "role",
        },
        {
          id: "add",
          reason: "Review",
          op: "add_entry",
          section: "experience",
          index: 2,
          item: { company: "New company", position: "New role" },
        },
      ],
      [
        { id: "role", kind: "role", text: "Role" },
      ] as import("@shared/types").ExperienceBullet[],
    );
    expect(
      result.document.sections.experience.items.map((item) => item.id),
    ).toEqual(["two", "cowork-entry-add"]);
    expect(result.applied).toEqual(["add", "exclude"]);
  });
});

describe("skills acceptance guards", () => {
  it("rejects stale snapshots and preserves matched metadata and hidden rows", () => {
    const doc = fixture();
    const visible = {
      id: "visible",
      libraryId: "skill-lib",
      hidden: false,
      name: "Languages",
      keywords: ["JS"],
      icon: "code",
      proficiency: "Expert",
      level: 4,
    };
    const hidden = { ...visible, id: "hidden", hidden: true, name: "Private" };
    doc.sections.skills.items = [visible, hidden];
    const update: ResumeSuggestionV2 = {
      id: "keywords",
      reason: "Improve",
      op: "set_skill_keywords",
      itemId: "visible",
      previousKeywords: ["JS"],
      keywords: ["TS"],
    };
    const next = applySuggestion(doc, update);
    expect(next?.sections.skills.items).toEqual([
      { ...visible, keywords: ["TS"] },
      hidden,
    ]);
    expect(
      applySuggestion(doc, { ...update, previousKeywords: ["old"] }),
    ).toBeNull();
    doc.sections.skills.hidden = true;
    expect(applySuggestion(doc, update)).toBeNull();
  });
  it("keeps edits local even for dangling linked fields and project prose", () => {
    const doc = fixture();
    doc.sections.experience.items[0].libraryId = "missing";
    const change = suggestion({
      op: "replace_field",
      field: { section: "experience", itemId: "one", name: "company" },
      previousText: undefined,
    });
    expect(suggestionTarget(doc, change)).toEqual({ old: "" });
    doc.sections.projects = {
      items: [{ id: "project", libraryId: "project-lib", description: "Old" }],
    } as unknown as typeof doc.sections.projects;
    const library = [
      { id: "project-lib", kind: "project", text: "Project" },
    ] as unknown as import("@shared/types").ExperienceBullet[];
    expect(
      suggestionTarget(
        doc,
        {
          ...change,
          op: "replace_field",
          text: "Improved",
          field: {
            section: "projects",
            itemId: "project",
            name: "description",
          },
          previousText: "Old",
        },
        library,
      ),
    ).toEqual({ old: "Old" });
  });
  it("links inserted lines to a single valid cited bullet of the linked parent", () => {
    const doc = fixture();
    doc.sections.experience.items[0].libraryId = "role";
    const library = [
      { id: "role", kind: "role" },
      { id: "bullet", kind: "bullet", parentId: "role" },
    ] as import("@shared/types").ExperienceBullet[];
    const next = applySuggestion(
      doc,
      suggestion({
        op: "insert_bullet",
        bulletIndex: 0,
        sourceBulletIds: ["bullet"],
      }),
      library,
    );
    expect(next && getItemLines(next.sections.experience.items[0])[0].ref).toBe(
      "bullet",
    );
  });
  it("rejects reinserting a cited library line already on the resume", () => {
    const original = fixture();
    original.sections.experience.items[0].bulletRefs = ["used", null];
    original.sections.experience.items[0].libraryId = "role";
    const library = [
      { id: "used", kind: "bullet", parentId: "role" },
      { id: "available", kind: "bullet", parentId: "role" },
    ] as import("@shared/types").ExperienceBullet[];
    const insert = suggestion({
      op: "insert_bullet",
      bulletIndex: 0,
      sourceBulletIds: ["available"],
    });
    const next = applySuggestion(original, insert, library);
    if (!next) throw new Error("Expected insertion to apply");
    expect(getItemLines(next.sections.experience.items[0])[0].ref).toBe(
      "available",
    );
    const again = applySuggestion(next, insert, library);
    expect(again).toBeNull();
  });
});
