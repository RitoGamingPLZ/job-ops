import { describe, expect, it } from "vitest";
import { inferControlRole, roleField, roleOf, roleRank } from "./control-roles";

describe("inferControlRole", () => {
  // Parameter names used by the dedicated parsers' facet discoverers and common board software.
  it.each([
    // Keyword
    ["q", "keyword"],
    ["query", "keyword"],
    ["keywords", "keyword"],
    ["fwp_search", "keyword"],
    ["searchText", "keyword"],
    // Location
    ["location", "location"],
    ["locations", "location"],
    ["loc", "location"],
    ["offices", "location"],
    ["Region", "location"],
    ["filter_Location", "location"],
    ["location_search", "location"],
    // Workplace (before employment: Eightfold's "Work Type" is remote/onsite)
    ["workplace", "workplace"],
    ["workplaceType", "workplace"],
    ["Work Type", "workplace"],
    ["remote", "workplace"],
    // Employment type
    ["employment_type", "employmentType"],
    ["commitment", "employmentType"],
    ["timeType", "employmentType"],
    ["job_type", "employmentType"],
    // Department
    ["team", "department"],
    ["Teams", "department"],
    ["departments", "department"],
    ["job_category", "department"],
    // Level
    ["target_level", "level"],
    ["seniority", "level"],
  ] as const)("reads %s as %s", (key, role) => {
    expect(inferControlRole(key)).toBe(role);
  });

  it.each(["degree", "context", "sort_by", "lang", "utm_source", "page", "id"])(
    "makes no guess for %s",
    (key) => {
      expect(inferControlRole(key)).toBeUndefined();
    },
  );

  it("falls back to the label when the key says nothing", () => {
    expect(inferControlRole("f1", "Job location")).toBe("location");
    expect(inferControlRole("f2", "Search jobs")).toBe("keyword");
    expect(inferControlRole("f3")).toBeUndefined();
  });

  it("prefers a recorded role over a guess", () => {
    expect(roleOf({ key: "q", role: "location" })).toBe("location");
    expect(roleField({ key: "q" })).toEqual({ role: "keyword" });
    expect(roleField({ key: "zzz" })).toEqual({});
  });

  it("orders keyword first, unknown roles last", () => {
    const order = ["level", undefined, "keyword", "location"].map((role) =>
      roleRank(role as never),
    );
    expect(order).toEqual([5, 6, 0, 1]);
  });
});
