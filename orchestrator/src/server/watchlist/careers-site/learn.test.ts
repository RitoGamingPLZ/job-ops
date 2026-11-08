import { logger } from "@infra/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedByRobots, loadPage } from "./fetch";
import { learnRecipe } from "./learn";
import { runRecipe } from "./run-recipe";
import { type Recipe, SiteBlockedError } from "./types";

const { callJson } = vi.hoisted(() => ({ callJson: vi.fn() }));
vi.mock("./fetch", () => ({ loadPage: vi.fn(), isAllowedByRobots: vi.fn() }));
vi.mock("./run-recipe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-recipe")>()),
  runRecipe: vi.fn(),
}));
vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "test-model"),
}));

const root = "https://careers.example.com";
const careers = `${root}/careers`;
const jobUrl = `${root}/jobs/engineer-123`;
const jobHtml =
  '<main class="job"><h1>Engineer</h1><article class="description">Build things</article></main>';
const jsonld =
  '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer","description":"Build things"}]}</script>';
const learned: Recipe = {
  version: 1,
  jobUrlPattern: "/jobs/[^/]+$",
  listing: {
    kind: "page",
    url: careers,
    render: true,
    pagination: { kind: "none" },
    maxPages: 1,
  },
  detail: {
    kind: "selectors",
    render: false,
    title: "h1",
    description: "article.description",
  },
};
const job = {
  id: "123",
  url: jobUrl,
  title: "Engineer",
  employer: null,
  location: null,
  postedAt: null,
  descriptionHtml: "Build things",
};
let pages: Record<string, string>;

beforeEach(() => {
  vi.resetAllMocks();
  pages = {
    [careers]: `<a href="/jobs/engineer-123">Engineer</a><a href="/about">About</a>`,
    [jobUrl]: jobHtml,
  };
  vi.mocked(isAllowedByRobots).mockResolvedValue(true);
  vi.mocked(loadPage).mockImplementation(async (url) => ({
    url,
    status: url in pages ? 200 : 404,
    html: pages[url] || "missing",
  }));
  vi.mocked(runRecipe).mockResolvedValue([job]);
  callJson.mockResolvedValue({ success: true, data: learned });
});

