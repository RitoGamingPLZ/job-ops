import { describe, expect, it, vi } from "vitest";
import { parseGreenhouseUrl } from "@career-boards/greenhouse";
import { parseEightfoldUrl } from "../adapters/eightfold";
import { searchUrl } from "../adapters/google";
import { parseLeverUrl } from "../adapters/lever";
import { detectQueryPagination } from "./run-recipe";
import { buildSearchUrl, readSearchValues, type SearchValues } from "./search";
import { recipeSchema, type RecipeSearch } from "./types";

vi.mock("./fetch", () => ({ loadPage: vi.fn(), isAllowedByRobots: vi.fn() }));

// The dedicated parsers own the URL conventions of their boards. A recipe's search controls are
// only compatible with them if a URL built from the controls survives each parser's own
// normalizer unchanged, and reads back to the same values. These fixtures mirror each parser's
// facet discoverer (autofilter/facets/*): same keys, same single/multi, same free-text keys.

const search = (url: string, params: RecipeSearch["params"]): RecipeSearch => ({
  url,
  params,
  pagination: { kind: "none" },
  maxPages: 1,
  render: false,
});
const choice = (
  key: string,
  values: string[],
  encoding: "single" | "repeat" | "comma",
): RecipeSearch["params"][number] => ({
  key,
  input: { kind: "choice", options: values.map((value) => ({ value })) },
  encoding,
});
const sorted = (values: string[]) => [...values].sort();

/**
 * Build the URL, run it through the parser's own pure URL normalizer (never an adapter method
 * that probes the network), then read the values back from the normalized URL.
 */
function roundTrip(
  normalize: (url: string) => string,
  recipeSearch: RecipeSearch,
  values: SearchValues,
) {
  const built = buildSearchUrl(recipeSearch, values);
  const normalized = normalize(built);
  const read = readSearchValues(recipeSearch, normalized);
  return {
    built,
    normalized,
    read: Object.fromEntries(Object.entries(read).map(([key, list]) => [key, sorted(list)])),
  };
}
const google = (url: string) => searchUrl(url).toString();
const lever = (url: string) => parseLeverUrl(url).careersUrl;
const greenhouse = (url: string) => parseGreenhouseUrl(url).canonicalCareersUrl;
const eightfold = (url: string) => parseEightfoldUrl(url).url.toString();
const expected = (values: SearchValues) =>
  Object.fromEntries(Object.entries(values).map(([key, list]) => [key, sorted(list)]));

