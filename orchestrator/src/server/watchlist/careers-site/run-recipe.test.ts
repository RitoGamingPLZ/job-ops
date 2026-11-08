import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedByRobots, loadPage } from "./fetch";
import { extractJob, runRecipe } from "./run-recipe";
import { type Recipe, SiteBlockedError } from "./types";

vi.mock("./fetch", () => ({
  loadPage: vi.fn(),
  isAllowedByRobots: vi.fn(),
}));
const base = "https://careers.example.com";
const recipe: Recipe = {
  version: 1,
  jobUrlPattern: "/jobs/\\d+$",
  jobIdPattern: "/jobs/(\\d+)$",
  listing: { kind: "sitemap", url: `${base}/sitemap.xml` },
  detail: { kind: "jsonld" },
};
const posting = (title = "Engineer") =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title,
    description: "<p>Build useful things.</p>",
    hiringOrganization: { name: "Example" },
    datePosted: "2026-11-07",
    jobLocation: [
      {
        address: {
          addressLocality: "Toronto",
          addressRegion: "ON",
          addressCountry: "CA",
        },
      },
      { name: "Remote" },
    ],
  })}</script>`;
const sitemap = (entries: [string, string?][]) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(([url, date]) => `<url><loc>${url.replaceAll("&", "&amp;")}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`).join("")}</urlset>`;
const index = (...urls: string[]) =>
  `<sitemapindex>${urls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;

function pages(values: Record<string, string | Error>) {
  vi.mocked(loadPage).mockImplementation(async (url) => {
    const value = values[url];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error("Missing fixture");
    return { url, status: 200, html: value };
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAllowedByRobots).mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("extractJob", () => {
  it.each([
    "jsonld",
    "microdata",
  ])("decodes entities in %s title, employer and location", (kind) => {
    const encoded = "Risk &amp; Compliance &#x2013; &#169;";
    const html =
      kind === "jsonld"
        ? `<script type="application/ld+json">${JSON.stringify({
            "@type": "JobPosting",
            title: encoded,
            description: "Details",
            hiringOrganization: { name: encoded },
            jobLocation: { name: encoded },
          })}</script>`
        : `<div itemscope itemtype="https://schema.org/JobPosting">
      <meta itemprop="title" content="Risk &amp; Compliance &#x2013; &#169;">
      <meta itemprop="description" content="Details">
      <meta itemprop="hiringOrganization" content="Risk &amp; Compliance &#x2013; &#169;">
      <meta itemprop="jobLocation" content="Risk &amp; Compliance &#x2013; &#169;">
    </div>`;
    expect(extractJob(html, `${base}/jobs/42`, recipe)).toMatchObject({
      title: "Risk & Compliance – ©",
      employer: "Risk & Compliance – ©",
      location: "Risk & Compliance – ©",
    });
  });
  it.each([
    "microdata",
    "selectors",
  ])("preserves literal entity text already parsed from %s", (kind) => {
    const html =
      kind === "microdata"
        ? '<div itemscope itemtype="https://schema.org/JobPosting"><meta itemprop="title" content="AT&amp;amp;T &amp;lt;b&amp;gt;"><meta itemprop="description" content="Details"><meta itemprop="hiringOrganization" content="AT&amp;amp;T"><meta itemprop="jobLocation" content="&amp;lt;b&amp;gt;"></div>'
        : "<h1>AT&amp;amp;T &amp;lt;b&amp;gt;</h1><article>Details</article><aside>&amp;lt;b&amp;gt;</aside>";
    const selected: Recipe =
      kind === "selectors"
        ? {
            ...recipe,
            detail: {
              kind: "selectors",
              render: false,
              title: "h1",
              description: "article",
              location: "aside",
            },
          }
        : recipe;
    expect(extractJob(html, `${base}/jobs/42`, selected)).toMatchObject({
      title: "AT&amp;T &lt;b&gt;",
      location: "&lt;b&gt;",
      ...(kind === "microdata" ? { employer: "AT&amp;T" } : {}),
    });
  });

  it("accepts 500 character URLs and rejects 501 before recipe regexes", () => {
    const url = `${base}/jobs/${"x".repeat(500 - base.length - 6)}`;
    expect(url).toHaveLength(500);
    expect(extractJob(posting(), url, recipe)).not.toBeNull();
    expect(
      extractJob(posting(), `${url}x`, { ...recipe, jobIdPattern: "[" }),
    ).toBeNull();
  });

  it("maps public structured data and URL ids", () => {
    expect(extractJob(posting(), `${base}/jobs/42`, recipe)).toEqual({
      id: "42",
      url: `${base}/jobs/42`,
      title: "Engineer",
      employer: "Example",
      location: "Toronto, ON, CA; Remote",
      postedAt: "2026-11-07T00:00:00.000Z",
      descriptionHtml: "<p>Build useful things.</p>",
    });
  });
  it("reads plain address strings used by current Okta JobPostings", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Engineer",
      description: "Details",
      jobLocation: [{ "@type": "Place", address: "Manila, Philippines" }],
    })}</script>`;
    expect(extractJob(html, `${base}/jobs/42`, recipe)?.location).toBe(
      "Manila, Philippines",
    );
  });
  it("finds JSON-LD arrays and graphs after malformed scripts without executing scripts", () => {
    const html = `<script>throw new Error('never execute')</script><script type="application/ld+json">invalid</script><script type="application/ld+json">${JSON.stringify(
      [
        { "@type": "Organization" },
        {
          "@graph": [
            {
              "@type": ["Thing", "JobPosting"],
              title: "Role",
              description: "Details",
              datePosted: "bad",
            },
          ],
        },
      ],
    )}</script>`;
    expect(
      extractJob(html, `${base}/jobs/1`, {
        ...recipe,
        jobIdPattern: undefined,
      }),
    ).toMatchObject({
      id: `${base}/jobs/1`,
      title: "Role",
      employer: null,
      location: null,
      postedAt: null,
    });
  });
  it("reads nested microdata, content attributes, HTML descriptions and repeated locations", () => {
    const html = `<article itemscope itemtype="http://schema.org/JobPosting">
      <h1 itemprop="title"> Developer </h1><section itemprop="description"><p>Hello <b>world</b></p></section>
      <div itemprop="hiringOrganization" itemscope><span itemprop="name">Company</span></div>
      <time itemprop="datePosted" datetime="2026-01-02">Jan 2</time>
      <div itemprop="jobLocation" itemscope><div itemprop="address" itemscope>
      <meta itemprop="addressLocality" content="London"><span itemprop="addressCountry">UK</span></div></div>
      <div itemprop="jobLocation" itemscope><span itemprop="name">Remote</span></div></article>`;
    expect(extractJob(html, `${base}/jobs/2`, recipe)).toMatchObject({
      title: "Developer",
      employer: "Company",
      location: "London, UK; Remote",
      postedAt: "2026-01-02T00:00:00.000Z",
      descriptionHtml: "<p>Hello <b>world</b></p>",
    });
  });
  it("reads selectors' first match and preserves description markup", () => {
    const selectors: Recipe = {
      ...recipe,
      detail: {
        kind: "selectors",
        render: true,
        title: "h1",
        description: ".body",
        location: ".location",
        postedAt: "time",
      },
    };
    expect(
      extractJob(
        '<h1>First</h1><h1>Second</h1><div class="body"><p>Work</p></div><span class="location">Remote</span><time datetime="2026-11-01">Sunday</time>',
        `${base}/jobs/3`,
        selectors,
      ),
    ).toMatchObject({
      title: "First",
      descriptionHtml: "<p>Work</p>",
      location: "Remote",
      postedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(
      extractJob("<h1>No body</h1>", `${base}/jobs/3`, selectors),
    ).toBeNull();
  });
  it("returns null for invalid selectors", () => {
    expect(
      extractJob("<h1>Role</h1><main>Details</main>", `${base}/jobs/1`, {
        ...recipe,
        detail: {
          kind: "selectors",
          render: false,
          title: "[",
          description: "main",
        },
      }),
    ).toBeNull();
  });
  it("skips overlong detail URLs before matching the ID pattern", () => {
    const url = `${base}/jobs/${"1".repeat(2048)}`;
    const exec = vi.spyOn(RegExp.prototype, "exec");
    try {
      expect(extractJob(posting(), url, recipe)).toBeNull();
      expect(exec.mock.calls.some(([value]) => value === url)).toBe(false);
    } finally {
      exec.mockRestore();
    }
  });
  it("rejects missing postings and incomplete structured data", () => {
    expect(
      extractJob(
        '<script type="application/ld+json">{"@type":"JobPosting","title":"Incomplete"}</script>',
        base,
        recipe,
      ),
    ).toBeNull();
    expect(extractJob("<h1>Not a job</h1>", base, recipe)).toBeNull();
  });
});

