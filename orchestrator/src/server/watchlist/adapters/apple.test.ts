import appleCatalog from "@server/config/career-boards-apple.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleWatchlistAdapter as adapter } from "./apple";

const source: WatchlistSelectedSource = {
  id: "selected-apple",
  catalogSourceId: "apple:apple",
  label: "My filtered search",
  sourceType: "apple",
  careersUrl:
    "https://jobs.apple.com/en-us/search?search=engineer&location=united-states-USA&page=9&sort=relevance&team=SFTWR-CLD+HRDWR-ESFD",
  cxsJobsUrl: null,
  isCustom: false,
  sortOrder: 0,
  createdAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:00Z",
};

function job(index = 1) {
  return {
    positionId: `200123456-${index}`,
    postingTitle: `Engineer "special" ${index}`,
    transformedPostingTitle: `engineer-${index}`,
    locations: [
      {
        city: "Cupertino",
        stateProvince: "California",
        countryName: "United States",
      },
    ],
    postDateInGMT: new Date(Date.UTC(2026, 9, index)).toISOString(),
  };
}

function html(loaderData: unknown) {
  return new Response(
    `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify({ loaderData }))});</script>`,
  );
}

function search(jobs = [job()], totalRecords = jobs.length) {
  return html({ search: { searchResults: jobs, totalRecords } });
}

function detail() {
  return html({
    jobDetails: {
      jobsData: {
        ...job(),
        jobSummary: 'Build "great" products.\nUse C++ & Swift.',
        description: "Solve problems.\n<script>text only</script>",
        minimumQualifications: "Three years of experience.",
        preferredQualifications: "Distributed systems.",
      },
    },
  });
}

