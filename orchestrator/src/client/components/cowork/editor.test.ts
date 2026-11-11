import type {
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
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
): ResumeSuggestion => ({
  id: "s",
  op: "replace_bullet",
  experienceId: "one",
  bulletIndex: 0,
  previousText: "Second",
  text: "Improved",
  reason: "More specific",
  ...overrides,
});

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
  it("applies headline and skills replacements without losing other sections", () => {
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
        suggestion({
          op: "set_skills",
          skills: [{ name: "Languages", keywords: ["TypeScript"] }],
        }),
      )?.sections.skills.items[0],
    ).toMatchObject({
      name: "Languages",
      keywords: ["TypeScript"],
      hidden: false,
    });
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
    expect(result.applied).toEqual(["s", "b"]);
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

// Step A implements these pure helpers in parallel. Exercise the editor against
// their fixed contract without depending on its placeholder bodies.
vi.mock("@shared/resume-links", async () => {
  const { splitDescription, joinDescription } = await import(
    "@shared/resume-bullets"
  );
  const getItemLines = (item: Record<string, unknown>) =>
    splitDescription(String(item.description ?? "")).bullets.map(
      (text, index) => ({
        text,
        ref:
          (item.bulletRefs as (string | null)[] | undefined)?.[index] ?? null,
      }),
    );
  const setItemLines = (
    item: Record<string, unknown>,
    lines: { text: string; ref: string | null }[],
  ) => ({
    ...item,
    description: joinDescription(
      splitDescription(String(item.description ?? "")).introHtml,
      lines.map((line) => line.text),
      String(item.description ?? ""),
    ),
    bulletRefs: lines.map((line) => line.ref),
  });
  return {
    getItemLines,
    setItemLines,
    sameLineText: (a: string, b: string) =>
      a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " "),
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
  it("rejects blank rewording and entry field edits on linked entries", () => {
    const original = fixture();
    original.sections.experience.items[0].libraryId = "role";
    original.sections.experience.items[0].bulletRefs = ["first", "second"];
    expect(applySuggestion(original, suggestion({ text: " " }))).toBeNull();
    expect(
      applySuggestion(
        original,
        suggestion({
          op: "replace_field",
          field: { section: "experience", itemId: "one", name: "company" },
          previousText: undefined,
        }),
      ),
    ).toBeNull();
  });
});
