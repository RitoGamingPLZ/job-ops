import { describe, expect, it } from "vitest";
import {
  jobPathPrefix,
  postingPattern,
  readListingHints,
  shouldRelearnUnderfitRecipe,
} from "./listing-quality";

const origin = "https://careers.example.com";

describe("jobPathPrefix", () => {
  it.each([
    // Each posting sits in a directory named after its id: the collection, not the parent, is shared.
    ["/us/en/job/SNC123ABC/Principal-Engineer", "/us/en/job/"],
    ["/job/oakland/staff-pm/27595/103752129792", "/job/"],
    ["/careers/openings/brand-marketing/san-francisco/producer/", "/careers/openings/"],
    ["/jobs/engineer-123", "/jobs/"],
    ["/en/vacancies/R-9/title", "/en/vacancies/"],
  ])("anchors %s on %s", (path, prefix) => {
    expect(jobPathPrefix(path)).toBe(prefix);
  });

  it("falls back to a generic careers segment only when nothing names the postings", () => {
    expect(jobPathPrefix("/careers/team/slug")).toBe("/careers/");
    expect(jobPathPrefix("/careers/jobs/slug")).toBe("/careers/jobs/");
  });

  it("returns null when no directory names the postings or the posting is at the root", () => {
    expect(jobPathPrefix("/job-123")).toBeNull();
    expect(jobPathPrefix("/en-us/apply/123")).toBeNull();
  });
});

describe("postingPattern", () => {
  const snowflake = Array.from(
    { length: 6 },
    (_, i) => `${origin}/us/en/job/SNC${i}EXTERNAL/Role-${i}`,
  );

  it("fits every posting of an id-per-directory board, not just the sample", () => {
    const pattern = new RegExp(postingPattern(origin, "/us/en/job/", snowflake[0], snowflake));
    expect(snowflake.every((url) => pattern.test(url))).toBe(true);
    expect(pattern.test(`${snowflake[0]}/`)).toBe(true);
    // Not a bare id (the board's own index of one posting) and not deeper sub-pages.
    expect(pattern.test(`${origin}/us/en/job/SNC1EXTERNAL`)).toBe(false);
    expect(pattern.test(`${snowflake[0]}/apply`)).toBe(false);
    expect(pattern.test(`${origin}/fr/fr/job/SNC1/Role`)).toBe(false);
  });

  it("keeps the single-segment form for flat boards", () => {
    const flat = [`${origin}/jobs/a-1`, `${origin}/jobs/b-2`];
    expect(postingPattern(origin, "/jobs/", flat[0], flat)).toBe(
      "^https://careers\\.example\\.com/jobs/[^/?#]+/?$",
    );
  });

  it("allows the depths that carry a real share of the sitemap and skips index pages", () => {
    const urls = [
      ...Array.from({ length: 6 }, (_, i) => `${origin}/careers/openings/d${i}/slug-${i}`),
      ...Array.from({ length: 5 }, (_, i) => `${origin}/careers/openings/d${i}/office/slug-${i}`),
      // Department index pages: one level, a small share.
      ...Array.from({ length: 2 }, (_, i) => `${origin}/careers/openings/dept-${i}`),
    ];
    const pattern = new RegExp(postingPattern(origin, "/careers/openings/", urls[0], urls));
    expect(pattern.test(urls[0])).toBe(true);
    expect(pattern.test(urls[7])).toBe(true);
    expect(pattern.test(urls[11])).toBe(false);
    expect(pattern.test(`${origin}/careers/openings/a/b/c/d`)).toBe(false);
  });

  it("always covers the sample's own depth", () => {
    const urls = [
      ...Array.from({ length: 10 }, (_, i) => `${origin}/jobs/slug-${i}`),
      `${origin}/jobs/team/slug`,
    ];
    const pattern = new RegExp(postingPattern(origin, "/jobs/", urls[10], urls));
    expect(pattern.test(urls[10])).toBe(true);
  });
});

describe("readListingHints", () => {
  const own = (url: string) => (new URL(url).origin === origin ? url : null);
  const read = (html: string, pageUrl = `${origin}/us/en`) => readListingHints(html, pageUrl, own);

  it("finds the page that really lists postings, preferring a path match", () => {
    const hints = read(`
      <a href="/us/en/about">About</a>
      <a href="/us/en/explore">Browse all jobs</a>
      <a href="/us/en/search-results">Join</a>
      <a href="https://elsewhere.example/search-results">Elsewhere</a>
      <a href="/us/en#top">Home</a>`);
    expect(hints.alternatives).toEqual([
      `${origin}/us/en/search-results`,
      `${origin}/us/en/explore`,
    ]);
  });

  it("ignores the current page and links with no listing sign", () => {
    expect(
      read(`<a href="/us/en/search-results">Search</a>`, `${origin}/us/en/search-results`),
    ).toEqual({ more: false, alternatives: [] });
  });

  it.each([
    '<a rel="next" href="?page=2">2</a>',
    "<link rel=next href='?page=2'>",
    "<button>Load more</button>",
    '<a href="?page=2">Next</a>',
    '<div role="button">Show more</div>',
    '<a href="?page=2">›</a>',
  ])("detects a control that reveals more postings: %s", (html) => {
    expect(read(html).more).toBe(true);
  });

  it("does not mistake ordinary copy for a pager", () => {
    expect(read("<a href='/x'>Learn more about benefits</a><button>Apply now</button>").more).toBe(
      false,
    );
  });
});

describe("shouldRelearnUnderfitRecipe", () => {
  const now = Date.parse("2026-11-28T04:00:00.000Z");
  const relearn = (learnedAt: string, postings: number) =>
    shouldRelearnUnderfitRecipe({ learnedAt, postings, now });

  it("relearns an old pre-gate recipe that sees too few postings", () => {
    expect(relearn("2026-11-28T02:21:00.000Z", 1)).toBe(true);
    expect(relearn("2026-11-07", 4)).toBe(true);
  });

  it("leaves a recipe alone once it returns enough postings", () => {
    expect(relearn("2026-11-28T02:21:00.000Z", 5)).toBe(false);
  });

  it("leaves a recipe learned after the gate alone, however few postings it returns", () => {
    expect(relearn("2026-11-28T03:16:00.000Z", 1)).toBe(false);
  });

  it("does not relearn a recipe that was only just replaced, since a cached crawl can be stale", () => {
    const learnedAt = "2026-11-28T03:12:00.000Z"; // before the gate cutoff
    const at = (time: string) =>
      shouldRelearnUnderfitRecipe({ learnedAt, postings: 1, now: Date.parse(time) });
    expect(at("2026-11-28T03:14:00.000Z")).toBe(false); // two minutes after it was saved
    expect(at("2026-11-28T03:23:00.000Z")).toBe(true); // more than ten minutes after
  });

  it("ignores a recipe whose learned time cannot be read", () => {
    expect(relearn("not a date", 1)).toBe(false);
  });
});