describe("runRecipe", () => {
  it("orders same UTC-day lastmods by numeric ID despite timestamp noise", async () => {
    const entries: [string, string?][] = [
      [`${base}/jobs/9`, "2026-11-08T04:54:24Z"],
      [`${base}/jobs/100`, "2026-11-08T04:53:15Z"],
      [`${base}/jobs/20`, "2026-11-07T23:53:30-05:00"],
    ];
    pages({
      [recipe.listing.url]: sitemap(entries),
      ...Object.fromEntries(entries.map(([url]) => [url, posting()])),
    });
    expect(
      (await runRecipe(recipe, { limit: 2 })).map((job) => job.id),
    ).toEqual(["100", "20"]);
    expect(loadPage).not.toHaveBeenCalledWith(entries[0][0], expect.anything());
  });

  it("orders different UTC days before numeric IDs and undated entries", async () => {
    const entries: [string, string?][] = [
      [`${base}/jobs/999`, "2026-11-08T23:59:59Z"],
      [`${base}/jobs/1`, "2026-11-08T20:00:00-05:00"],
      [`${base}/jobs/9999`],
    ];
    pages({
      [recipe.listing.url]: sitemap(entries),
      ...Object.fromEntries(entries.map(([url]) => [url, posting()])),
    });
    expect(
      (await runRecipe(recipe, { limit: 40 })).map((job) => job.id),
    ).toEqual(["1", "999", "9999"]);
  });

  it("preserves file order for same-day entries without numeric IDs", async () => {
    const entries: [string, string?][] = [
      [`${base}/jobs/zebra`, "2026-11-08T04:53:15Z"],
      [`${base}/jobs/alpha`, "2026-11-08T04:54:24Z"],
    ];
    pages({
      [recipe.listing.url]: sitemap(entries),
      ...Object.fromEntries(entries.map(([url]) => [url, posting()])),
    });
    expect(
      (
        await runRecipe(
          {
            ...recipe,
            jobUrlPattern: "/jobs/",
            jobIdPattern: "/jobs/([^/]+)$",
          },
          { limit: 40 },
        )
      ).map((job) => job.id),
    ).toEqual(["zebra", "alpha"]);
  });

  it("caps an alphabetical sitemap without lastmod at the highest numeric IDs", async () => {
    const urls = ["accountant/9", "engineer/100", "writer/20"].map(
      (path) => `${base}/jobs/${path}`,
    );
    pages({
      [recipe.listing.url]: sitemap(urls.map((url) => [url])),
      ...Object.fromEntries(urls.map((url) => [url, posting()])),
    });
    expect(
      (
        await runRecipe(
          { ...recipe, jobUrlPattern: "/jobs/", jobIdPattern: "(\\d+)$" },
          { limit: 2 },
        )
      ).map((job) => job.id),
    ).toEqual(["100", "20"]);
    expect(loadPage).not.toHaveBeenCalledWith(urls[0], expect.anything());
  });

  it("orders lastmod first, numeric IDs next, and other IDs in file order", async () => {
    const entries: [string, string?][] = [
      [`${base}/jobs/zebra`],
      [`${base}/jobs/99999`],
      [`${base}/jobs/1`, "2025-01-01"],
      [`${base}/jobs/alpha`],
      [`${base}/jobs/20`],
      [`${base}/jobs/2`, "2026-01-01"],
    ];
    pages({
      [recipe.listing.url]: sitemap(entries),
      ...Object.fromEntries(entries.map(([url]) => [url, posting()])),
    });
    expect(
      (
        await runRecipe(
          {
            ...recipe,
            jobUrlPattern: "/jobs/",
            jobIdPattern: "/jobs/([^/]+)$",
          },
          { limit: 40 },
        )
      ).map((job) => job.id),
    ).toEqual(["2", "1", "99999", "20", "zebra", "alpha"]);
  });

  it("uses the last run of at least five path digits only without an ID pattern", async () => {
    const urls = [
      `${base}/jobs/99999/alpha-10000-42?ref=999999`,
      `${base}/jobs/beta-30000`,
      `${base}/jobs/zebra-1234?ref=888888`,
      `${base}/jobs/alpha-4321`,
      `${base}/jobs/gamma-20000`,
    ];
    pages({
      [recipe.listing.url]: sitemap(urls.map((url) => [url])),
      ...Object.fromEntries(urls.map((url) => [url, posting()])),
    });
    for (const jobIdPattern of [undefined, "/jobs/([^/]+)"]) {
      expect(
        (
          await runRecipe(
            { ...recipe, jobUrlPattern: "/jobs/", jobIdPattern },
            { limit: 40 },
          )
        ).map((job) => job.url),
      ).toEqual(
        jobIdPattern ? urls : [urls[1], urls[4], urls[0], urls[2], urls[3]],
      );
    }
  });

  it("skips listing URLs over 500 chars before matching recipes", async () => {
    const longUrl = `${base}/jobs/${"1".repeat(501)}`;
    pages({
      [`${base}/sitemap.xml`]: sitemap([[longUrl], [`${base}/jobs/42`]]),
      [`${base}/jobs/42`]: posting(),
    });
    expect(await runRecipe(recipe, { limit: 40 })).toHaveLength(1);
    expect(loadPage).not.toHaveBeenCalledWith(longUrl, expect.anything());
  });

  it("follows indexes to depth two, deduplicates, orders by lastmod and caps details", async () => {
    pages({
      [`${base}/sitemap.xml`]: index(
        `${base}/nested.xml`,
        `${base}/missing.xml`,
        "https://other.example/sitemap.xml",
      ),
      [`${base}/nested.xml`]: index(`${base}/jobs.xml`, `${base}/too-deep.xml`),
      [`${base}/jobs.xml`]: sitemap([
        [`${base}/jobs/1`, "2025-01-01"],
        [`${base}/jobs/2`, "2026-11-01"],
        [`${base}/jobs/1`, "2026-11-03"],
        [`${base}/jobs/3`],
        [`${base}/about`],
        ["https://other.example/jobs/4"],
      ]),
      [`${base}/too-deep.xml`]: index(`${base}/never.xml`),
      [`${base}/jobs/1`]: posting("Newest"),
      [`${base}/jobs/2`]: posting("Older"),
    });
    expect(
      (await runRecipe(recipe, { limit: 2 })).map((job) => job.title),
    ).toEqual(["Newest", "Older"]);
    expect(vi.mocked(loadPage).mock.calls.map(([url]) => url)).not.toContain(
      `${base}/never.xml`,
    );
    expect(vi.mocked(loadPage).mock.calls.map(([url]) => url)).not.toContain(
      `${base}/jobs/3`,
    );
    expect(isAllowedByRobots).toHaveBeenCalledTimes(
      vi.mocked(loadPage).mock.calls.length,
    );
  });
  it.each([
    ["/jobs/42", "/jobs/99", "42"],
    ["/jobs/42", "/roles/engineer", "42"],
    ["/roles/listed", "/jobs/99", "99"],
    ["/roles/listed", "/roles/final", `${base}/roles/listed`],
  ])("uses listing ID then final ID then listing URL for %s redirecting to %s", async (listed, final, id) => {
    vi.mocked(loadPage).mockImplementation(async (url) => ({
      url: url.endsWith(".xml") ? url : `${base}${final}`,
      status: 200,
      html: url.endsWith(".xml") ? sitemap([[`${base}${listed}`]]) : posting(),
    }));
    expect(
      await runRecipe(
        { ...recipe, jobUrlPattern: "/(jobs|roles)/" },
        { limit: 1 },
      ),
    ).toMatchObject([{ id, url: `${base}${final}` }]);
  });
  it("skips duplicate IDs captured from different listing URLs", async () => {
    pages({
      [`${base}/sitemap.xml`]: sitemap([
        [`${base}/jobs/42`],
        [`${base}/jobs/42?locale=en`],
      ]),
      [`${base}/jobs/42`]: posting(),
      [`${base}/jobs/42?locale=en`]: posting(),
    });
    expect(
      await runRecipe(
        { ...recipe, jobUrlPattern: "/jobs/", jobIdPattern: "/jobs/(\\d+)" },
        { limit: 2 },
      ),
    ).toHaveLength(1);
  });
  it.each([
    "sitemap",
    "page",
  ] as const)("skips overlong %s links before regex matching", async (kind) => {
    const longUrl = `${base}/jobs/${"1".repeat(2048)}`;
    const boundedRecipe: Recipe =
      kind === "sitemap"
        ? recipe
        : {
            ...recipe,
            listing: {
              kind: "page",
              url: `${base}/openings`,
              render: false,
              pagination: { kind: "none" },
              maxPages: 1,
            },
          };
    pages({
      [boundedRecipe.listing.url]:
        kind === "sitemap"
          ? sitemap([[longUrl], [`${base}/jobs/1`]])
          : `<a href="${longUrl}">Long</a><a href="/jobs/1">Role</a>`,
      [`${base}/jobs/1`]: posting(),
    });
    const test = vi.spyOn(RegExp.prototype, "test");
    try {
      expect(
        (await runRecipe(boundedRecipe, { limit: 2 })).map((job) => job.id),
      ).toEqual(["1"]);
      expect(test.mock.calls.some(([value]) => value === longUrl)).toBe(false);
      expect(loadPage).not.toHaveBeenCalledWith(longUrl, expect.anything());
    } finally {
      test.mockRestore();
    }
  });
  it("stops listing pagination once enough candidates have been collected", async () => {
    const pagedRecipe: Recipe = {
      ...recipe,
      listing: {
        kind: "page",
        url: `${base}/openings`,
        render: false,
        pagination: { kind: "query", param: "page", start: 1, step: 1 },
        maxPages: 5,
      },
    };
    pages({
      [`${base}/openings?page=1`]:
        '<a href="/jobs/1">One</a><a href="/jobs/2">Two</a>',
      [`${base}/jobs/1`]: posting(),
      [`${base}/jobs/2`]: posting(),
    });
    expect(await runRecipe(pagedRecipe, { limit: 2 })).toHaveLength(2);
    expect(loadPage).toHaveBeenCalledTimes(3);
    expect(loadPage).not.toHaveBeenCalledWith(
      `${base}/openings?page=2`,
      expect.anything(),
    );
  });
  it("supports namespaced sitemaps, missing/invalid lastmod, and escaped query strings", async () => {
    const url = `${base}/jobs/4?a=1&b=2`;
    pages({
      [`${base}/sitemap.xml`]: `<s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"><s:url><s:loc>${url.replaceAll("&", "&amp;")}</s:loc><s:lastmod>invalid</s:lastmod></s:url></s:urlset>`,
      [url]: posting(),
    });
    expect(
      await runRecipe({ ...recipe, jobUrlPattern: "/jobs/" }, { limit: 1 }),
    ).toHaveLength(1);
  });
  it("loads rendered paginated listings, resolves relative links and ignores foreign or unsafe links", async () => {
    const pageRecipe: Recipe = {
      ...recipe,
      listing: {
        kind: "page",
        url: `${base}/openings`,
        render: true,
        waitFor: ".jobs",
        pagination: { kind: "query", param: "page", start: 0, step: 2 },
        maxPages: 3,
      },
      detail: {
        kind: "selectors",
        render: true,
        title: "h1",
        description: "main",
      },
    };
    pages({
      [`${base}/openings?page=0`]:
        '<a href="/jobs/1#apply">One</a><a href="http://careers.example.com/jobs/2">HTTP</a><a href="https://other.example/jobs/3">Other</a><a href="https://user@careers.example.com/jobs/5">Credentials</a><a href="/jobs/1">Again</a>',
      [`${base}/openings?page=2`]: new Error("Temporary failure"),
      [`${base}/openings?page=4`]: '<a href="/jobs/4">Four</a>',
      [`${base}/jobs/1`]: "<h1>One</h1><main>Details</main>",
      [`${base}/jobs/4`]: "<h1>Four</h1><main>Details</main>",
    });
    const signal = new AbortController().signal;
    expect(
      (await runRecipe(pageRecipe, { limit: 3, signal })).map((job) => job.id),
    ).toEqual(["1", "4"]);
    expect(loadPage).toHaveBeenCalledWith(`${base}/openings?page=0`, {
      render: true,
      waitFor: ".jobs",
      signal,
    });
    expect(loadPage).toHaveBeenCalledWith(`${base}/jobs/1`, {
      render: true,
      waitFor: undefined,
      signal,
    });
    expect(loadPage).toHaveBeenCalledTimes(5);
    for (const [url] of vi.mocked(loadPage).mock.calls)
      expect(isAllowedByRobots).toHaveBeenCalledWith(url, { signal });
  });
  it("limits detail concurrency to three and preserves sorted order despite completion order", async () => {
    let active = 0;
    let peak = 0;
    vi.mocked(loadPage).mockImplementation(async (url) => {
      if (url.endsWith(".xml"))
        return {
          url,
          status: 200,
          html: sitemap([1, 2, 3, 4].map((id) => [`${base}/jobs/${id}`])),
        };
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) =>
        setTimeout(resolve, url.endsWith("4") ? 15 : 1),
      );
      active--;
      return { url, status: 200, html: posting(url) };
    });
    expect(
      (await runRecipe(recipe, { limit: 4 })).map((job) => job.id),
    ).toEqual(["4", "3", "2", "1"]);
    expect(peak).toBe(3);
  });
  it.each([
    "load",
    "robots",
  ] as const)("soft-aborts a stalled detail %s and returns earlier jobs before the hard abort", async (phase) => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout uses real timers; route it through fake timers.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        delay,
      );
      return controller.signal;
    });
    const stalled = (signal?: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        if (!signal) throw new Error("Expected a page signal");
        signal.throwIfAborted();
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    vi.mocked(isAllowedByRobots).mockImplementation(async (url, options) => {
      if (phase === "robots" && url.endsWith("/1"))
        return stalled(options?.signal);
      return true;
    });
    vi.mocked(loadPage).mockImplementation(async (url, options) => {
      if (url.endsWith(".xml"))
        return {
          url,
          status: 200,
          html: sitemap([1, 2, 3].map((id) => [`${base}/jobs/${id}`])),
        };
      if (url.endsWith("/1")) return stalled(options?.signal);
      return { url, status: 200, html: posting() };
    });
    const start = Date.now();
    const hardSignal = AbortSignal.timeout(25_000);
    const resolved = vi.fn();
    const result = runRecipe(recipe, {
      limit: 3,
      signal: hardSignal,
      stopAt: start + 10_000,
    }).then((jobs) => {
      resolved();
      return jobs;
    });
    await vi.advanceTimersByTimeAsync(12_999);
    expect(resolved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).map((job) => job.id)).toEqual(["3", "2"]);
    expect(Date.now() - start).toBe(13_000);
    expect(hardSignal.aborted).toBe(false);
  });
  it("returns completed and in-flight jobs past stopAt without starting more details", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    vi.mocked(loadPage).mockImplementation(async (url) => {
      if (url.endsWith(".xml"))
        return {
          url,
          status: 200,
          html: sitemap([1, 2, 3, 4, 5].map((id) => [`${base}/jobs/${id}`])),
        };
      await new Promise((resolve) =>
        setTimeout(resolve, url.endsWith("5") ? 5 : 15),
      );
      return { url, status: 200, html: posting() };
    });
    const result = runRecipe(recipe, { limit: 5, stopAt: start + 10 });
    await vi.advanceTimersByTimeAsync(20);
    expect((await result).map((job) => job.id)).toEqual(["5", "4", "3", "2"]);
    expect(loadPage).not.toHaveBeenCalledWith(
      `${base}/jobs/1`,
      expect.anything(),
    );
  });
  it.each([
    "sitemap",
    "page",
  ] as const)("stops %s traversal at stopAt with discovered candidates retained", async (kind) => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const listing: Recipe["listing"] =
      kind === "sitemap"
        ? recipe.listing
        : {
            kind: "page",
            url: `${base}/openings`,
            render: false,
            pagination: { kind: "query", param: "page", start: 1, step: 1 },
            maxPages: 3,
          };
    vi.mocked(loadPage).mockImplementation(async (url) => {
      if (url === recipe.listing.url)
        return {
          url,
          status: 200,
          html: index(`${base}/first.xml`, `${base}/second.xml`),
        };
      now.mockReturnValue(10);
      return {
        url,
        status: 200,
        html:
          kind === "sitemap"
            ? sitemap([[`${base}/jobs/1`]])
            : '<a href="/jobs/1">Role</a>',
      };
    });
    // Finding a candidate still follows the existing all-details-empty failure path.
    await expect(
      runRecipe({ ...recipe, listing }, { limit: 5, stopAt: 10 }),
    ).rejects.toThrow("All selected careers job pages failed");
    expect(loadPage).toHaveBeenCalledTimes(kind === "sitemap" ? 2 : 1);
  });
  it("does not start a detail load when the deadline passes during robots checking", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    pages({ [recipe.listing.url]: sitemap([[`${base}/jobs/1`]]) });
    vi.mocked(isAllowedByRobots).mockImplementation(async (url) => {
      if (url.includes("/jobs/")) now.mockReturnValue(10);
      return true;
    });
    await expect(runRecipe(recipe, { limit: 1, stopAt: 10 })).rejects.toThrow(
      "All selected careers job pages failed",
    );
    expect(loadPage).toHaveBeenCalledTimes(1);
  });
  it("still throws on abort after collecting jobs before the soft deadline", async () => {
    const controller = new AbortController();
    vi.mocked(loadPage).mockImplementation(async (url) => {
      if (url.endsWith(".xml"))
        return {
          url,
          status: 200,
          html: sitemap([1, 2, 3, 4].map((id) => [`${base}/jobs/${id}`])),
        };
      if (url.endsWith("1")) controller.abort(new Error("Cancelled details"));
      return { url, status: 200, html: posting() };
    });
    await expect(
      runRecipe(recipe, {
        limit: 4,
        signal: controller.signal,
        stopAt: Date.now() + 20_000,
      }),
    ).rejects.toThrow("Cancelled details");
  });
  it("skips broken or empty detail pages but throws a sanitized error if all fail", async () => {
    pages({
      [`${base}/sitemap.xml`]: sitemap([
        [`${base}/jobs/1`, "2026-11-02"],
        [`${base}/jobs/2`, "2026-11-01"],
        [`${base}/jobs/3`],
      ]),
      [`${base}/jobs/1`]: new Error("secret upstream body"),
      [`${base}/jobs/2`]: "<h1>Removed</h1>",
      [`${base}/jobs/3`]: posting(),
    });
    expect(
      (await runRecipe(recipe, { limit: 3 })).map((job) => job.id),
    ).toEqual(["3"]);
    await expect(runRecipe(recipe, { limit: 2 })).rejects.toThrow(
      "All selected careers job pages failed",
    );
  });
  it("treats robots denials and upstream blocks as fatal even with successful details", async () => {
    pages({
      [`${base}/sitemap.xml`]: sitemap([
        [`${base}/jobs/1`],
        [`${base}/jobs/2`],
      ]),
      [`${base}/jobs/1`]: posting(),
      [`${base}/jobs/2`]: new SiteBlockedError(
        "careers.example.com",
        "HTTP 403",
      ),
    });
    await expect(runRecipe(recipe, { limit: 2 })).rejects.toBeInstanceOf(
      SiteBlockedError,
    );
    vi.mocked(isAllowedByRobots).mockImplementation(
      async (url) => !url.endsWith("/jobs/2"),
    );
    vi.mocked(loadPage).mockClear();
    await expect(runRecipe(recipe, { limit: 2 })).rejects.toThrow("robots.txt");
    expect(loadPage).not.toHaveBeenCalledWith(
      `${base}/jobs/2`,
      expect.anything(),
    );
    vi.mocked(isAllowedByRobots).mockResolvedValue(false);
    vi.mocked(loadPage).mockClear();
    await expect(runRecipe(recipe, { limit: 2 })).rejects.toBeInstanceOf(
      SiteBlockedError,
    );
    expect(loadPage).not.toHaveBeenCalled();
  });
  it("honors abort signals rather than returning partial results", async () => {
    const controller = new AbortController();
    pages({ [`${base}/sitemap.xml`]: sitemap([[`${base}/jobs/1`]]) });
    vi.mocked(loadPage).mockImplementationOnce(async (url) => {
      controller.abort(new Error("Cancelled"));
      return { url, status: 200, html: sitemap([[`${base}/jobs/1`]]) };
    });
    await expect(
      runRecipe(recipe, { limit: 1, signal: controller.signal }),
    ).rejects.toThrow("Cancelled");
  });
  it("returns empty for a valid empty sitemap or zero limit and rejects invalid or failed listings", async () => {
    expect(await runRecipe(recipe, { limit: 0 })).toEqual([]);
    expect(loadPage).not.toHaveBeenCalled();
    pages({ [`${base}/sitemap.xml`]: sitemap([]) });
    expect(await runRecipe(recipe, { limit: 3 })).toEqual([]);
    pages({ [`${base}/sitemap.xml`]: "<html>Oops</html>" });
    await expect(runRecipe(recipe, { limit: 3 })).rejects.toThrow(
      "Invalid careers sitemap",
    );
    const pageRecipe: Recipe = {
      ...recipe,
      listing: {
        kind: "page",
        url: base,
        render: false,
        pagination: { kind: "none" },
        maxPages: 5,
      },
    };
    pages({ [base]: new Error("private response") });
    await expect(runRecipe(pageRecipe, { limit: 1 })).rejects.toThrow(
      "No careers listing pages",
    );
  });
  it("rejects foreign final URLs and unsuccessful HTTP statuses", async () => {
    vi.mocked(loadPage).mockResolvedValue({
      url: "https://foreign.example/sitemap.xml",
      status: 200,
      html: sitemap([]),
    });
    await expect(runRecipe(recipe, { limit: 1 })).rejects.toThrow(
      "could not be loaded",
    );
    vi.mocked(loadPage).mockResolvedValue({
      url: `${base}/sitemap.xml`,
      status: 403,
      html: "blocked",
    });
    await expect(runRecipe(recipe, { limit: 1 })).rejects.toBeInstanceOf(
      SiteBlockedError,
    );
  });
});
