import timers from "node:timers/promises";
import catalog from "@server/config/career-boards-ashby.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistCatalogSourceAdapter } from "./types";

let adapter: WatchlistCatalogSourceAdapter;
const source: WatchlistSelectedSource = {
  id: "ashby-test",
  catalogSourceId: "ashby:linear",
  label: "Linear",
  sourceType: "ashby",
  careersUrl: "https://jobs.ashbyhq.com/linear",
  cxsJobsUrl: null,
  isCustom: false,
  sortOrder: 0,
  createdAt: "2026-11-07",
  updatedAt: "2026-11-07",
};
function job(id = "posting-1") {
  return {
    id,
    title: " Software Engineer ",
    location: "New York",
    secondaryLocations: [{ location: "London" }],
    department: "Engineering",
    team: "Product",
    employmentType: "FullTime",
    isRemote: true,
    isListed: true,
    publishedAt: "2026-11-07T00:00:00Z",
    jobUrl: `${source.careersUrl}/${id}`,
    applyUrl: `${source.careersUrl}/${id}/application`,
    descriptionHtml: "<p>Build &amp; ship</p>",
    descriptionPlain: "Build & ship",
    compensation: { compensationTierSummary: "$100K" },
  };
}
function list(jobs: unknown[] = [job()]) {
  return new Response(JSON.stringify({ jobs, apiVersion: "1" }));
}
function stub(...responses: Response[]) {
  const mock = vi.fn();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}
