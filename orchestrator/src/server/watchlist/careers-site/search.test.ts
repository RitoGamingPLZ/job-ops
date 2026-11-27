import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchUrl,
  discoverSearchParams,
  facetParamsFromSearch,
  readSearchValues,
  sameListingPath,
  verifySearch,
} from "./search";
import type { Recipe, RecipeSearch } from "./types";

vi.mock("./fetch", () => ({ loadPage: vi.fn(), isAllowedByRobots: vi.fn() }));

const root = "https://careers.example.com";
const listing = `${root}/openings`;
const search: RecipeSearch = {
  url: `${listing}?lang=en`,
  params: [
    { key: "q", label: "Keyword", input: { kind: "text" }, encoding: "single" },
    {
      key: "city",
      input: {
        kind: "choice",
        options: [{ value: "tor", label: "Toronto" }, { value: "nyc" }],
      },
      encoding: "single",
    },
    {
      key: "team",
      input: { kind: "choice", options: [{ value: "eng" }, { value: "ops" }, { value: "design" }] },
      encoding: "repeat",
    },
    {
      key: "level",
      input: { kind: "choice", options: [{ value: "a" }, { value: "b" }] },
      encoding: "comma",
    },
  ],
  pagination: { kind: "query", param: "page", start: 1, step: 1 },
  maxPages: 5,
  render: false,
};
const recipe: Recipe = {
  version: 2,
  jobUrlPattern: "/jobs/\\d+$",
  jobIdPattern: "/jobs/(\\d+)$",
  listing: { kind: "sitemap", url: `${root}/sitemap.xml` },
  search,
  detail: { kind: "jsonld" },
};