const jobRef = "https://jobs.apple.com/en-us/details/200123456-1/engineer-1";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("appleWatchlistAdapter", () => {
  it("returns completed pages and starts no more at the soft deadline", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const fetchMock = vi.fn().mockImplementation(async () => {
      now.mockReturnValue(20_000);
      return search(
        Array.from({ length: 20 }, (_, i) => job(i + 1)),
        100,
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await adapter.fetchJobs({ source })).toMatchObject({
        total: 100,
        fetched: 20,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it("returns completed pages when an in-flight page reaches the soft deadline", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => realTimeout(ms === 20_000 ? 50 : ms));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        search(
          Array.from({ length: 20 }, (_, i) => job(i + 1)),
          100,
        ),
      )
      .mockImplementation(
        async (_url, options) =>
          new Promise((_, reject) => {
            options.signal.throwIfAborted();
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true,
            });
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await adapter.fetchJobs({ source })).toMatchObject({
        fetched: 20,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
    }
  });

  it("parses its real catalog with stable ids", () => {
    const entries = appleCatalog;
    expect(adapter.parseCatalogSources(entries)).toEqual([
      {
        id: "apple:apple",
        label: "Apple",
        sourceType: "apple",
        cxsJobsUrl: null,
        careersUrl:
          "https://jobs.apple.com/en-us/search?page=1&sort=newest&team=HRDWR-ACT+HRDWR-ADD+HRDWR-ARCH+HRDWR-BE+HRDWR-CAM+HRDWR-CWSC+HRDWR-DISP+HRDWR-ESFD+HRDWR-EPM+HRDWR-HT+HRDWR-ICP+HRDWR-MCHLN+HRDWR-MAE+HRDWR-ME+HRDWR-PS+HRDWR-PPT+HRDWR-PACE+HRDWR-PDE+HRDWR-REL+HRDWR-SENT+HRDWR-SILT+HRDWR-SQATV+HRDWR-SPC+HRDWR-SDE+HRDWR-VMAT+SFTWR-AF+SFTWR-CP+SFTWR-CLD+SFTWR-DSR+SFTWR-EPM+SFTWR-GPUG+SFTWR-ISTECH+SFTWR-MCHLN+SFTWR-COS+SFTWR-PD+SFTWR-SEC+SFTWR-SQAT+SFTWR-SC+SFTWR-TS+SFTWR-UEE+SFTWR-VMAT+SFTWR-WSFT",
      },
    ]);
    expect(adapter.catalogSchema.safeParse(entries[0]).success).toBe(true);
    const catalogUrl = new URL(adapter.parseCatalogSources(entries)[0].careersUrl);
    expect(catalogUrl.toString().length).toBeLessThanOrEqual(2000);
    const teams = catalogUrl.searchParams.get("team")?.split(" ") ?? [];
    expect(teams).toHaveLength(42);
    expect(teams.every((team) => /^(SFTWR|HRDWR)-[A-Z]+$/.test(team))).toBe(true);
    expect(teams).toEqual(expect.arrayContaining(["SFTWR-CLD", "HRDWR-ESFD"]));
  });

  it("keeps search filters and canonicalizes pagination, sort, labels and fragments", () => {
    expect(
      adapter.normalizeCustomSelection({
        careersUrl: `${source.careersUrl}#results`,
        label: "  Engineering  ",
      }),
    ).toEqual({
      label: "Engineering",
      careersUrl:
        "https://jobs.apple.com/en-us/search?location=united-states-USA&page=1&search=engineer&sort=newest&team=SFTWR-CLD+HRDWR-ESFD",
    });
    expect(
      adapter.normalizeCustomSelection({
        careersUrl: source.careersUrl,
        label: source.careersUrl,
      }),
    ).toMatchObject({ label: "Apple" });
    expect(adapter.hydrateSelectedSource({ ...source, label: "" })).toMatchObject({
      label: "Apple",
      cxsJobsUrl: null,
    });
    expect(adapter.descriptor.supportsCustomSource).toBe(true);
  });

  it.each([
    "https://jobs.apple.com.evil.test/en-us/search",
    "https://evil.test/en-us/search",
    "http://jobs.apple.com/en-us/search",
    "https://user:password@jobs.apple.com/en-us/search",
    "https://jobs.apple.com/en-us/details/123/title",
    "https://jobs.apple.com:8443/en-us/search",
    "not a url",
  ])("rejects unsupported custom URL %s", (careersUrl) => {
    expect(() => adapter.normalizeCustomSelection({ careersUrl, label: null })).toThrow();
  });

  it("fetches three filtered pages, maps stable ids, sorts newest and caps at 60", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        search(
          Array.from({ length: 20 }, (_, i) => job(i + 1)),
          100,
        ),
      )
      .mockResolvedValueOnce(
        search(
          Array.from({ length: 20 }, (_, i) => job(i + 21)),
          100,
        ),
      );
    fetchMock.mockResolvedValueOnce(
      search(
        Array.from({ length: 25 }, (_, i) => job(i + 41)),
        100,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 100, fetched: 60 });
    expect(result.jobs[0]).toMatchObject({
      source: "apple",
      sourceType: "apple",
      sourceJobId: "200123456-65",
      title: 'Engineer "special" 65',
      employer: "Apple",
      location: "Cupertino, California, United States",
      jobRef: "https://jobs.apple.com/en-us/details/200123456-65/engineer-65",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(new URL(urls[0]).searchParams.get("page")).toBe("1");
    expect(new URL(urls[1]).searchParams.get("page")).toBe("2");
    expect(
      urls.every(
        (url) =>
          url.includes("search=engineer") &&
          url.includes("sort=newest") &&
          url.includes("location=united-states-USA") &&
          new URL(url).searchParams.get("team") === "SFTWR-CLD HRDWR-ESFD",
      ),
    ).toBe(true);
  });

  it("accepts a real empty result and does not request a second page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(search([], 0));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.fetchJobs({ source })).resolves.toEqual({
      total: 0,
      fetched: 0,
      jobs: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "<html>No hydration</html>",
    '<script>window.__staticRouterHydrationData = JSON.parse("invalid");</script>',
  ])("fails clearly when hydration is missing or malformed", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(/hydration data/);
  });

  it.each([
    { search: {} },
    { search: { totalRecords: 1, searchResults: [] } },
    {
      search: {
        totalRecords: 1,
        searchResults: [{ postingTitle: "Missing id" }],
      },
    },
  ])("fails loudly on changed search structure", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(html(data)));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      /search structure may have changed/,
    );
  });

  it("deduplicates overlapping pages", async () => {
    const jobs = Array.from({ length: 20 }, (_, i) => job(i + 1));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(search(jobs, 50)).mockResolvedValueOnce(search(jobs, 50)),
    );
    expect((await adapter.fetchJobs({ source })).fetched).toBe(20);
  });

  it("retries 429 with bounded backoff then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limit", { status: 429 }))
      .mockResolvedValueOnce(search());
    vi.stubGlobal("fetch", fetchMock);
    expect((await adapter.fetchJobs({ source })).fetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after three retries and does not expose the upstream body", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("secret body", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Apple careers returned HTTP 429.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("passes cancellation to fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      options.signal.throwIfAborted();
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.fetchJobs({ source, signal: controller.signal })).rejects.toThrow();
  });

  it("fetches safe detail HTML and imports complete text with matching source identity", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(search())
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail());
    vi.stubGlobal("fetch", fetchMock);
    const listed = (await adapter.fetchJobs({ source })).jobs[0];
    const details = await adapter.fetchJobDetails({ source, jobRef });
    expect(details.descriptionHtml).toContain("&lt;script&gt;text only&lt;/script&gt;");
    expect(details.descriptionHtml).not.toContain("<script>");
    const result = await adapter.prepareImportDraft({ source, jobRef });
    expect(result).toMatchObject({
      source: listed.source,
      sourceHost: "jobs.apple.com",
      draft: {
        source: listed.source,
        sourceJobId: listed.sourceJobId,
        employer: "Apple",
        jobUrl: jobRef,
        applicationLink: jobRef,
        location: listed.location,
      },
    });
    expect(result.draft.jobDescription).toContain("Three years of experience.");
    expect(result.draft.jobDescription).toContain("Distributed systems.");
    expect(result.draft.jobDescription).toContain('Build "great" products.');
  });

  it("rejects foreign job refs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      adapter.prepareImportDraft({
        source,
        jobRef: "https://evil.test/en-us/details/1/a",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly on missing detail descriptions and mismatched job identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(html({ jobDetails: { jobsData: job() } }))
        .mockResolvedValueOnce(detail()),
    );
    await expect(adapter.prepareImportDraft({ source, jobRef })).rejects.toThrow(
      /detail structure may have changed/,
    );
    await expect(
      adapter.prepareImportDraft({
        source,
        jobRef: jobRef.replace("-1/", "-2/"),
      }),
    ).rejects.toThrow(/different job/);
  });
});