describe("learnRecipe", () => {
  it.each([
    1, 2, 20,
  ])("reuses sitemap evidence only when coverage is clearly larger: %i jobs", async (count) => {
    const urls = Array.from(
      { length: count },
      (_, i) => `${root}/jobs/engineer-${123 + i}`,
    );
    pages[`${root}/sitemap.xml`] = `<urlset>${[
      ...urls,
      ...urls,
      "https://foreign.example/jobs/engineer-999",
      `${root}/jobs/${"x".repeat(500)}`,
    ]
      .map((url) => `<url><loc>${url}</loc></url>`)
      .join("")}</urlset>`;
    const result = await learnRecipe(careers, {});
    expect(result.listing).toEqual(
      count >= 2
        ? { kind: "sitemap", url: `${root}/sitemap.xml` }
        : learned.listing,
    );
    expect(result.detail).toEqual(learned.detail);
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(loadPage)
        .mock.calls.filter(([url]) => url === `${root}/sitemap.xml`),
    ).toHaveLength(1);
    expect(runRecipe).toHaveBeenLastCalledWith(result, {
      limit: 3,
      signal: expect.any(AbortSignal),
      bypassCache: true,
    });
  });

  it.each([
    0, 1, 2,
  ])("requires majority listing overlap before promoting a sitemap: %i matches", async (overlap) => {
    const current = [
      jobUrl,
      `${root}/jobs/current-456`,
      `${root}/jobs/current-789`,
    ];
    pages[careers] =
      `${current.map((url) => `<a href="${url}">Job</a>`).join("")}<a href="/about">About</a>`;
    const urls = [
      ...current.slice(0, overlap),
      ...Array.from({ length: 40 }, (_, i) => `${root}/jobs/archive-${i}`),
    ];
    pages[`${root}/sitemap.xml`] =
      `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
    const result = await learnRecipe(careers, {});
    expect(result.listing).toEqual(
      overlap >= 2
        ? { kind: "sitemap", url: `${root}/sitemap.xml` }
        : learned.listing,
    );
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("ignores overlong links when rejecting a pattern that matches every listing link", async () => {
    pages[careers] = [
      jobUrl,
      `${root}/jobs/current-456`,
      `${root}/jobs/current-789`,
      `${root}/${"x".repeat(501)}`,
    ]
      .map((url) => `<a href="${url}">Job</a>`)
      .join("");
    callJson.mockResolvedValue({
      success: true,
      data: { ...learned, jobUrlPattern: "/jobs/" },
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "does not distinguish job URLs",
    );
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it.each([
    "page",
    "_paged",
    "offset",
    "skip",
  ])("preserves %s pagination evidence beyond the job-link limit and verifies new jobs", async (param) => {
    pages[careers] +=
      Array.from(
        { length: 120 },
        (_, i) => `<a href="/jobs/role-${i + 1000}">Role</a>`,
      ).join("") +
      `<a href="?${param}=2">Next</a><a href="?filter=other&${param}=3">Other filter</a>`;
    const base = careers;
    pages[base] = pages[careers];
    pages[`${base}?${param}=1`] = pages[careers];
    pages[`${base}?${param}=2`] = '<a href="/jobs/new-999">New</a>';
    const recipe: Recipe = {
      ...learned,
      listing: {
        kind: "page",
        url: base,
        render: false,
        pagination: { kind: "query", param, start: 1, step: 1 },
        maxPages: 5,
      },
    };
    callJson.mockResolvedValue({ success: true, data: recipe });
    expect((await learnRecipe(base, {})).listing).toEqual(recipe.listing);
    const evidence = JSON.parse(callJson.mock.calls[0][0].messages[1].content);
    expect(evidence.paginationLinks).toEqual([
      { url: `${base}?${param}=2`, text: "Next" },
    ]);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    "duplicate",
    "missing",
    "disallowed",
  ])("falls back without an LLM retry for %s page two", async (mode) => {
    pages[`${careers}?page=1`] = pages[careers];
    if (mode === "duplicate") pages[`${careers}?page=2`] = pages[careers];
    if (mode === "disallowed")
      vi.mocked(isAllowedByRobots).mockImplementation(
        async (url) => !url.endsWith("?page=2"),
      );
    callJson.mockResolvedValue({
      success: true,
      data: {
        ...learned,
        listing: {
          kind: "page",
          url: careers,
          render: false,
          pagination: { kind: "query", param: "page", start: 1, step: 1 },
          maxPages: 5,
        },
      },
    });
    expect((await learnRecipe(careers, {})).listing).toMatchObject({
      pagination: { kind: "none" },
      maxPages: 1,
    });
    expect(callJson).toHaveBeenCalledTimes(1);
    if (mode === "disallowed")
      expect(loadPage).not.toHaveBeenCalledWith(
        `${careers}?page=2`,
        expect.anything(),
      );
  });

  it.each([
    true,
    false,
  ])("overrides detail rendering only when both static selectors contain text: %s", async (complete) => {
    pages[jobUrl] = complete
      ? jobHtml
      : "<main><h1>Engineer</h1><article class=description></article></main>";
    callJson.mockResolvedValue({
      success: true,
      data: {
        ...learned,
        detail: {
          ...learned.detail,
          render: true,
        },
      },
    });
    expect((await learnRecipe(careers, {})).detail).toMatchObject({
      render: !complete,
    });
  });

  it("rejects verified URLs over 500 chars before executing the learned regex", async () => {
    vi.mocked(runRecipe).mockResolvedValue([
      { ...job, url: `${root}/jobs/${"x".repeat(500)}` },
    ]);
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "outside its job pattern",
    );
  });

  it.each([
    "engineer-123",
    "senior-software-engineer",
  ])("prefers a deeper job-like sample over header links: %s", async (slug) => {
    const base = `${root}/jobs/search`;
    const detail = `${root}/jobs/search/${slug}`;
    pages[base] =
      `<a href="/jobs">Jobs</a><a href="/about">About</a><a href="${detail}">Engineer</a>`;
    pages[`${root}/jobs`] = "<h1>Navigation</h1>";
    pages[detail] = jobHtml;
    const recipe = { ...learned, jobUrlPattern: `/jobs/search/${slug}$` };
    callJson.mockResolvedValue({ success: true, data: recipe });
    vi.mocked(runRecipe).mockResolvedValue([{ ...job, url: detail }]);
    await expect(learnRecipe(base, {})).resolves.toEqual(recipe);
    expect(
      JSON.parse(callJson.mock.calls[0][0].messages[1].content).jobPageUrl,
    ).toBe(detail);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ".*",
    "/(?:jobs|about)/?[^/]*$",
    "/jobs/other-999$",
  ])("rejects an indiscriminate or sample-mismatched URL pattern: %s", async (jobUrlPattern) => {
    pages[careers] += '<a href="/jobs/designer-456">Designer</a>';
    callJson.mockResolvedValue({
      success: true,
      data: { ...learned, jobUrlPattern },
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "does not distinguish job URLs",
    );
    expect(callJson).toHaveBeenCalledTimes(2);
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it.each([
    50, 120,
  ])("accepts a job pattern among %i job links and navigation", async (count) => {
    pages[careers] = [
      ...Array.from(
        { length: count },
        (_, i) => `<a href="/jobs/engineer-${123 + i}">Engineer</a>`,
      ),
      ...Array.from(
        { length: 10 },
        (_, i) => `<a href="/navigation/${i}">Navigation</a>`,
      ),
    ].join("");
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("rejects a pattern matching the host root even with few observed matches", async () => {
    const jobUrlPattern = "^https://careers\\.example\\.com/$|/jobs/[^/]+$";
    pages[careers] += Array.from(
      { length: 10 },
      (_, i) => `<a href="/navigation/${i}">Navigation</a>`,
    ).join("");
    callJson.mockResolvedValue({
      success: true,
      data: { ...learned, jobUrlPattern },
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "does not distinguish job URLs",
    );
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("allows a pattern matching fewer than three deduplicated links", async () => {
    pages[careers] = `<a href="${jobUrl}">Engineer</a>`.repeat(4);
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
  });

  it.each([
    "^https://x\\.com/.*.*.*.*.*.*!$",
    "\\d+\\d+\\d+\\d+x",
    "a{1,}b{2,}c{3,}d{4,}",
  ])("rejects more than three unbounded quantifiers: %s", async (pattern) => {
    for (const field of ["jobUrlPattern", "jobIdPattern"]) {
      callJson.mockResolvedValue({
        success: true,
        data: { ...learned, [field]: pattern },
      });
      await expect(learnRecipe(careers, {})).rejects.toThrow(
        "unsafe regular expression",
      );
      expect(runRecipe).not.toHaveBeenCalled();
    }
  });

  it.each([
    "^https://stripe\\.com/jobs/listing/[^/]+/\\d+/?$",
    "^https://stripe\\.com/jobs/listing/[^*+]+/\\d+/?$(?:\\*\\+\\*\\+)?",
  ])("accepts a normal job pattern without counting classes or escapes: %s", async (jobUrlPattern) => {
    const base = "https://stripe.com/jobs/listing";
    const detail = `${base}/engineer/123`;
    pages[base] = `<a href="${detail}">Engineer</a><a href="/about">About</a>`;
    pages[detail] = jobHtml;
    const recipe = {
      ...learned,
      listing: { ...learned.listing, url: base },
      jobUrlPattern,
    };
    callJson.mockResolvedValue({ success: true, data: recipe });
    vi.mocked(runRecipe).mockResolvedValue([{ ...job, url: detail }]);
    await expect(learnRecipe(base, {})).resolves.toEqual(recipe);
  });

  it("rejects verified jobs outside the compiled pattern", async () => {
    vi.mocked(runRecipe).mockResolvedValue([{ ...job, url: `${root}/about` }]);
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "outside its job pattern",
    );
    expect(callJson).toHaveBeenCalledTimes(2);
  });

  it.each([
    "(a+)+$",
    "(.*)*x",
    "(?:a{2,3})+$",
    "(a|aa)+$",
    "((a+))+$",
    "[a-z]".repeat(101),
  ])("rejects unsafe regexes before execution: %s", async (pattern) => {
    for (const field of ["jobUrlPattern", "jobIdPattern"]) {
      callJson.mockClear();
      callJson.mockResolvedValue({
        success: true,
        data: { ...learned, [field]: pattern },
      });
      await expect(learnRecipe(careers, {})).rejects.toThrow();
      expect(callJson).toHaveBeenCalledTimes(2);
      expect(runRecipe).not.toHaveBeenCalled();
    }
  });

  it("uses the existing retry after rejecting an unsafe regex", async () => {
    callJson.mockResolvedValueOnce({
      success: true,
      data: { ...learned, jobIdPattern: "(a+)+$" },
    });
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(2);
    expect(callJson.mock.calls[1][0].messages[1].content).toContain(
      "unsafe regular expression",
    );
    expect(runRecipe).toHaveBeenCalledTimes(1);
  });

  it.each([
    "engineer-\\d+",
    "(?:engineer-\\d+)",
    "",
  ])("requires a capture group in a supplied jobIdPattern: %s", async (jobIdPattern) => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    callJson.mockResolvedValue({
      success: true,
      data: { ...learned, jobIdPattern },
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "Missing job ID capture group",
    );
    expect(warn).toHaveBeenCalledWith(
      "Careers recipe rejected",
      expect.objectContaining({ reason: "Missing job ID capture group" }),
    );
    warn.mockRestore();
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("accepts safe grouped and escaped regexes with an ID capture", async () => {
    const recipe = {
      ...learned,
      jobUrlPattern: "/jobs/(?:engineer)-[0-9]+/?$",
      jobIdPattern: "engineer-(\\d+)",
    };
    callJson.mockResolvedValue({ success: true, data: recipe });
    await expect(learnRecipe(careers, {})).resolves.toEqual(recipe);
  });

  it("anchors tier-0 patterns to detail paths with an optional trailing slash", async () => {
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    const re = new RegExp((await learnRecipe(careers, {})).jobUrlPattern);
    expect(re.test(jobUrl)).toBe(true);
    expect(re.test(`${jobUrl}/`)).toBe(true);
    expect(re.test(`${jobUrl}/apply`)).toBe(false);
    expect(re.test(`${jobUrl}/share`)).toBe(false);
  });

  it("skips tier-0 candidates whose prefix collapses to the host root", async () => {
    const shallow = `${root}/job-123`;
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${shallow}</loc></url></urlset>`;
    pages[shallow] = jsonld;
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(runRecipe).toHaveBeenCalledTimes(1);
  });

  it("deduplicates tier-0 patterns and falls through to tier 1 after failed verification", async () => {
    const other = `${root}/jobs/designer-456`;
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${jobUrl}</loc></url><url><loc>${other}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    pages[other] = jsonld;
    vi.mocked(runRecipe).mockResolvedValueOnce([]);
    await expect(learnRecipe(careers, {})).resolves.toEqual({
      ...learned,
      listing: { kind: "sitemap", url: `${root}/sitemap.xml` },
    });
    expect(runRecipe).toHaveBeenCalledTimes(2);
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadPage).mock.calls.some(([url]) => url === other)).toBe(
      false,
    );
  });

  it("rejects tier-0 verification results outside the job pattern", async () => {
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    vi.mocked(runRecipe).mockResolvedValueOnce([
      { ...job, url: `${root}/about` },
    ]);
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(runRecipe).toHaveBeenCalledTimes(2);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("treats a robots check exception as a per-page failure", async () => {
    vi.mocked(isAllowedByRobots).mockImplementation(async (url) => {
      if (url.endsWith("sitemap.xml")) throw new Error("DNS unavailable");
      return true;
    });
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("drops off-host final page URLs", async () => {
    vi.mocked(loadPage).mockImplementation(async (url) => ({
      url: url.endsWith("sitemap.xml")
        ? "https://external.example/jobs.xml"
        : url,
      status: 200,
      html: url.endsWith("sitemap.xml")
        ? `<urlset><url><loc>${jobUrl}</loc></url></urlset>`
        : pages[url] || "",
    }));
    pages[jobUrl] = jsonld;
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("surfaces missing LLM configuration without retrying", async () => {
    callJson.mockResolvedValue({
      success: false,
      error: "LLM API key not configured",
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "LLM API key not configured",
    );
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("discovers an advertised own-host nested sitemap and verifies JSON-LD without LLM or browser", async () => {
    pages[`${root}/robots.txt`] =
      `Sitemap: ${root}/index.xml\nSitemap: https://external.example/jobs.xml`;
    pages[`${root}/index.xml`] =
      `<sitemapindex><sitemap><loc>${root}/jobs.xml</loc></sitemap></sitemapindex>`;
    pages[`${root}/jobs.xml`] =
      `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    const recipe = await learnRecipe(careers, {});
    expect(recipe.listing).toEqual({
      kind: "sitemap",
      url: `${root}/jobs.xml`,
    });
    expect(new RegExp(recipe.jobUrlPattern).test(jobUrl)).toBe(true);
    expect(recipe.detail).toEqual({ kind: "jsonld" });
    expect(runRecipe).toHaveBeenCalledWith(recipe, {
      limit: 3,
      signal: expect.any(AbortSignal),
      bypassCache: true,
    });
    expect(callJson).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(loadPage)
        .mock.calls.every(
          ([url, options]) =>
            new URL(url).host === new URL(root).host && !options.render,
        ),
    ).toBe(true);
  });

  it.each([
    "/jp/sitemap.xml",
    "/de/sitemap.xml",
  ])("tries the root sitemap before a localized advertised one: %s", async (localized) => {
    pages[`${root}/robots.txt`] = `Sitemap: ${root}${localized}`;
    pages[`${root}${localized}`] =
      `<urlset><url><loc>${root}/jp/careers/engineer-123</loc></url></urlset>`;
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    const recipe = await learnRecipe(careers, {});
    expect(recipe.listing.url).toBe(`${root}/sitemap.xml`);
    expect(loadPage).not.toHaveBeenCalledWith(
      `${root}${localized}`,
      expect.anything(),
    );
    expect(callJson).not.toHaveBeenCalled();
  });

  it.each([
    "/jobs.xml",
    "/en/jobs.xml",
  ])("prefers a global or English job sitemap in an index: %s", async (preferred) => {
    pages[`${root}/robots.txt`] = `Sitemap: ${root}/index.xml`;
    pages[`${root}/index.xml`] =
      `<sitemapindex>${["/jp/jobs.xml", "/de/jobs.xml", preferred].map((path) => `<sitemap><loc>${root}${path}</loc></sitemap>`).join("")}</sitemapindex>`;
    pages[`${root}${preferred}`] =
      `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    const recipe = await learnRecipe(careers, {});
    expect(recipe.listing.url).toBe(`${root}${preferred}`);
    expect(callJson).not.toHaveBeenCalled();
  });

  it("does not spend tier-0 samples on customer slugs containing job", async () => {
    const customer = `${root}/customers/jobber-customer-story`;
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${customer}</loc></url><url><loc>${careers}</loc></url></urlset>`;
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(loadPage).not.toHaveBeenCalledWith(customer, expect.anything());
    expect(
      vi
        .mocked(loadPage)
        .mock.calls.filter(
          ([url, options]) => url === careers && !options.render,
        ),
    ).toHaveLength(1);
  });

  it("renders dynamic evidence when static listing and detail are shells", async () => {
    vi.mocked(loadPage).mockImplementation(async (url, options) => ({
      url,
      status: url in pages ? 200 : 404,
      html: options.render ? pages[url] || "missing" : "<div id=app></div>",
    }));
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    const evidence = JSON.parse(callJson.mock.calls[0][0].messages[1].content);
    expect(evidence.listingRendered).toBe(true);
    expect(evidence.detailRendered).toBe(true);
  });

  it("reserves page two after a full tier-0 budget and rendered listing/detail evidence", async () => {
    const children = Array.from(
      { length: 8 },
      (_, i) => `${root}/map-${i}.xml`,
    );
    pages[`${root}/sitemap.xml`] =
      `<sitemapindex>${children.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;
    for (const url of children) pages[url] = "<urlset/>";
    vi.mocked(loadPage).mockImplementation(async (url, options) => ({
      url,
      status: url in pages ? 200 : 404,
      html:
        (url === careers || url === jobUrl) && !options.render
          ? "<div id=app></div>"
          : pages[url] || "missing",
    }));
    pages[careers] += '<a href="?page=2">Next</a>';
    pages[`${careers}?page=2`] = '<a href="/jobs/new-999">New</a>';
    const paginated: Recipe = {
      ...learned,
      listing: {
        kind: "page",
        url: careers,
        render: true,
        pagination: { kind: "query", param: "page", start: 1, step: 1 },
        maxPages: 5,
      },
    };
    callJson.mockResolvedValue({ success: true, data: paginated });
    await expect(learnRecipe(careers, {})).resolves.toEqual(paginated);
    expect(loadPage).not.toHaveBeenCalledWith(
      `${careers}?page=1`,
      expect.anything(),
    );
    expect(loadPage).toHaveBeenCalledWith(
      `${careers}?page=2`,
      expect.objectContaining({ render: true }),
    );
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledTimes(12);
    expect(loadPage).toHaveBeenCalledWith(
      jobUrl,
      expect.objectContaining({ render: true }),
    );
    expect(
      JSON.parse(callJson.mock.calls[0][0].messages[1].content),
    ).toMatchObject({
      listingRendered: true,
      detailRendered: true,
    });
  });

  it("stops tier-0 detail reads before spending the render headroom", async () => {
    const children = Array.from(
      { length: 8 },
      (_, i) => `${root}/map-${i}.xml`,
    );
    pages[`${root}/sitemap.xml`] =
      `<sitemapindex>${children.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;
    for (const url of children) pages[url] = "<urlset/>";
    pages[children[5]] =
      `<urlset><url><loc>${root}/jobs/design/456</loc></url><url><loc>${root}/jobs/development/789</loc></url></urlset>`;
    vi.mocked(loadPage).mockImplementation(async (url, options) => ({
      url,
      status: url in pages ? 200 : 404,
      html:
        (url === careers || url === jobUrl) && !options.render
          ? "<div id=app></div>"
          : pages[url] || "missing",
    }));
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(loadPage).toHaveBeenCalledTimes(11);
    expect(loadPage).not.toHaveBeenCalledWith(
      `${root}/jobs/design/456`,
      expect.anything(),
    );
    expect(loadPage).not.toHaveBeenCalledWith(
      `${root}/jobs/development/789`,
      expect.anything(),
    );
  });

  it("keeps static listing HTML when its render fails", async () => {
    pages[careers] =
      '<a href="/opportunity">Engineer</a><a href="/about">About</a>';
    pages[`${root}/opportunity`] = jobHtml;
    vi.mocked(loadPage).mockImplementation(async (url, options) => {
      if (url === careers && options.render) throw new Error("render failed");
      return {
        url,
        status: url in pages ? 200 : 404,
        html: pages[url] || "missing",
      };
    });
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(
      JSON.parse(callJson.mock.calls[0][0].messages[1].content).jobPageUrl,
    ).toBe(`${root}/opportunity`);
  });

  it("keeps static detail HTML when its render fails", async () => {
    pages[jobUrl] = "<h1>Engineer</h1><p>Build things</p>";
    vi.mocked(loadPage).mockImplementation(async (url, options) => {
      if (url === jobUrl && options.render)
        return { url, status: 503, html: "unavailable" };
      return {
        url,
        status: url in pages ? 200 : 404,
        html: pages[url] || "missing",
      };
    });
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson.mock.calls[0][0].messages[1].content).toContain(
      "Build things",
    );
  });

  it("uses a listing job instead of a sitemap culture page without JobPosting", async () => {
    const culture = `${root}/careers/life-at-acme-engineering`;
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${culture}</loc></url></urlset>`;
    pages[culture] = "<main><h1>Life at Acme</h1><p>Our culture</p></main>";
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(
      JSON.parse(callJson.mock.calls[0][0].messages[1].content).jobPageUrl,
    ).toBe(jobUrl);
  });

  it("sorts sitemap children by job path segments despite a careers hostname", async () => {
    const preferred = `${root}/jobs/sitemap.xml`;
    pages[`${root}/sitemap.xml`] =
      `<sitemapindex>${[...Array.from({ length: 8 }, (_, i) => `${root}/misc-${i}.xml`), preferred].map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;
    pages[preferred] = `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] = jsonld;
    const recipe = await learnRecipe(careers, {});
    expect(recipe.listing.url).toBe(preferred);
    expect(callJson).not.toHaveBeenCalled();
  });

  it("sorts listing links by job path segments despite a careers hostname", async () => {
    pages[careers] = '<a href="/about">About</a><a href="/jobs">Jobs</a>';
    pages[`${root}/about`] = "<main><h1>About us</h1></main>";
    pages[`${root}/jobs`] = jobHtml;
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(
      JSON.parse(callJson.mock.calls[0][0].messages[1].content).jobPageUrl,
    ).toBe(`${root}/jobs`);
  });

  it("uses a Gemini-compatible version schema while enforcing version 1 locally", async () => {
    await learnRecipe(careers, {});
    expect(
      callJson.mock.calls[0][0].jsonSchema.schema.properties.version,
    ).toEqual({ type: "integer" });
    callJson.mockResolvedValue({
      success: true,
      data: { ...learned, version: 2 },
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "schema validation (version)",
    );
  });

  it("logs fixed rejection reasons without reflecting provider messages or invalid values", async () => {
    callJson.mockResolvedValue({
      success: false,
      error: "LLM API error: 400 - secret-token page body",
    });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "LLM request failed (HTTP 400)",
    );
    expect(callJson.mock.calls[1][0].messages[1].content).toContain("HTTP 400");
    expect(callJson.mock.calls[1][0].messages[1].content).not.toContain(
      "secret-token",
    );
  });

  it("recognizes microdata in a default sitemap", async () => {
    pages[`${root}/sitemap.xml`] =
      `<urlset><url><loc>${jobUrl}</loc></url></urlset>`;
    pages[jobUrl] =
      '<div itemscope itemtype="https://schema.org/JobPosting"><h1>Engineer</h1></div>';
    expect((await learnRecipe(careers, {})).detail.kind).toBe("jsonld");
    expect(callJson).not.toHaveBeenCalled();
  });

  it("uses static evidence, requests a schema, and verifies a learned recipe", async () => {
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(loadPage).toHaveBeenCalledWith(careers, {
      render: false,
      signal: expect.any(AbortSignal),
    });
    const request = callJson.mock.calls[0][0];
    expect(request.jsonSchema.schema.required).toContain("detail");
    expect(request.messages[1].content).toContain(jobUrl);
    expect(request.messages[1].content).toContain("article.description");
    expect(request.messages[1].content.length).toBeLessThan(60_000);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(runRecipe).toHaveBeenCalledWith(learned, {
      limit: 3,
      signal: expect.any(AbortSignal),
      bypassCache: true,
    });
  });

  it("retries once with a concrete empty-run error", async () => {
    vi.mocked(runRecipe).mockResolvedValueOnce([]).mockResolvedValueOnce([job]);
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(2);
    expect(callJson.mock.calls[1][0].messages[1].content).toContain(
      "Recipe found no jobs",
    );
  });

  it("rejects invalid schema output after exactly two attempts", async () => {
    callJson.mockResolvedValue({ success: true, data: { version: 9 } });
    await expect(learnRecipe(careers, {})).rejects.toThrow("schema validation");
    expect(callJson).toHaveBeenCalledTimes(2);
    expect(runRecipe).not.toHaveBeenCalled();
  });

  it("rejects external listings and invalid regex before executing them", async () => {
    callJson
      .mockResolvedValueOnce({
        success: true,
        data: {
          ...learned,
          listing: { ...learned.listing, url: "https://evil.example/jobs" },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { ...learned, jobUrlPattern: "[" },
      });
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "invalid regular expression",
    );
    expect(runRecipe).not.toHaveBeenCalled();
    expect(callJson.mock.calls[1][0].messages[1].content).toContain(
      "same HTTPS host",
    );
  });

  it("never reflects raw provider or execution errors", async () => {
    callJson.mockResolvedValueOnce({
      success: false,
      error: "secret-token provider body",
    });
    vi.mocked(runRecipe).mockRejectedValue(
      new Error("secret-token upstream body"),
    );
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "verification failed during execution",
    );
    expect(callJson.mock.calls[1][0].messages[1].content).not.toContain(
      "secret-token",
    );
  });

  it("retries a thrown provider failure without exposing its payload", async () => {
    callJson.mockRejectedValueOnce(new Error("secret-provider-body"));
    await expect(learnRecipe(careers, {})).resolves.toEqual(learned);
    expect(callJson).toHaveBeenCalledTimes(2);
    expect(callJson.mock.calls[1][0].messages[1].content).not.toContain(
      "secret-provider-body",
    );
  });

  it("stops immediately on robots denial or a blocked page", async () => {
    vi.mocked(isAllowedByRobots).mockResolvedValueOnce(false);
    await expect(learnRecipe(careers, {})).rejects.toBeInstanceOf(
      SiteBlockedError,
    );
    expect(loadPage).not.toHaveBeenCalled();
    vi.mocked(loadPage).mockRejectedValueOnce(
      new SiteBlockedError(new URL(root).hostname, "403"),
    );
    await expect(learnRecipe(careers, {})).rejects.toBeInstanceOf(
      SiteBlockedError,
    );
    expect(callJson).not.toHaveBeenCalled();
  });

  it("skips disallowed sitemap and job pages", async () => {
    vi.mocked(isAllowedByRobots).mockImplementation(
      async (url) => !url.endsWith("sitemap.xml") && url !== jobUrl,
    );
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "No allowed job page",
    );
    expect(
      vi
        .mocked(loadPage)
        .mock.calls.some(
          ([url]) => url.endsWith("sitemap.xml") || url === jobUrl,
        ),
    ).toBe(false);
    expect(callJson).not.toHaveBeenCalled();
  });

  it("tolerates malformed sitemap responses and bounds evidence", async () => {
    pages[`${root}/sitemap.xml`] = "<html>not xml";
    pages[careers] =
      `<a href="/about">About</a><script>do not send me</script>${'<a href="/jobs/engineer-123">Engineer</a>'.repeat(3000)}`;
    pages[jobUrl] =
      `${jobHtml}<script>private script</script><form>private form</form>${'<p class="long">example</p>'.repeat(3000)}`;
    await learnRecipe(careers, {});
    const prompt = callJson.mock.calls[0][0].messages[1].content;
    expect(prompt.length).toBeLessThan(60_000);
    expect(prompt).not.toContain("private script");
    expect(prompt).not.toContain("private form");
    expect(vi.mocked(loadPage).mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("never returns a recipe that still finds no jobs after the retry", async () => {
    vi.mocked(runRecipe).mockResolvedValue([]);
    await expect(learnRecipe(careers, {})).rejects.toThrow(
      "Recipe found no jobs",
    );
    expect(callJson).toHaveBeenCalledTimes(2);
  });

  it("propagates blocking during verification without an LLM retry", async () => {
    vi.mocked(runRecipe).mockRejectedValue(
      new SiteBlockedError(new URL(root).hostname, "challenge"),
    );
    await expect(learnRecipe(careers, {})).rejects.toBeInstanceOf(
      SiteBlockedError,
    );
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("bounds sitemap traversal and does not follow external sitemap entries", async () => {
    pages[`${root}/sitemap.xml`] =
      `<sitemapindex><sitemap><loc>https://external.example/jobs.xml</loc></sitemap>${Array.from({ length: 30 }, (_, i) => `<sitemap><loc>${root}/jobs-${i}.xml</loc></sitemap>`).join("")}</sitemapindex>`;
    for (let i = 0; i < 30; i++)
      pages[`${root}/jobs-${i}.xml`] = pages[`${root}/sitemap.xml`];
    await learnRecipe(careers, {});
    expect(vi.mocked(loadPage).mock.calls.length).toBeLessThanOrEqual(12);
    expect(
      vi
        .mocked(loadPage)
        .mock.calls.every(([url]) => new URL(url).host === new URL(root).host),
    ).toBe(true);
    expect(callJson).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation and rejects non-HTTPS input before loading", async () => {
    await expect(
      learnRecipe(careers, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    await expect(learnRecipe("http://example.com/careers", {})).rejects.toThrow(
      "HTTPS",
    );
    expect(loadPage).not.toHaveBeenCalled();
  });
});

it("learns host recipes from a query-stripped listing even when first requested with filters", async () => {
  const result = await learnRecipe(
    `${careers}?department=engineering&utm_source=test`,
    {},
  );
  expect(result.listing.url).toBe(careers);
  expect(
    vi.mocked(loadPage).mock.calls.every(([url]) => !new URL(url).search),
  ).toBe(true);
  const evidence = JSON.parse(callJson.mock.calls[0][0].messages[1].content);
  expect(evidence.pageUrl).toBe(careers);
});
