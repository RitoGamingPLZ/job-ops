import { describe, expect, it } from "vitest";
import { pickFiltersFromIntent } from "./pick";
import type { Facets, FilterIntent } from "./types";

const intent = (overrides: Partial<FilterIntent> = {}): FilterIntent => ({
  titles: ["Backend Engineer", "Platform Engineer"],
  country: "Canada",
  cities: ["Toronto"],
  workplaceTypes: ["remote"],
  ...overrides,
});
const facets = (params: Facets["params"]): Facets => ({ unfilteredTotal: 100, params });
const choice = (
  key: string,
  role: NonNullable<Facets["params"][number]["role"]>,
  options: string[],
  multi = false,
) => ({ key, role, multi, values: options.map((value) => ({ value })) });

describe("pickFiltersFromIntent", () => {
  it("puts the first title in the keyword box and ignores boards' own parameter names", () => {
    for (const key of ["q", "query", "fwp_search"]) {
      expect(
        pickFiltersFromIntent(
          intent(),
          facets([{ key, role: "keyword", multi: false, freeText: true }]),
        ).params,
      ).toEqual([{ key, values: ["Backend Engineer"] }]);
    }
  });

  it("prefers a city over the country, and takes several places only where the filter is multi", () => {
    const text = (multi: boolean) =>
      facets([{ key: "location", role: "location", multi, freeText: true }]);
    expect(pickFiltersFromIntent(intent(), text(false)).params).toEqual([
      { key: "location", values: ["Toronto"] },
    ]);
    expect(
      pickFiltersFromIntent(intent({ cities: ["Toronto", "Montreal"] }), text(true)).params,
    ).toEqual([{ key: "location", values: ["Toronto", "Montreal", "Canada"] }]);
  });

  it("matches a location choice by name, in either direction, best place first", () => {
    const options = ["London, UK", "Toronto, ON, Canada", "Canada"];
    expect(
      pickFiltersFromIntent(intent(), facets([choice("offices", "location", options, true)]))
        .params,
    ).toEqual([{ key: "offices", values: ["Toronto, ON, Canada", "Canada"] }]);
    expect(
      pickFiltersFromIntent(intent(), facets([choice("offices", "location", options)])).params,
    ).toEqual([{ key: "offices", values: ["Toronto, ON, Canada"] }]);
  });

  it("maps workplace types to the board's own labels, and skips 'any workplace'", () => {
    const workplace = facets([
      choice("Work Type", "workplace", ["On-site", "Hybrid", "Remote friendly"], true),
    ]);
    expect(
      pickFiltersFromIntent(intent({ workplaceTypes: ["remote", "hybrid"] }), workplace).params,
    ).toEqual([{ key: "Work Type", values: ["Remote friendly", "Hybrid"] }]);
    expect(
      pickFiltersFromIntent(intent({ workplaceTypes: ["remote", "hybrid", "onsite"] }), workplace)
        .params,
    ).toEqual([]);
    expect(pickFiltersFromIntent(intent({ workplaceTypes: [] }), workplace).params).toEqual([]);
  });

  it("finds the department a title belongs to by word stem, ignoring seniority", () => {
    const department = facets([
      choice("team", "department", ["Marketing", "Software Engineering", "Sales"]),
    ]);
    expect(
      pickFiltersFromIntent(intent({ titles: ["Senior Software Engineer"] }), department).params,
    ).toEqual([{ key: "team", values: ["Software Engineering"] }]);
    // "Senior" alone says nothing about the kind of work.
    expect(pickFiltersFromIntent(intent({ titles: ["Senior Lead"] }), department).params).toEqual(
      [],
    );
    // The user's note about the source can name the team.
    expect(
      pickFiltersFromIntent(intent({ titles: [] }), department, "marketing team").params,
    ).toEqual([{ key: "team", values: ["Marketing"] }]);
  });

  it("leaves filters it has no preference for, and a board with no such roles, alone", () => {
    expect(
      pickFiltersFromIntent(
        intent(),
        facets([
          choice("level", "level", ["Senior"]),
          choice("commitment", "employmentType", ["Full-time"]),
          { key: "degree", multi: false, values: [{ value: "MASTERS" }] },
        ]),
      ).params,
    ).toEqual([]);
    expect(
      pickFiltersFromIntent(intent({ titles: [], cities: [], country: "" }), facets([])).params,
    ).toEqual([]);
  });

  it("describes what it matched, within the response limit", () => {
    const { rationale } = pickFiltersFromIntent(
      intent(),
      facets([{ key: "q", role: "keyword", multi: false, freeText: true }]),
    );
    expect(rationale).toBe("Matched your saved search preferences (keyword: Backend Engineer)");
    expect(rationale.length).toBeLessThanOrEqual(300);
  });
});