describe("buildSearchUrl", () => {
  it("encodes each control with its learned convention and keeps fixed parameters", () => {
    const url = new URL(
      buildSearchUrl(search, {
        q: [" data engineer "],
        city: ["tor"],
        team: ["eng", "ops"],
        level: ["a", "b"],
      }),
    );
    expect(url.origin + url.pathname).toBe(listing);
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("q")).toBe("data engineer");
    expect(url.searchParams.getAll("team")).toEqual(["eng", "ops"]);
    expect(url.searchParams.get("level")).toBe("a,b");
  });

  it("restores the unfiltered listing for an empty selection", () => {
    expect(buildSearchUrl(search, { q: ["  "], city: [] })).toBe(`${listing}?lang=en`);
    expect(buildSearchUrl(search, {})).toBe(`${listing}?lang=en`);
  });

  it("removes a stale pager from a base URL that carried one", () => {
    const withPager = { ...search, url: `${listing}?lang=en&page=3&q=old` };
    expect(buildSearchUrl(withPager, { city: ["nyc"] })).toBe(`${listing}?city=nyc&lang=en`);
  });

  it("writes multi-value text per its encoding and rejects extra values for a single one", () => {
    const multi: RecipeSearch = {
      ...search,
      params: [
        { key: "loc", input: { kind: "text", multiple: true }, encoding: "repeat" },
        { key: "q", input: { kind: "text" }, encoding: "single" },
      ],
    };
    const url = new URL(buildSearchUrl(multi, { loc: ["Paris", "Berlin", "Paris"] }));
    expect(url.searchParams.getAll("loc")).toEqual(["Paris", "Berlin"]);
    expect(readSearchValues(multi, url.href)).toEqual({ loc: ["Paris", "Berlin"] });
    expect(() => buildSearchUrl(multi, { q: ["a", "b"] })).toThrow();
  });

  it.each([
    ["an unknown control", { nope: ["x"] }],
    ["a value that was never offered", { city: ["paris"] }],
    ["two values for a single-value control", { city: ["tor", "nyc"] }],
    ["control characters", { q: ["a\u0000b"] }],
    ["an overlong keyword", { q: ["x".repeat(121)] }],
    ["more than ten choices", { team: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
  ])("rejects %s", (_name, values) => {
    expect(() => buildSearchUrl(search, values)).toThrow();
  });
});

describe("readSearchValues / sameListingPath", () => {
  it("round-trips what buildSearchUrl produced", () => {
    const values = { q: ["nurse"], team: ["eng", "ops"], level: ["a", "b"] };
    expect(readSearchValues(search, buildSearchUrl(search, values))).toEqual(values);
    expect(readSearchValues(search, listing)).toEqual({});
  });

  it("matches the learned listing path regardless of query or trailing slash", () => {
    expect(sameListingPath(search, `${listing}/?q=x`)).toBe(true);
    expect(sameListingPath(search, `${root}/other?q=x`)).toBe(false);
    expect(sameListingPath(search, "https://evil.example/openings")).toBe(false);
    expect(sameListingPath(search, "not a url")).toBe(false);
  });
});

describe("discoverSearchParams", () => {
  it("finds GET text inputs and select choices with labels, ignoring POST and unusable keys", () => {
    const html = `
      <form method="get" action="/openings">
        <label for="kw">Job title</label><input id="kw" type="search" name="q">
        <input type="text" name="page"><input type="hidden" name="lang" value="en">
        <select name="city"><option value="">All</option><option value="tor">Toronto</option><option value="nyc">New York</option></select>
        <select name="team" multiple><option value="eng">Engineering</option><option value="ops">Ops</option></select>
        <select name="solo"><option value="only">Only</option></select>
      </form>
      <form method="post"><input type="text" name="email"></form>`;
    const found = discoverSearchParams(html, listing);
    expect(found.map((param) => param.key).sort()).toEqual(["city", "q", "team"]);
    expect(found.find((param) => param.key === "q")).toEqual({
      key: "q",
      label: "Job title",
      role: "keyword",
      input: { kind: "text" },
      encoding: "single",
    });
    const city = found.find((param) => param.key === "city");
    expect(city?.input).toEqual({
      kind: "choice",
      options: expect.arrayContaining([{ value: "tor", label: "Toronto" }]),
    });
    expect(city?.encoding).toBe("single");
    expect(found.find((param) => param.key === "team")?.encoding).toBe("repeat");
  });
});

describe("verifySearch", () => {
  beforeEach(() => vi.clearAllMocks());

  const links = (ids: number[], extra = "") =>
    ids.map((id) => `<a href="/jobs/${id}">Role ${id}</a>`).join("") + extra;
  const baselineHtml = links([1, 2, 3]).replace("Role 1", "Senior Engineer");
  const candidates = search.params.filter((param) => ["q", "city", "team"].includes(param.key));

  function loader(pages: Record<string, string>) {
    const seen: string[] = [];
    return {
      seen,
      load: vi.fn(async (url: string) => {
        seen.push(url);
        const html = pages[url];
        return html === undefined ? null : { html, url };
      }),
    };
  }
  const input = (load: ReturnType<typeof loader>["load"], maxLoads = 8) => ({
    recipe,
    listingUrl: listing,
    baseline: { html: baselineHtml, url: listing },
    candidates,
    render: false,
    load,
    maxLoads,
  });

  it("keeps controls that change the listing, drops ones the site ignores, and verifies paging", async () => {
    const pageTwo = `${listing}?q=engineer&page=2`;
    const pages: Record<string, string> = {
      // A keyword narrows the list; page two keeps the keyword and shows new postings.
      [`${listing}?q=engineer`]: links([10, 11], `<a href="${pageTwo}">Next</a>`),
      [pageTwo]: links([12]),
      // The city control is silently ignored: same postings as the baseline.
      [`${listing}?city=nyc`]: links([1, 2, 3]),
    };
    const { load } = loader(pages);
    const result = await verifySearch(input(load));
    expect(result?.params.map((param) => param.key)).toEqual(["q"]);
    expect(result?.pagination).toEqual({ kind: "query", param: "page", start: 1, step: 1 });
    expect(result?.maxPages).toBe(5);
    expect(result?.url).toBe(listing);
  });

  it("falls back to no pagination when page two shows nothing new", async () => {
    const { load } = loader({
      [`${listing}?q=engineer`]: links([10], `<a href="${listing}?q=engineer&page=2">Next</a>`),
      [`${listing}?q=engineer&page=2`]: links([10]),
    });
    const result = await verifySearch(input(load));
    expect(result?.pagination).toEqual({ kind: "none" });
    expect(result?.maxPages).toBe(1);
  });

  it("returns null when nothing changes the listing or the baseline has no postings", async () => {
    const same = loader({});
    expect(await verifySearch(input(same.load))).toBeNull();
    expect(
      await verifySearch({ ...input(same.load), baseline: { html: "<p>none</p>", url: listing } }),
    ).toBeNull();
    // A filter that returns zero postings proves nothing either.
    const empty = loader({ [`${listing}?q=engineer`]: "<p>No results</p>" });
    expect(await verifySearch({ ...input(empty.load), candidates: [candidates[0]] })).toBeNull();
  });

  it("stays within its load budget", async () => {
    const { load } = loader({});
    await verifySearch(input(load, 2));
    expect(load.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("facetParamsFromSearch", () => {
  it("turns text controls into free-text keys and keeps only repeatable keys multi", () => {
    expect(facetParamsFromSearch(search)).toEqual([
      { key: "q", role: "keyword", multi: false, freeText: true },
      { key: "city", role: "location", multi: false, values: [{ value: "tor" }, { value: "nyc" }] },
      {
        key: "team",
        role: "department",
        multi: true,
        values: [{ value: "eng" }, { value: "ops" }, { value: "design" }],
      },
      { key: "level", role: "level", multi: false, values: [{ value: "a" }, { value: "b" }] },
    ]);
  });
});

describe("discovered controls carry a role", () => {
  it("labels a board's own parameter names with the shared roles", () => {
    const html = `<form method="get">
      <input type="search" name="fwp_search">
      <select name="offices"><option value="a">A</option><option value="b">B</option></select>
      <select name="commitment" multiple><option value="ft">Full</option><option value="pt">Part</option></select>
      <select name="degree"><option value="x">X</option><option value="y">Y</option></select>
    </form>`;
    const roles = Object.fromEntries(
      discoverSearchParams(html, listing).map((param) => [param.key, param.role]),
    );
    expect(roles).toEqual({
      fwp_search: "keyword",
      offices: "location",
      commitment: "employmentType",
      degree: undefined,
    });
  });
});

describe("buildSearchUrl carry-over", () => {
  it("keeps non-control parameters of the user's URL, including repeated ones", () => {
    const url = new URL(
      buildSearchUrl(search, { q: ["nurse"] }, `${listing}?team2=a&team2=b&q=old&page=3&lang=fr`),
    );
    expect(url.searchParams.getAll("team2")).toEqual(["a", "b"]);
    expect(url.searchParams.get("q")).toBe("nurse");
    // The learned fixed parameter wins over the user's copy; the pager is reset, never carried.
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.has("page")).toBe(false);
  });
});
