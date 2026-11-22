import { describe, expect, it } from "vitest";
import { normalizeSearchTerms } from "./search-terms";

describe("normalizeSearchTerms", () => {
  it("truncates before deduping case-insensitively", () => {
    expect(
      normalizeSearchTerms([" abcX", "ABCy", "", "de"], { maxLength: 3 }),
    ).toEqual(["abc", "de"]);
  });

  it("stops at the cap and clamps limits to at least 1", () => {
    expect(normalizeSearchTerms(["a", "b", "c"], { maxTerms: 2 })).toEqual([
      "a",
      "b",
    ]);
    expect(normalizeSearchTerms(["a", "b"], { maxTerms: 0 })).toEqual(["a"]);
    expect(normalizeSearchTerms(["ab", "c"], { maxLength: 0 })).toEqual([
      "a",
      "c",
    ]);
  });
});
