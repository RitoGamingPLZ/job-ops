import { describe, expect, it } from "vitest";
import { rankFacetValues } from "./shared";

describe("rankFacetValues", () => {
  it("sorts by descending count then alphabetically and caps at 60 items", () => {
    const counts = Array.from(
      { length: 65 },
      (_, index) => [`item-${String(index).padStart(2, "0")}`, index % 5] as const,
    );

    const ranked = rankFacetValues(counts);
    expect(ranked).toHaveLength(60);
    expect(ranked[0]).toEqual({ value: "item-04", count: 4 });
    expect(ranked[1]).toEqual({ value: "item-09", count: 4 });
  });

  it("treats undefined counts uniformly and breaks ties alphabetically", () => {
    expect(
      rankFacetValues([
        ["Zeta", undefined],
        ["Alpha", undefined],
        ["Beta", 1],
      ]),
    ).toEqual([
      { value: "Beta", count: 1 },
      { value: "Alpha", count: undefined },
      { value: "Zeta", count: undefined },
    ]);
  });
});