describe("recipe search controls versus dedicated parsers", () => {
  it("Google: free text, multi-value free text and repeated enum keys survive its normalizer", () => {
    const googleSearch = search("https://www.google.com/about/careers/applications/jobs/results/", [
      { key: "q", input: { kind: "text" }, encoding: "single" },
      { key: "location", input: { kind: "text", multiple: true }, encoding: "repeat" },
      choice("employment_type", ["FULL_TIME", "PART_TIME", "TEMPORARY", "INTERN"], "repeat"),
      choice("target_level", ["EARLY", "MID", "ADVANCED"], "repeat"),
    ]);
    const values = {
      q: ["data engineer"],
      location: ["Toronto, ON, Canada", "London, UK"],
      employment_type: ["FULL_TIME", "INTERN"],
      target_level: ["MID"],
    };
    const result = roundTrip(google, googleSearch, values);
    expect(result.read).toEqual(expected(values));
    // The parser adds only its own ordering parameter; it never drops or renames ours.
    expect(new URL(result.normalized).searchParams.get("sort_by")).toBe("date");
  });

  it("Lever: repeated keys, including values that contain commas, survive its normalizer", () => {
    const leverSearch = search("https://jobs.lever.co/acme", [
      choice("location", ["San Francisco, CA", "Remote"], "repeat"),
      choice("team", ["Platform", "Data"], "repeat"),
      choice("workplaceType", ["remote", "hybrid"], "single"),
    ]);
    const values = {
      location: ["San Francisco, CA", "Remote"],
      team: ["Data", "Platform"],
      workplaceType: ["remote"],
    };
    expect(roundTrip(lever, leverSearch, values).read).toEqual(expected(values));
  });

  it("Lever locations with a comma cannot use the comma encoding", () => {
    const comma = choice("location", ["San Francisco, CA"], "comma");
    expect(() =>
      recipeSchema.parse({
        version: 2,
        jobUrlPattern: "/jobs/",
        listing: { kind: "sitemap", url: "https://jobs.lever.co/sitemap.xml" },
        search: search("https://jobs.lever.co/acme", [comma]),
        detail: { kind: "jsonld" },
      }),
    ).toThrow(/commas/);
  });

  it("Greenhouse: single-value controls survive; repeated keys are rewritten, so they must not be offered", () => {
    const board = "https://job-boards.greenhouse.io/acme";
    const single = search(board, [
      choice("departments", ["Engineering"], "single"),
      choice("location", ["Remote"], "single"),
      choice("workplace", ["Remote"], "single"),
    ]);
    const values = { departments: ["Engineering"], location: ["Remote"], workplace: ["Remote"] };
    expect(roundTrip(greenhouse, single, values).read).toEqual(expected(values));

    // Greenhouse joins repeated departments with commas, which is why its facets are multi:false.
    const repeated = search(board, [choice("departments", ["Engineering", "Sales"], "repeat")]);
    const result = roundTrip(greenhouse, repeated, {
      departments: ["Engineering", "Sales"],
    });
    expect(result.normalized).not.toBe(result.built);
  });

  it("Eightfold: keys with spaces, filter_ keys and free-text query survive its normalizer", () => {
    const eightfoldSearch = search("https://explore.jobs.netflix.net/careers", [
      { key: "query", input: { kind: "text" }, encoding: "single" },
      choice("Work Type", ["remote", "onsite"], "repeat"),
      choice("Teams", ["Engineering", "Games"], "repeat"),
    ]);
    const values = {
      query: ["rust"],
      "Work Type": ["remote", "onsite"],
      Teams: ["Games"],
    };
    expect(roundTrip(eightfold, eightfoldSearch, values).read).toEqual(expected(values));
  });

  it("rejects multi-value free text that has no way to be written", () => {
    expect(() =>
      recipeSchema.parse({
        version: 2,
        jobUrlPattern: "/jobs/",
        listing: { kind: "sitemap", url: "https://example.com/sitemap.xml" },
        search: search("https://example.com/careers", [
          { key: "location", input: { kind: "text", multiple: true }, encoding: "single" },
        ]),
        detail: { kind: "jsonld" },
      }),
    ).toThrow();
  });

  it("builds comma-joined multi-values and refuses a comma inside one", () => {
    const joined = search("https://example.com/careers", [
      { key: "loc", input: { kind: "text", multiple: true }, encoding: "comma" },
    ]);
    expect(
      new URL(buildSearchUrl(joined, { loc: ["Paris", "Berlin"] })).searchParams.get("loc"),
    ).toBe("Paris,Berlin");
    expect(() => buildSearchUrl(joined, { loc: ["Paris, FR"] })).toThrow();
  });
});

describe("pager names used by dedicated boards", () => {
  const first = "https://explore.jobs.netflix.net/careers?query=rust";
  const next = (param: string, value: number) => `${first}&${param}=${value}`;

  it.each([
    ["start", 10, { param: "start", start: 0, step: 10 }],
    ["from", 20, { param: "from", start: 0, step: 20 }],
    ["pg", 2, { param: "pg", start: 1, step: 1 }],
    ["pageNumber", 2, { param: "pageNumber", start: 1, step: 1 }],
  ])("a verifying caller recognizes %s", (param, value, expectedPager) => {
    expect(detectQueryPagination([next(param, value)], first, undefined, true)).toEqual({
      kind: "query",
      ...expectedPager,
    });
  });

  it("keeps the narrow list for callers that cannot verify page two", () => {
    expect(detectQueryPagination([next("start", 10)], first)).toBeNull();
    expect(detectQueryPagination([next("page", 2)], first)).toMatchObject({ param: "page" });
  });
});
