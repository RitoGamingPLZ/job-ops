import { bulletsFromHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import {
  moveItem,
  moveResumeBullet,
  moveSection,
  sectionOrder,
} from "./resumeReorder";

const fixture = () =>
  ({
    sections: {
      experience: {
        items: [
          { id: "a", description: "<ul><li>A</li><li>B</li><li>C</li></ul>" },
          { id: "b", description: "<ul><li>D</li></ul>" },
        ],
      },
    },
  }) as unknown as ReactiveResumeV5Document;

describe("resume drag reordering", () => {
  it("adjusts a destination gap after removing an earlier item", () => {
    expect(moveItem(["A", "B", "C"], 0, 3)).toEqual(["B", "C", "A"]);
    expect(moveItem(["A", "B", "C"], 0, 2)).toEqual(["B", "A", "C"]);
  });
  it("moves upward and leaves adjacent gaps unchanged", () => {
    expect(moveItem(["A", "B", "C"], 2, 0)).toEqual(["C", "A", "B"]);
    expect(moveItem(["A", "B", "C"], 1, 2)).toEqual(["A", "B", "C"]);
    expect(moveItem(["A", "B", "C"], 1, 1)).toEqual(["A", "B", "C"]);
  });
  it("moves bullets across experiences without mutating the source document", () => {
    const original = fixture();
    const next = moveResumeBullet(
      original,
      { experienceId: "a", index: 1 },
      "b",
      0,
    );
    expect(
      next.sections.experience.items.map((e) => bulletsFromHtml(e.description)),
    ).toEqual([
      ["A", "C"],
      ["B", "D"],
    ]);
    expect(
      bulletsFromHtml(original.sections.experience.items[0].description),
    ).toEqual(["A", "B", "C"]);
  });
  it("reorders bullets within one experience", () => {
    const next = moveResumeBullet(
      fixture(),
      { experienceId: "a", index: 0 },
      "a",
      3,
    );
    expect(
      bulletsFromHtml(next.sections.experience.items[0].description),
    ).toEqual(["B", "C", "A"]);
  });
  it("ignores invalid and hidden targets", () => {
    const original = fixture();
    expect(
      moveResumeBullet(original, { experienceId: "a", index: 9 }, "b", 0),
    ).toBe(original);
    expect(
      moveResumeBullet(original, { experienceId: "a", index: 0 }, "b", -1),
    ).toBe(original);
    original.sections.experience.items[1].hidden = true;
    expect(
      moveResumeBullet(original, { experienceId: "a", index: 0 }, "b", 0),
    ).toBe(original);
    expect(moveItem([1], Number.NaN, 0)).toEqual([1]);
  });
});

describe("section order", () => {
  const doc = (pages: { main: string[]; sidebar: string[] }[]) =>
    ({
      metadata: { layout: { sidebarWidth: 30, pages } },
    }) as unknown as ReactiveResumeV5Document;
  it("flattens main then sidebar, summary first, keeping unknown keys", () => {
    expect(sectionOrder(undefined)[0]).toBe("summary");
    expect(
      sectionOrder(
        doc([{ main: ["profiles", "experience"], sidebar: ["skills"] }])
          .metadata.layout,
      ).slice(0, 5),
    ).toEqual([
      "summary",
      "profiles",
      "experience",
      "skills",
      "certifications",
    ]);
  });
  it("writes the whole order to pages[0].main and clears the sidebar", () => {
    const start = doc([
      { main: ["profiles", "experience", "education"], sidebar: ["skills"] },
    ]);
    const moved = moveSection(start, "skills", "experience");
    expect(moved.metadata.layout.pages[0].main.slice(0, 4)).toEqual([
      "summary",
      "profiles",
      "skills",
      "experience",
    ]);
    expect(moved.metadata.layout.pages[0].sidebar).toEqual([]);
    expect(
      moveSection(start, "profiles", null).metadata.layout.pages[0].main.at(-1),
    ).toBe("profiles");
    expect(start.metadata.layout.pages[0].sidebar).toEqual(["skills"]);
  });
  it("creates a layout when the document has none", () => {
    const moved = moveSection(
      {} as ReactiveResumeV5Document,
      "awards",
      "summary",
    );
    expect(moved.metadata.layout.pages[0].main[0]).toBe("awards");
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

it("moves refs with their text within and between entries, preserving intro prose", () => {
  const original = fixture();
  original.sections.experience.items[0].bulletRefs = ["first", null, "third"];
  original.sections.experience.items[0].description = `<p>Intro</p>${original.sections.experience.items[0].description}`;
  original.sections.experience.items[1].bulletRefs = ["fourth"];
  const reordered = moveResumeBullet(
    original,
    { experienceId: "a", index: 0 },
    "a",
    3,
  );
  expect(reordered.sections.experience.items[0].bulletRefs).toEqual([
    null,
    "third",
    "first",
  ]);
  const moved = moveResumeBullet(
    reordered,
    { experienceId: "a", index: 2 },
    "b",
    0,
  );
  expect(moved.sections.experience.items[0].bulletRefs).toEqual([
    null,
    "third",
  ]);
  expect(moved.sections.experience.items[1].bulletRefs).toEqual([
    "first",
    "fourth",
  ]);
  expect(moved.sections.experience.items[0].description).toBe(
    "<p>Intro</p><ul><li>B</li><li>C</li></ul>",
  );
  expect(original.sections.experience.items[0].bulletRefs).toEqual([
    "first",
    null,
    "third",
  ]);
});
