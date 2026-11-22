import { describe, expect, it } from "vitest";
import { normalizeStringArray } from "./normalize-string-array";

describe("normalizeStringArray", () => {
  it("returns empty array for nullish/empty input", () => {
    expect(normalizeStringArray(undefined)).toEqual([]);
    expect(normalizeStringArray(null)).toEqual([]);
    expect(normalizeStringArray([])).toEqual([]);
  });

  it("trims values and removes empty entries", () => {
    expect(normalizeStringArray(["  staffing  ", " ", "\n"])).toEqual(["staffing"]);
  });

  it("deduplicates values case-insensitively while preserving first casing", () => {
    expect(normalizeStringArray(["Recruit", "staffing", "recruit", "STAFFING"])).toEqual([
      "Recruit",
      "staffing",
    ]);
  });
});

describe("normalizeStringArray options", () => {
  it("dedupes case-sensitively when asked", () => {
    expect(normalizeStringArray([" Id", "id", "Id "], { caseSensitive: true })).toEqual([
      "Id",
      "id",
    ]);
  });

  it("truncates before deduping and stops at maxItems", () => {
    expect(
      normalizeStringArray(["abcX", "ABCy", "d", "e"], {
        maxLength: 3,
        maxItems: 2,
      }),
    ).toEqual(["abc", "d"]);
  });
});
