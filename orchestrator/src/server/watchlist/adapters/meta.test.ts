import catalog from "@server/config/career-boards-meta.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistCatalogSourceAdapter } from "./types";

const origin = "https://www.metacareers.com";
const url = (id: number) => `${origin}/profile/job_details/${id}/`;
const source: WatchlistSelectedSource = {
  id: "meta-selected",
  catalogSourceId: "meta:meta",
  label: "Meta",
  sourceType: "meta",
  careersUrl: `${origin}/jobs`,
  cxsJobsUrl: null,
  isCustom: false,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
};
let adapter: WatchlistCatalogSourceAdapter;
beforeEach(async () => {
  vi.resetModules();
  adapter = (await import("./meta")).metaWatchlistAdapter;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function sitemap(count = 1) {
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: count }, (_, i) => `<url><loc>${url(i + 1)}</loc><lastmod>${new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()}</lastmod></url>`).join("")}</urlset>`;
}
// Trimmed live JobPosting SEO shape, including JSON-escaped @type and HTML entities.
function detail(id = 1) {
  return `<script type="application/ld+json" nonce="example">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: `Research Scientist ${id}`,
    description: "Improve Muse through applied projects.",
    responsibilities: "Build evaluations.&nbsp;Train models.",
    qualifications: "Python and PyTorch",
    department: "AI Research",
    datePosted: "2026-11-06T21:23:43-08:00",
    jobLocation: [
      {
        "@type": "Place",
        name: "Singapore",
        address: { addressCountry: "SG" },
      },
      { name: "London" },
    ],
  }).replace('"@type"', '"\\u0040type"')}</script>`;
}
function mockPages(count = 1) {
  const mock = vi
    .fn()
    .mockImplementation(
      async (value: string) =>
        new Response(
          value.endsWith("sitemap.xml")
            ? sitemap(count)
            : detail(Number(value.match(/job_details\/(\d+)/)?.[1])),
        ),
    );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("metaWatchlistAdapter", () => {
  it("returns completed details and starts no more at the soft deadline", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetchMock = vi.fn().mockImplementation(async (value: string) => {
      if (value.endsWith("sitemap.xml")) return new Response(sitemap(65));
      now.mockReturnValue(20_000);
      return new Response(detail());
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await adapter.fetchJobs({ source })).toMatchObject({
        total: 65,
        fetched: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("parses the real catalog without throwing and skips invalid entries", () => {
    expect(adapter.parseCatalogSources(catalog)).toEqual([
      {
        id: "meta:meta",
        label: "Meta",
        sourceType: "meta",
        careersUrl: `${origin}/jobs`,
        cxsJobsUrl: null,
      },
    ]);
    expect(adapter.catalogSchema.safeParse(catalog[0]).success).toBe(true);
    expect(
      adapter.parseCatalogSources([
        null,
        {},
        { label: "bad", careersUrl: "https://evil.test/jobs" },
      ]),
    ).toEqual([]);
    expect(adapter.descriptor.supportsCustomSource).toBe(false);
    expect(
      adapter.hydrateSelectedSource({ ...source, label: " " }),
    ).toMatchObject({ label: "Meta" });
    expect(
      adapter.normalizeCustomSelection({
        careersUrl: `${origin}/jobs?q=software`,
        label: null,
      }),
    ).toEqual({ label: "Meta", careersUrl: `${origin}/jobs` });
  });
  it.each([
    "https://evil.test/jobs",
    "http://www.metacareers.com/jobs",
    "https://www.metacareers.com.evil.test/jobs",
    "https://@www.metacareers.com/jobs",
    "https://www.metacareers.com:443/jobs",
    `${origin}/other`,
    "not url",
  ])("rejects unsafe source %s", (careersUrl) => {
    expect(() =>
      adapter.normalizeCustomSelection({ careersUrl, label: null }),
    ).toThrow();
  });
  it("maps all public fields and reuses details for import without a second request", async () => {
    const mock = mockPages();
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [
        {
          jobRef: url(1),
          source: "meta",
          sourceJobId: "1",
          sourceType: "meta",
          title: "Research Scientist 1",
          employer: "Meta",
          jobUrl: url(1),
          applicationLink: url(1),
          location: "Singapore; London",
          postedAt: "2026-11-07T05:23:43.000Z",
        },
      ],
    });
    const details = await adapter.fetchJobDetails({ source, jobRef: url(1) });
    expect(details.descriptionHtml).toContain("AI Research");
    expect(details.descriptionHtml).toContain(
      "Build evaluations.<br>Train models.",
    );
    const imported = await adapter.prepareImportDraft({
      source,
      jobRef: url(1),
    });
    expect(imported).toMatchObject({
      source: "meta",
      sourceHost: "www.metacareers.com",
      draft: {
        source: "meta",
        sourceJobId: "1",
        title: "Research Scientist 1",
        location: "Singapore; London",
      },
    });
    expect(imported.draft.jobDescription).toContain("Python and PyTorch");
    expect(mock).toHaveBeenCalledTimes(2);
    for (const [, options] of mock.mock.calls)
      expect(options).toMatchObject({
        redirect: "error",
        signal: expect.any(AbortSignal),
      });
  });
  it("caps at 60, sorts lastmod descending and runs at most two requests", async () => {
    let active = 0;
    let peak = 0;
    const mock = vi.fn().mockImplementation(async (value: string) => {
      if (value.endsWith("sitemap.xml")) return new Response(sitemap(65));
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 150));
      active--;
      return new Response(detail());
    });
    vi.stubGlobal("fetch", mock);
    const pending = adapter.fetchJobs({ source });
    const result = await pending;
    expect(result.fetched).toBe(60);
    expect(result.jobs[0].sourceJobId).toBe("65");
    expect(result.jobs[59].sourceJobId).toBe("6");
    expect(mock).toHaveBeenCalledTimes(61);
    expect(peak).toBeLessThanOrEqual(2);
  });
  it("skips failed details but fails loudly when all fail", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response(sitemap(2)))
      .mockResolvedValueOnce(new Response("private", { status: 500 }))
      .mockResolvedValueOnce(new Response(detail()));
    vi.stubGlobal("fetch", mock);
    expect((await adapter.fetchJobs({ source })).fetched).toBe(1);
    mock
      .mockResolvedValueOnce(new Response(sitemap()))
      .mockResolvedValueOnce(new Response("secret", { status: 502 }));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "all selected job details failed",
    );
  });
  it.each([
    "<html>changed</html>",
    "<urlset></urlset>",
    `<urlset><url><loc>${url(1)}</loc></url></urlset>`,
    `<urlset><url><loc>https://evil.test/job/1</loc><lastmod>2026-01-01</lastmod></url></urlset>`,
  ])("rejects changed sitemap shape", async (xml) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml)));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      /structure may have changed/,
    );
  });
  it.each([
    `<url><loc>${url(2)}</loc></url>`,
    `<url><loc>${url(2)}</loc><lastmod>invalid</lastmod></url>`,
    `<url><loc>${origin}/jobs</loc><lastmod>2026-01-01</lastmod></url>`,
    `<url><loc>https://evil.test/profile/job_details/2/</loc><lastmod>2026-01-01</lastmod></url>`,
  ])("skips an invalid sitemap row while retaining a valid job", async (badRow) => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(sitemap().replace("</urlset>", `${badRow}</urlset>`)),
      )
      .mockResolvedValueOnce(new Response(detail()));
    vi.stubGlobal("fetch", mock);
    expect(await adapter.fetchJobs({ source })).toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [{ sourceJobId: "1" }],
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("accepts a posting without jobLocation and maps location to null", async () => {
    const html = detail().replace(/,"jobLocation":\[[\s\S]*?\]}/, "}");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(sitemap()))
        .mockResolvedValueOnce(new Response(html)),
    );
    expect((await adapter.fetchJobs({ source })).jobs[0].location).toBeNull();
    expect(
      (await adapter.prepareImportDraft({ source, jobRef: url(1) })).draft
        .location,
    ).toBeUndefined();
  });
  it("fetches one detail on a miss, caches it, and replaces the list cache on refresh", async () => {
    const mock = mockPages();
    await adapter.prepareImportDraft({ source, jobRef: url(2) });
    await adapter.fetchJobDetails({ source, jobRef: url(2) });
    expect(mock).toHaveBeenCalledTimes(1);
    await adapter.fetchJobs({ source });
    await adapter.prepareImportDraft({ source, jobRef: url(2) });
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it("retries 429 three times and never exposes upstream bodies", async () => {
    const mock = vi
      .fn()
      .mockImplementation(async () => new Response("secret", { status: 429 }));
    vi.stubGlobal("fetch", mock);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Meta careers returned HTTP 429.",
    );
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it("rejects unsafe detail refs before fetching", async () => {
    const mock = mockPages();
    for (const jobRef of [
      "https://evil.test/1",
      `${url(1)}?next=bad`,
      `${origin}:443/profile/job_details/1/`,
      `${origin}/jobs`,
    ]) {
      await expect(
        adapter.prepareImportDraft({ source, jobRef }),
      ).rejects.toThrow();
    }
    expect(mock).not.toHaveBeenCalled();
  });
  it("rejects missing full JobPosting data instead of importing truncated og descriptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<meta property="og:description" content="truncated...">',
          ),
        ),
    );
    await expect(
      adapter.prepareImportDraft({ source, jobRef: url(1) }),
    ).rejects.toThrow(/structure may have changed/);
  });
  it("propagates caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = mockPages();
    await expect(
      adapter.fetchJobs({ source, signal: controller.signal }),
    ).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("returns completed jobs when the operation deadline expires", async () => {
    // An explicit operation deadline; avoid waiting 24 seconds in this regression.
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
      timeout(ms === 24_000 ? 250 : ms),
    );
    let detailCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async (value: string, options: RequestInit) => {
          if (value.endsWith("sitemap.xml")) return new Response(sitemap(5));
          if (++detailCalls === 1) return new Response(detail());
          await new Promise((_, reject) =>
            options.signal?.addEventListener(
              "abort",
              () => reject(new Error("deadline")),
              { once: true },
            ),
          );
        }),
    );
    try {
      expect((await adapter.fetchJobs({ source })).fetched).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
