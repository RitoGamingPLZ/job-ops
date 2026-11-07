import catalog from "@server/config/career-boards-eightfold.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eightfoldWatchlistAdapter as adapter } from "./eightfold";

const microsoft = "https://apply.careers.microsoft.com";
const netflix = "https://explore.jobs.netflix.net";
function source(origin = microsoft): WatchlistSelectedSource {
  return {
    id: "selected",
    catalogSourceId: null,
    label: "Custom search",
    sourceType: "eightfold",
    careersUrl: `${origin}/careers?query=software&location=London&filter_seniority=Senior`,
    cxsJobsUrl: null,
    isCustom: true,
    sortOrder: 0,
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
  };
}
function position(id = 123, postedTs = 1794000000) {
  return {
    id,
    name: `Software Engineer ${id}`,
    locations: ["United Kingdom, London"],
    standardizedLocations: ["London, GB"],
    postedTs,
    jobDescription: "<p>Build &amp; test.</p><p>Apply now.</p>",
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function pcsx(value: unknown) {
  return json({ status: 200, data: value });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("eightfoldWatchlistAdapter", () => {
  it("parses both real catalog entries without throwing", () => {
    const parsed = adapter.parseCatalogSources(catalog);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((entry) => entry.id)).toEqual([
      "eightfold:microsoft",
      "eightfold:netflix",
    ]);
    expect(parsed[0]).toMatchObject({
      label: "Microsoft",
      sourceType: "eightfold",
      cxsJobsUrl: null,
    });
    expect(
      adapter.parseCatalogSources([
        null,
        {},
        { label: "Bad", careersUrl: "https://evil.test/careers" },
      ]),
    ).toEqual([]);
  });

  it.each([
    microsoft,
    netflix,
  ])("canonicalizes %s searches and preserves filters", (origin) => {
    expect(
      adapter.normalizeCustomSelection({
        label: null,
        careersUrl: `${origin}/careers/search/?query=engineer&location=London&filter_team=A&filter_team=B&domain=evil.test&start=100#top`,
      }),
    ).toEqual({
      label: origin === microsoft ? "Microsoft" : "Netflix",
      careersUrl: `${origin}/careers?filter_team=A&filter_team=B&location=London&query=engineer`,
    });
    expect(
      adapter.normalizeCustomSelection({
        label: "My roles",
        careersUrl: `${origin}/careers`,
      }),
    ).toMatchObject({ label: "My roles" });
    const selected = source(origin);
    expect(
      adapter.hydrateSelectedSource({
        ...selected,
        label: selected.careersUrl,
      }),
    ).toMatchObject({
      label: origin === microsoft ? "Microsoft" : "Netflix",
      cxsJobsUrl: null,
    });
  });

  it.each([
    "https://evil.test/careers",
    "https://apply.careers.microsoft.com.evil.test/careers",
    "http://apply.careers.microsoft.com/careers",
    "https://user:password@apply.careers.microsoft.com/careers",
    "https://apply.careers.microsoft.com:444/careers",
    `${microsoft}/api/pcsx/search`,
    `${microsoft}/careers/job/123`,
    "not a URL",
  ])("rejects unsupported custom URL %s", (careersUrl) => {
    expect(() =>
      adapter.normalizeCustomSelection({ label: null, careersUrl }),
    ).toThrow();
  });

  it("maps, sorts and caps Microsoft jobs while forwarding search parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      pcsx({
        count: 99,
        positions: Array.from({ length: 45 }, (_, index) =>
          position(index + 1, 1794000000 + index),
        ),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapter.fetchJobs({ source: source() });
    expect(result.total).toBe(99);
    expect(result.fetched).toBe(40);
    expect(result.jobs[0]).toMatchObject({
      source: "eightfold:microsoft",
      sourceJobId: "45",
      employer: "Microsoft",
      jobRef: `${microsoft}/careers/job/45`,
      jobUrl: `${microsoft}/careers/job/45`,
      applicationLink: `${microsoft}/careers/job/45`,
      location: "London, GB",
      postedAt: new Date(1794000044 * 1000).toISOString(),
    });
    expect(result.jobs.at(-1)?.sourceJobId).toBe("6");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/pcsx/search");
    expect(url.searchParams.has("num")).toBe(false);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      query: "software",
      location: "London",
      filter_seniority: "Senior",
      domain: "microsoft.com",
      sort_by: "timestamp",
      start: "0",
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("paginates PCSX with start offsets to collect 40 jobs", async () => {
    const fetchMock = vi.fn().mockImplementation(async (value: string) => {
      const start = Number(new URL(value).searchParams.get("start"));
      return pcsx({
        count: 100,
        positions: Array.from({ length: 10 }, (_, index) =>
          position(start + index + 1),
        ),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapter.fetchJobs({ source: source() });
    expect(result.fetched).toBe(40);
    expect(
      fetchMock.mock.calls.map(([value]) =>
        new URL(value).searchParams.get("start"),
      ),
    ).toEqual(["0", "10", "20", "30"]);
  });

  it("stops on empty or repeated pages", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        pcsx({ count: 99, positions: [position()] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await adapter.fetchJobs({ source: source() })).fetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps the Netflix apply/v2 fallback and prepares the same job identity", async () => {
    const netflixJob = {
      id: "456",
      name: "Engineer",
      locations: ["Los Gatos, CA"],
      t_create: 1794000000,
      job_description: "<p>Build &amp; test.</p>",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ count: 1, positions: [netflixJob] }))
      .mockResolvedValueOnce(json(netflixJob));
    vi.stubGlobal("fetch", fetchMock);
    const selected = source(netflix);
    const result = await adapter.fetchJobs({ source: selected });
    expect(result.jobs[0]).toMatchObject({
      source: "eightfold:netflix",
      sourceJobId: "456",
      employer: "Netflix",
      location: "Los Gatos, CA",
    });
    const draft = await adapter.prepareImportDraft({
      source: selected,
      jobRef: result.jobs[0].jobRef,
    });
    expect(draft).toMatchObject({
      source: "eightfold:netflix",
      sourceHost: "explore.jobs.netflix.net",
      draft: {
        source: result.jobs[0].source,
        sourceJobId: result.jobs[0].sourceJobId,
        employer: "Netflix",
        jobDescription: "Build & test.",
        jobUrl: result.jobs[0].jobUrl,
      },
    });
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(
      "/api/apply/v2/jobs",
    );
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("num")).toBe(
      "40",
    );
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe(
      "/api/apply/v2/jobs/456",
    );
  });

  it("decodes decimal and hexadecimal entities and preserves escaped entity text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json({
          id: 456,
          name: "Engineer",
          job_description:
            "<p>C&#43;&#x2B; &#128640; &#x1f680; &amp;lt; &amp;#43; &lt; &gt; &amp;</p>",
        }),
      ),
    );
    const result = await adapter.prepareImportDraft({
      source: source(netflix),
      jobRef: `${netflix}/careers/job/456`,
    });
    expect(result.draft.jobDescription).toBe("C++ 🚀 🚀 &lt; &#43; < > &");
  });

  it("fetches Microsoft HTML details and converts import descriptions to text", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => pcsx(position()));
    vi.stubGlobal("fetch", fetchMock);
    const input = { source: source(), jobRef: `${microsoft}/careers/job/123` };
    expect(await adapter.fetchJobDetails(input)).toEqual({
      jobRef: input.jobRef,
      jobUrl: input.jobRef,
      descriptionHtml: position().jobDescription,
    });
    expect(await adapter.prepareImportDraft(input)).toMatchObject({
      source: "eightfold:microsoft",
      sourceHost: "apply.careers.microsoft.com",
      draft: {
        source: "eightfold:microsoft",
        sourceJobId: "123",
        jobDescription: "Build & test.\nApply now.",
      },
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/pcsx/position_details");
    expect(url.searchParams.get("position_id")).toBe("123");
    expect(url.searchParams.get("domain")).toBe("microsoft.com");
  });

  it.each([
    `${netflix}/careers/job/123`,
    "https://evil.test/careers/job/123",
    `${microsoft}/api/123`,
    `${microsoft}/careers/job/123?domain=evil`,
    `${microsoft}/careers/job/abc`,
  ])("rejects foreign or invalid job refs before fetching: %s", async (jobRef) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      adapter.prepareImportDraft({ source: source(), jobRef }),
    ).rejects.toThrow("reference");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isolates simultaneous company searches without singleton state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (value: string) => {
        return new URL(value).hostname === new URL(microsoft).hostname
          ? pcsx({ count: 1, positions: [position()] })
          : json({
              count: 1,
              positions: [{ ...position(456), job_description: "Netflix" }],
            });
      }),
    );
    const [ms, nf] = await Promise.all([
      adapter.fetchJobs({ source: source() }),
      adapter.fetchJobs({ source: source(netflix) }),
    ]);
    expect(ms.jobs[0].source).toBe("eightfold:microsoft");
    expect(nf.jobs[0].source).toBe("eightfold:netflix");
    expect(ms.jobs[0].sourceJobId).toBe("123");
    expect(nf.jobs[0].sourceJobId).toBe("456");
  });

  it("retries 429 responses and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("sensitive upstream body", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(pcsx({ count: 0, positions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      adapter.fetchJobs({ source: source() }),
    ).resolves.toMatchObject({ total: 0, fetched: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds retries and never exposes upstream bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response("secret token", { status: 429 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.fetchJobs({ source: source() })).rejects.toThrow(
      /^Eightfold request failed with HTTP 429\.$/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honors caller cancellation before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.fetchJobs({ source: source(), signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, data: { positions: [] } },
    { status: 403, data: { positions: [], count: 0 }, error: "secret token" },
  ])("rejects malformed or unsuccessful PCSX envelopes safely", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(payload)));
    await expect(adapter.fetchJobs({ source: source() })).rejects.toThrow(
      /^Eightfold returned an invalid response\.$/,
    );
  });

  it("rejects mismatched detail identity and missing descriptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(pcsx(position(456)))
        .mockResolvedValueOnce(pcsx({ id: 123, name: "Engineer" })),
    );
    const input = { source: source(), jobRef: `${microsoft}/careers/job/123` };
    await expect(adapter.prepareImportDraft(input)).rejects.toThrow(
      "different job reference",
    );
    await expect(adapter.prepareImportDraft(input)).rejects.toThrow(
      "description is unavailable",
    );
  });
});
