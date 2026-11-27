import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedByRobots, loadPage } from "./fetch";
import type { Recipe } from "./types";

vi.mock("./fetch", () => ({ loadPage: vi.fn(), isAllowedByRobots: vi.fn() }));

const base = "https://careers.example.com";
const listing = `${base}/openings`;
const posting = (id: number, extra: Record<string, unknown> = {}) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: `Engineer ${id}`,
    description: "<p>Build things.</p>",
    ...extra,
  })}</script>`;
const recipe: Recipe = {
  version: 2,
  jobUrlPattern: "/jobs/\\d+$",
  jobIdPattern: "/jobs/(\\d+)$",
  listing: { kind: "sitemap", url: `${base}/sitemap.xml` },
  search: {
    url: listing,
    params: [{ key: "q", input: { kind: "text" }, encoding: "single" }],
    pagination: { kind: "query", param: "page", start: 1, step: 1 },
    maxPages: 3,
    render: true,
    waitFor: ".results",
  },
  detail: {
    kind: "jsonld",
    fields: {
      salary: { kind: "jobPosting", property: "baseSalary" },
      deadline: { kind: "jobPosting", property: "validThrough" },
      jobType: { kind: "jobPosting", property: "employmentType" },
    },
  },
};

function serve(values: Record<string, string>) {
  vi.mocked(loadPage).mockImplementation(async (url) => {
    const html = values[url];
    if (html === undefined) throw new Error(`Missing fixture ${url}`);
    return { url, status: 200, html };
  });
}

let runRecipe: typeof import("./run-recipe").runRecipe;
let extractJob: typeof import("./run-recipe").extractJob;
beforeEach(async () => {
  vi.resetModules();
  ({ runRecipe, extractJob } = await import("./run-recipe"));
  vi.resetAllMocks();
  vi.mocked(isAllowedByRobots).mockResolvedValue(true);
});

describe("extractJob optional fields", () => {
  const html = posting(1, {
    baseSalary: { currency: "USD", value: { minValue: 90000, maxValue: 110000, unitText: "YEAR" } },
    validThrough: "2026-12-31",
    employmentType: ["FULL_TIME"],
  });

  it("adds the fields a v2 recipe verified", () => {
    expect(extractJob(html, `${base}/jobs/1`, recipe)).toMatchObject({
      id: "1",
      title: "Engineer 1",
      salary: "USD 90,000–110,000 per year",
      deadline: "2026-12-31",
      jobType: "Full-time",
    });
  });

  it("keeps a posting that lacks every optional field, with blank values", () => {
    const job = extractJob(posting(2), `${base}/jobs/2`, recipe);
    expect(job).toMatchObject({ title: "Engineer 2", salary: null, deadline: null, jobType: null });
  });

  it("adds no extra keys for a v1 recipe", () => {
    const v1: Recipe = {
      version: 1,
      jobUrlPattern: recipe.jobUrlPattern,
      listing: recipe.listing,
      detail: { kind: "jsonld" },
    };
    const job = extractJob(html, `${base}/jobs/1`, v1);
    expect(job).not.toBeNull();
    expect(Object.keys(job as object)).not.toContain("salary");
  });
});

describe("runRecipe with a verified search", () => {
  const source = `${listing}?q=data`;
  const link = (id: number) => `<a href="/jobs/${id}">Job ${id}</a>`;

  it("uses the search's render settings and pager, keeping the filter on every page", async () => {
    serve({
      [source]: link(1) + link(2),
      [`${source}&page=2`]: link(2) + link(3),
      [`${source}&page=3`]: link(3),
      [`${base}/jobs/1`]: posting(1, { employmentType: "FULL_TIME" }),
      [`${base}/jobs/2`]: posting(2),
      [`${base}/jobs/3`]: posting(3),
    });
    const jobs = await runRecipe(recipe, { sourceUrl: source, limit: 10 });
    expect(jobs.map((job) => job.id).sort()).toEqual(["1", "2", "3"]);
    expect(jobs.find((job) => job.id === "1")?.jobType).toBe("Full-time");
    const listingLoads = vi
      .mocked(loadPage)
      .mock.calls.filter(([url]) => url.startsWith(listing))
      .map(([url, options]) => [url, options?.render, options?.waitFor]);
    expect(listingLoads).toEqual([
      [source, true, ".results"],
      [`${source}&page=2`, true, ".results"],
      [`${source}&page=3`, true, ".results"],
    ]);
  });

  it("stops at maxPages and when a page adds no new postings", async () => {
    serve({
      [source]: link(1),
      [`${source}&page=2`]: link(1),
      [`${base}/jobs/1`]: posting(1),
    });
    const jobs = await runRecipe(recipe, { sourceUrl: source, limit: 10 });
    expect(jobs.map((job) => job.id)).toEqual(["1"]);
    expect(loadPage).not.toHaveBeenCalledWith(`${source}&page=3`, expect.anything());
  });

  it("treats a legitimate empty search as zero jobs, not a failure", async () => {
    serve({ [source]: "<p>No openings match.</p>" });
    await expect(runRecipe(recipe, { sourceUrl: source, limit: 10 })).resolves.toEqual([]);
  });

  it("ignores the search for an unfiltered run and keeps sitemap discovery", async () => {
    serve({
      [`${base}/sitemap.xml`]: `<urlset><url><loc>${base}/jobs/5</loc></url></urlset>`,
      [`${base}/jobs/5`]: posting(5),
    });
    const jobs = await runRecipe(recipe, { limit: 10 });
    expect(jobs.map((job) => job.id)).toEqual(["5"]);
    expect(loadPage).not.toHaveBeenCalledWith(
      expect.stringContaining("openings"),
      expect.anything(),
    );
  });
});

describe("rendered JSON-LD details", () => {
  it("loads details in the browser with the recipe's wait selector", async () => {
    const rendered: Recipe = {
      ...recipe,
      detail: { kind: "jsonld", render: true, waitFor: "script[type='application/ld+json']" },
    };
    serve({
      [`${base}/sitemap.xml`]: `<urlset><url><loc>${base}/jobs/9</loc></url></urlset>`,
      [`${base}/jobs/9`]: posting(9),
    });
    const jobs = await runRecipe(rendered, { limit: 10 });
    expect(jobs.map((job) => job.id)).toEqual(["9"]);
    expect(loadPage).toHaveBeenCalledWith(
      `${base}/jobs/9`,
      expect.objectContaining({ render: true, waitFor: "script[type='application/ld+json']" }),
    );
  });
});

describe("filtered runs when the search has no verified pager", () => {
  const source = `${listing}?q=data`;
  const link = (id: number) => `<a href="/jobs/${id}">Job ${id}</a>`;
  const unverified: Recipe = {
    ...recipe,
    search: {
      url: listing,
      params: [{ key: "q", input: { kind: "text" }, encoding: "single" }],
      pagination: { kind: "none" },
      maxPages: 1,
      render: false,
    },
  };

  it("still detects the pager on page one and walks more than one page", async () => {
    serve({
      [source]: `<a href="${source}&_paged=2">2</a>${link(1)}`,
      [`${source}&_paged=2`]: `<a href="${source}&_paged=3">3</a>${link(2)}`,
      [`${source}&_paged=3`]: link(3),
      [`${base}/jobs/1`]: posting(1),
      [`${base}/jobs/2`]: posting(2),
      [`${base}/jobs/3`]: posting(3),
    });
    const jobs = await runRecipe(unverified, { sourceUrl: source, limit: 10 });
    expect(jobs.map((job) => job.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("ignores search settings for a source on another page of the host", async () => {
    const other = `${base}/careers/internships?q=data`;
    serve({
      [other]: link(7),
      [`${base}/jobs/7`]: posting(7),
    });
    await runRecipe(recipe, { sourceUrl: other, limit: 10 });
    // The search was learned for /openings with render=true; this page must not inherit that.
    expect(loadPage).toHaveBeenCalledWith(other, expect.objectContaining({ render: false }));
  });
});

describe("optional fields in JSON-LD text", () => {
  it("decodes character references like the title", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Engineer",
      description: "x",
      employmentType: "Full time &amp; flexible",
    })}</script>`;
    expect(extractJob(html, `${base}/jobs/1`, recipe)).toMatchObject({
      jobType: "Full time & flexible",
    });
  });
});
