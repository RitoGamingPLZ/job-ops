import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  applySuggestions,
  dropBullet,
  readBulletTransfer,
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