function detail(id = "posting-1", multipleLocations = false) {
  const place = {
    address: { addressLocality: "New York", addressCountry: "US" },
  };
  return new Response(
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      identifier: { value: id },
      title: "Software Engineer",
      description: "<p>Build &amp; ship</p>",
      datePosted: "2026-11-07",
      employmentType: "FULL_TIME",
      jobLocation: multipleLocations
        ? [place, { address: { addressLocality: "London" } }]
        : place,
    })}</script>`,
  );
}
beforeEach(async () => {
  vi.resetModules();
  adapter = (await import("./ashby")).ashbyWatchlistAdapter;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ashbyWatchlistAdapter", () => {
  it("parses the shipped catalog and skips malformed rows without throwing", () => {
    const parsed = adapter.parseCatalogSources(catalog);
    expect(parsed).toHaveLength(7);
    expect(parsed.map((row) => row.id)).toContain("ashby:linear");
    for (const row of catalog)
      expect(adapter.catalogSchema.safeParse(row).success).toBe(true);
    expect(
      adapter.parseCatalogSources([
        null,
        {},
        { label: "Bad", ashbyUrl: "https://evil.test/foo" },
      ]),
    ).toEqual([]);
  });
  it.each([
    "/Linear",
    "/linear/posting-1",
    "/linear/posting-1/application?utm_source=test#apply",
  ])("normalizes and validates %s with one board GET", async (path) => {
    const mock = stub(list());
    expect(
      await adapter.normalizeCustomSelection({
        careersUrl: `https://jobs.ashbyhq.com${path}`,
        label: " Custom ",
      }),
    ).toEqual({ label: "Custom", careersUrl: source.careersUrl });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/linear",
    );
    expect(mock.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });
  it.each([
    "http://jobs.ashbyhq.com/linear",
    "https://jobs.ashbyhq.com.evil.test/linear",
    "https://evil.test/linear",
    "https://user@jobs.ashbyhq.com/linear",
    "https://jobs.ashbyhq.com:443/linear",
    "https://jobs.ashbyhq.com/",
    "https://jobs.ashbyhq.com/linear/id/other",
    "https://jobs.ashbyhq.com/%2fsecret",
    "bad",
  ])("rejects unsafe URL %s without fetching", async (careersUrl) => {
    const mock = stub();
    await expect(
      adapter.normalizeCustomSelection({ careersUrl, label: null }),
    ).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("uses company fallback labels and hydrates canonically", async () => {
    stub(list([]));
    expect(
      await adapter.normalizeCustomSelection({
        careersUrl: source.careersUrl,
        label: source.careersUrl,
      }),
    ).toEqual({ label: "linear", careersUrl: source.careersUrl });
    expect(
      adapter.hydrateSelectedSource({
        ...source,
        label: "",
        careersUrl: `${source.careersUrl}/posting-1`,
      }),
    ).toMatchObject({
      label: "linear",
      careersUrl: source.careersUrl,
      cxsJobsUrl: null,
    });
    expect(adapter.descriptor.supportsCustomSource).toBe(true);
  });
  it("maps list fields and reuses descriptions for details/import without extra requests", async () => {
    const mock = stub(list());
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [
        {
          jobRef: job().jobUrl,
          source: "ashby:linear",
          sourceJobId: "posting-1",
          sourceType: "ashby",
          title: "Software Engineer",
          employer: "Linear",
          location: "New York; London",
          applicationLink: job().applyUrl,
          postedAt: job().publishedAt,
        },
      ],
    });
    expect(
      (await adapter.fetchJobDetails({ source, jobRef: result.jobs[0].jobRef }))
        .descriptionHtml,
    ).toBe(job().descriptionHtml);
    expect(
      await adapter.prepareImportDraft({
        source,
        jobRef: result.jobs[0].jobRef,
      }),
    ).toMatchObject({
      source: "ashby:linear",
      sourceHost: "jobs.ashbyhq.com",
      draft: {
        source: "ashby:linear",
        sourceJobId: "posting-1",
        jobDescription: "Build & ship",
        jobType: "FullTime",
      },
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("sorts newest first, excludes unlisted jobs, deduplicates and caps at 60", async () => {
    const jobs = Array.from({ length: 65 }, (_, i) => ({
      ...job(`id-${i}`),
      publishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }));
    stub(list([...jobs, jobs[0], { ...job("hidden"), isListed: false }]));
    const result = await adapter.fetchJobs({ source });
    expect(result.fetched).toBe(60);
    expect(result.jobs[0].sourceJobId).toBe("id-64");
    expect(result.jobs[59].sourceJobId).toBe("id-5");
  });
  it("accepts empty boards and rejects malformed responses without exposing bodies", async () => {
    stub(
      list([]),
      new Response('{"secret":"private"}'),
      new Response("secret", { status: 502 }),
    );
    expect(await adapter.fetchJobs({ source })).toEqual({
      total: 0,
      fetched: 0,
      jobs: [],
    });
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      /structure may have changed/,
    );
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Ashby returned HTTP 502.",
    );
  });
  it("fetches only the requested posting on a cache miss and checks its ID", async () => {
    const mock = stub(detail(), detail("wrong"));
    expect(
      (await adapter.prepareImportDraft({ source, jobRef: job().jobUrl }))
        .draft,
    ).toMatchObject({
      source: "ashby:linear",
      sourceJobId: "posting-1",
      jobDescription: "Build & ship",
      location: "New York, US",
    });
    expect(mock.mock.calls[0][0]).toBe(job().jobUrl);
    await expect(
      adapter.fetchJobDetails({ source, jobRef: job().jobUrl }),
    ).rejects.toThrow(/structure may have changed/);
  });
  it("accepts JSON-LD location arrays on a cache miss", async () => {
    const mock = stub(detail("posting-1", true));
    expect(
      (await adapter.prepareImportDraft({ source, jobRef: job().jobUrl })).draft
        .location,
    ).toBe("New York, US; London");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("replaces only the fetched company's cache and isolates identical posting IDs", async () => {
    const other = {
      ...source,
      label: "Notion",
      careersUrl: "https://jobs.ashbyhq.com/notion",
    };
    const mock = stub(list(), detail(), list([]), detail());
    await adapter.fetchJobs({ source });
    const result = await adapter.prepareImportDraft({
      source: other,
      jobRef: "https://jobs.ashbyhq.com/notion/posting-1",
    });
    expect(result.draft).toMatchObject({
      source: "ashby:notion",
      employer: "Notion",
    });
    expect(mock.mock.calls[1][0]).toContain("/notion/posting-1");
    await adapter.fetchJobs({ source });
    await adapter.prepareImportDraft({ source, jobRef: job().jobUrl });
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it("retains company A's cached description after fetching company B", async () => {
    const other = {
      ...source,
      label: "Notion",
      careersUrl: "https://jobs.ashbyhq.com/notion",
    };
    const mock = stub(
      list(),
      list([
        {
          ...job(),
          jobUrl: `${other.careersUrl}/posting-1`,
          applyUrl: `${other.careersUrl}/posting-1/application`,
          descriptionPlain: "Notion description",
        },
      ]),
    );
    await adapter.fetchJobs({ source });
    await adapter.fetchJobs({ source: other });
    expect(
      (await adapter.prepareImportDraft({ source, jobRef: job().jobUrl }))
        .draft,
    ).toMatchObject({ employer: "Linear", jobDescription: "Build & ship" });
    expect(
      (
        await adapter.prepareImportDraft({
          source: other,
          jobRef: `${other.careersUrl}/posting-1`,
        })
      ).draft,
    ).toMatchObject({
      employer: "Notion",
      jobDescription: "Notion description",
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("skips malformed and foreign-URL rows while keeping valid postings", async () => {
    stub(
      list([
        null,
        {},
        { ...job(), title: 123 },
        { ...job(), jobUrl: "https://evil.test/posting-1" },
        { ...job(), applyUrl: "https://evil.test/posting-1" },
        { ...job(), jobUrl: "https://jobs.ashbyhq.com/notion/posting-1" },
        { ...job(), applyUrl: "https://jobs.ashbyhq.com/notion/posting-1" },
        { ...job(), jobUrl: `${source.careersUrl}/wrong-id` },
        job(),
      ]),
      list([{ ...job(), isListed: false }]),
    );
    expect(await adapter.fetchJobs({ source })).toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [{ sourceJobId: "posting-1" }],
    });
    expect(await adapter.fetchJobs({ source })).toMatchObject({
      total: 0,
      fetched: 0,
      jobs: [],
    });
  });
  it("rejects cross-company job refs and API links", async () => {
    const mock = stub(
      list([{ ...job(), jobUrl: "https://evil.test/posting-1" }]),
    );
    await expect(
      adapter.prepareImportDraft({
        source,
        jobRef: "https://jobs.ashbyhq.com/notion/posting-1",
      }),
    ).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      /structure may have changed/,
    );
  });
  it("converts HTML when plaintext is absent and escapes plaintext for details", async () => {
    stub(
      list([{ ...job(), descriptionPlain: undefined, isRemote: null }]),
      list([
        {
          ...job(),
          descriptionHtml: undefined,
          descriptionPlain: "<text> & safe",
        },
      ]),
    );
    await adapter.fetchJobs({ source });
    expect(
      (await adapter.prepareImportDraft({ source, jobRef: job().jobUrl })).draft
        .jobDescription,
    ).toBe("Build & ship");
    await adapter.fetchJobs({ source });
    expect(
      (await adapter.fetchJobDetails({ source, jobRef: job().jobUrl }))
        .descriptionHtml,
    ).toContain("&lt;text&gt; &amp; safe");
  });
  it("honors Retry-After and stops after three retries", async () => {
    const mock = stub(
      ...Array.from(
        { length: 4 },
        () =>
          new Response("secret", {
            status: 429,
            headers: { "retry-after": "0" },
          }),
      ),
    );
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Ashby returned HTTP 429.",
    );
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it("uses 1s/3s/8s fallback backoff", async () => {
    vi.useFakeTimers();
    // Bridge Node's promise timer to Vitest's fake global clock.
    vi.spyOn(timers, "setTimeout").mockImplementation(
      <T = void>(ms?: number, value?: T) =>
        new Promise<T>((resolve) => setTimeout(() => resolve(value as T), ms)),
    );
    const mock = stub(
      ...Array.from({ length: 3 }, () => new Response("", { status: 429 })),
      list(),
    );
    const pending = adapter.fetchJobs({ source });
    await vi.advanceTimersByTimeAsync(0);
    expect(mock).toHaveBeenCalledTimes(1);
    for (const [index, wait] of [1000, 3000, 8000].entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(mock).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock).toHaveBeenCalledTimes(index + 2);
    }
    expect((await pending).fetched).toBe(1);
    expect(
      mock.mock.calls.every(
        (call) => call[1].signal === mock.mock.calls[0][1].signal,
      ),
    ).toBe(true);
  });
  it("combines the 25s budget with caller cancellation, including cached details", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const mock = stub(list());
    await adapter.fetchJobs({ source });
    expect(timeout).toHaveBeenCalledWith(25000);
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.fetchJobs({ source, signal: controller.signal }),
    ).rejects.toThrow();
    await expect(
      adapter.prepareImportDraft({
        source,
        jobRef: job().jobUrl,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
