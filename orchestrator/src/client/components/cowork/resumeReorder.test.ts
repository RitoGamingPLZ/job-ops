import { bulletsFromHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document } from "@shared/types";
import { describe, expect, it } from "vitest";
import { moveItem, moveResumeBullet } from "./resumeReorder";

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
