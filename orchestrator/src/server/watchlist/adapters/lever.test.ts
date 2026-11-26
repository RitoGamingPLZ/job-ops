import catalog from "@server/config/career-boards-lever.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistCatalogSourceAdapter } from "./types";

let adapter: WatchlistCatalogSourceAdapter;
beforeEach(async () => {
  vi.resetModules();
  adapter = (await import("./lever")).leverWatchlistAdapter;
});
afterEach(() => {
  vi.doUnmock("node:timers/promises");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const base = "https://jobs.lever.co/spotify";
const source: WatchlistSelectedSource = {
  id: "selected-lever",
  catalogSourceId: "lever:spotify",
  label: "Spotify",
  sourceType: "lever",
  careersUrl: base,
  cxsJobsUrl: null,
  isCustom: false,
  sortOrder: 0,
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-07T00:00:00Z",
};
function job(id = "posting-1", createdAt = 1700000000000) {
  return {
    id,
    text: `Engineer ${id}`,
    createdAt,
    categories: {
      location: "London",
      allLocations: ["London", "New York", "London"],
      team: "Engineering",
      commitment: "Full-time",
    },
    hostedUrl: `${base}/${id}`,
    applyUrl: `${base}/${id}/apply`,
    description: "<p>Build &amp; maintain music services.</p>",
    descriptionPlain: "Build & maintain music services.",
    lists: [
      {
        text: "Requirements <skills>",
        content: "<ul><li>TypeScript</li></ul>",
      },
    ],
    additional: "<p>Equal opportunities.</p>",
  };
}
function json(data: unknown) {
  return new Response(JSON.stringify(data));
}

describe("leverWatchlistAdapter", () => {
  it("parses its real catalog and ignores malformed entries", () => {
    const sources = adapter.parseCatalogSources(catalog);
    expect(sources.map((s) => s.id)).toEqual([
      "lever:spotify",
      "lever:palantir",
      "lever:zoox",
      "lever:gopuff",
    ]);
    expect(sources.every((s) => s.sourceType === "lever" && s.cxsJobsUrl === null)).toBe(true);
    expect(
      adapter.parseCatalogSources([
        null,
        {},
        { label: "Bad", careersUrl: "https://evil.test/spotify" },
      ]),
    ).toEqual([]);
    expect(adapter.descriptor.supportsCustomSource).toBe(true);
  });
  it.each([`${base}/`, `${base}/posting-1`, `${base}/posting-1/apply?source=ref#apply`])(
    "normalizes a board/posting/apply URL with one validation GET: %s",
    async (careersUrl) => {
      const mock = vi.fn().mockResolvedValue(json([job()]));
      vi.stubGlobal("fetch", mock);
      expect(
        await adapter.normalizeCustomSelection({
          careersUrl,
          label: " Spotify Music ",
        }),
      ).toEqual({ careersUrl: base, label: "Spotify Music" });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][0]).toBe(
        "https://api.lever.co/v0/postings/spotify?mode=json&limit=1",
      );
      expect(mock.mock.calls[0][1]).toMatchObject({
        redirect: "manual",
        signal: expect.any(AbortSignal),
      });
    },
  );
  it("accepts a valid empty company board, defaults the label, and supports EU", async () => {
    const mock = vi.fn().mockImplementation(async () => json([]));
    vi.stubGlobal("fetch", mock);
    expect(await adapter.normalizeCustomSelection({ careersUrl: base, label: base })).toEqual({
      careersUrl: base,
      label: "spotify",
    });
    expect(
      await adapter.normalizeCustomSelection({
        careersUrl: "https://jobs.eu.lever.co/acme/job-1/apply",
        label: null,
      }),
    ).toEqual({ careersUrl: "https://jobs.eu.lever.co/acme", label: "acme" });
    expect(mock.mock.calls[1][0]).toBe(
      "https://api.eu.lever.co/v0/postings/acme?mode=json&limit=1",
    );
    expect(
      adapter.hydrateSelectedSource({
        ...source,
        label: " ",
        careersUrl: `${base}/posting-1`,
      }),
    ).toMatchObject({ label: "spotify", careersUrl: base, cxsJobsUrl: null });
  });
  it.each([
    "not a url",
    "http://jobs.lever.co/spotify",
    "https://jobs.lever.co.evil.test/spotify",
    "https://evil.test/spotify",
    "https://api.lever.co/spotify",
    "https://jobs.lever.co:443/spotify",
    "https://jobs.lever.co:8443/spotify",
    "https://user:pass@jobs.lever.co/spotify",
    "https://@jobs.lever.co/spotify",
    "https://jobs.lever.co/",
    "https://jobs.lever.co/%2fsecret",
    `${base}/job/other`,
    `${base}/job/apply/extra`,
  ])("rejects an unsafe custom URL before fetching: %s", async (careersUrl) => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(adapter.normalizeCustomSelection({ careersUrl, label: null })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("validates the company against the API and hides upstream bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("secret response body", { status: 404 })),
    );
    await expect(
      adapter.normalizeCustomSelection({ careersUrl: base, label: null }),
    ).rejects.toThrow("Lever returned HTTP 404.");
  });
  it("sorts newest first before capping, deduplicates and maps identity consistently", async () => {
    const rows = Array.from({ length: 65 }, (_, i) => job(`job-${i}`, 1700000000000 + i));
    const mock = vi.fn().mockResolvedValue(json([...rows, rows[0]]));
    vi.stubGlobal("fetch", mock);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 65, fetched: 60 });
    expect(result.jobs[0]).toEqual({
      jobRef: `${base}/job-64`,
      source: "lever:spotify",
      sourceJobId: "job-64",
      sourceType: "lever",
      title: "Engineer job-64",
      employer: "Spotify",
      jobUrl: `${base}/job-64`,
      applicationLink: `${base}/job-64/apply`,
      location: "London; New York",
      postedAt: new Date(1700000000064).toISOString(),
    });
    expect(result.jobs[59].sourceJobId).toBe("job-5");
    const detail = await adapter.fetchJobDetails({
      source,
      jobRef: result.jobs[0].jobRef,
    });
    const imported = await adapter.prepareImportDraft({
      source,
      jobRef: result.jobs[0].jobRef,
    });
    expect(detail.descriptionHtml).toContain("Requirements &lt;skills&gt;");
    expect(imported).toMatchObject({
      source: "lever:spotify",
      sourceHost: "jobs.lever.co",
      draft: {
        source: "lever:spotify",
        sourceJobId: "job-64",
        title: "Engineer job-64",
        employer: "Spotify",
        applicationLink: `${base}/job-64/apply`,
        jobType: "Full-time",
      },
    });
    expect(imported.draft.jobDescription).toContain("Build & maintain music services.");
    expect(imported.draft.jobDescription).toContain("TypeScript");
    expect(imported.draft.jobDescription).toContain("Equal opportunities.");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("handles empty boards, optional fields and plain text descriptions", async () => {
    const minimal = {
      id: "minimal",
      text: "Engineer",
      descriptionPlain: "Use <code> & tools",
      additionalPlain: "Join <us>",
    };
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([minimal]));
    vi.stubGlobal("fetch", mock);
    expect(await adapter.fetchJobs({ source })).toEqual({
      total: 0,
      fetched: 0,
      jobs: [],
    });
    const result = await adapter.fetchJobs({ source });
    expect(result.jobs[0]).toMatchObject({
      location: null,
      postedAt: null,
      jobUrl: `${base}/minimal`,
      applicationLink: `${base}/minimal/apply`,
    });
    const imported = await adapter.prepareImportDraft({
      source,
      jobRef: result.jobs[0].jobRef,
    });
    expect(imported.draft.jobDescription).toContain("Use <code> & tools");
    expect(imported.draft.jobDescription).toContain("Join <us>");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("fetches exactly one posting on a cache miss", async () => {
    const mock = vi.fn().mockResolvedValue(json(job()));
    vi.stubGlobal("fetch", mock);
    await adapter.prepareImportDraft({ source, jobRef: `${base}/posting-1` });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.lever.co/v0/postings/spotify/posting-1?mode=json",
    );
  });
  it("keeps both companies cached after fetching all boards, even for identical posting IDs", async () => {
    const other = {
      ...source,
      label: "Palantir",
      careersUrl: "https://jobs.lever.co/palantir",
    };
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json([job()]))
      .mockResolvedValueOnce(json([{ ...job(), text: "Palantir Engineer" }]));
    vi.stubGlobal("fetch", mock);
    await adapter.fetchJobs({ source });
    await adapter.fetchJobs({ source: other });
    expect(
      (
        await adapter.prepareImportDraft({
          source: other,
          jobRef: `${other.careersUrl}/posting-1`,
        })
      ).draft.title,
    ).toBe("Palantir Engineer");
    expect(
      (
        await adapter.prepareImportDraft({
          source,
          jobRef: `${base}/posting-1`,
        })
      ).draft.title,
    ).toBe("Engineer posting-1");
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("replaces only the refreshed company's cache and removes stale postings", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json([job()]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ ...job(), text: "Updated posting" }));
    vi.stubGlobal("fetch", mock);
    await adapter.fetchJobs({ source });
    await adapter.fetchJobs({ source });
    const imported = await adapter.prepareImportDraft({
      source,
      jobRef: `${base}/posting-1`,
    });
    expect(imported.draft.title).toBe("Updated posting");
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it("rejects foreign job refs before fetching", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    for (const jobRef of [
      "https://evil.test/id",
      "https://jobs.lever.co/palantir/posting-1",
      base,
      "https://jobs.eu.lever.co/spotify/posting-1",
    ])
      await expect(adapter.fetchJobDetails({ source, jobRef })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("pins upstream posting and apply URLs to the company", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json([
          {
            ...job(),
            hostedUrl: "https://evil.test/id",
            applyUrl: "https://jobs.lever.co/other/id/apply",
          },
        ]),
      ),
    );
    const result = await adapter.fetchJobs({ source });
    expect(result.jobs[0]).toMatchObject({
      jobUrl: `${base}/posting-1`,
      applicationLink: `${base}/posting-1/apply`,
    });
  });
  it.each([{}, [{ id: "x" }], [{ ...job(), createdAt: 9e15 }]])(
    "rejects malformed list payloads",
    async (data) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(data)));
      await expect(adapter.fetchJobs({ source })).rejects.toThrow(
        "Lever returned invalid board data.",
      );
    },
  );
  it("rejects malformed JSON and mismatched detail IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("not JSON"))
        .mockResolvedValueOnce(json(job("wrong"))),
    );
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Lever returned invalid JSON.");
    await expect(
      adapter.prepareImportDraft({ source, jobRef: `${base}/posting-1` }),
    ).rejects.toThrow("Lever returned invalid posting data.");
  });
  it("retries 429 three times with 1s/3s/8s backoff", async () => {
    vi.useFakeTimers();
    // Native promise timers need a wrapper to use Vitest's fake clock.
    vi.doMock("node:timers/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:timers/promises")>();
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      return {
        ...actual,
        setTimeout: delay,
        default: { ...actual, setTimeout: delay },
      };
    });
    vi.resetModules();
    adapter = (await import("./lever")).leverWatchlistAdapter;
    const start = Date.now();
    const attempts: number[] = [];
    const mock = vi.fn().mockImplementation(async () => {
      attempts.push(Date.now() - start);
      return new Response("secret", { status: 429 });
    });
    vi.stubGlobal("fetch", mock);
    const pending = expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Lever returned HTTP 429.",
    );
    await vi.advanceTimersByTimeAsync(12_000);
    await pending;
    expect(mock).toHaveBeenCalledTimes(4);
    expect(attempts).toEqual([0, 1000, 4000, 12000]);
  });
  it.each(["0", new Date(0).toUTCString()])("honors Retry-After %s", async (header) => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": header } }))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", mock);
    expect((await adapter.fetchJobs({ source })).fetched).toBe(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("propagates caller cancellation and interrupts long Retry-After waits", async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "100" } }));
    vi.stubGlobal("fetch", mock);
    await expect(adapter.fetchJobs({ source, signal: controller.signal })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
    const next = new AbortController();
    const pending = adapter.fetchJobs({ source, signal: next.signal });
    setTimeout(() => next.abort(), 20);
    await expect(pending).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("never caches workspace labels with public postings", async () => {
    const mock = vi.fn().mockResolvedValue(json([job()]));
    vi.stubGlobal("fetch", mock);
    await adapter.fetchJobs({
      source: { ...source, label: "Workspace A label" },
    });
    const imported = await adapter.prepareImportDraft({
      source: { ...source, label: "Workspace B label" },
      jobRef: `${base}/posting-1`,
    });
    expect(imported.draft.employer).toBe("Workspace B label");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("applies the 25 second budget to retry waits even without a caller signal", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "100" } })),
    );
    const pending = adapter.fetchJobs({ source });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();
    expect(timeout).toHaveBeenCalledWith(25000);
  });
  it("paces concurrent requests to the public API host at least one second apart", async () => {
    const starts: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        starts.push(Date.now());
        return json([]);
      }),
    );
    await Promise.all([
      adapter.normalizeCustomSelection({ careersUrl: base, label: null }),
      adapter.fetchJobs({ source }),
    ]);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(990);
  });
});

it("normalizes repeated URL filters, drops unknowns, and preserves posting links/imports", async () => {
  const careersUrl = `${base}?team=Z&location=New%20York&location=London&location=London&department=Engineering&team=A&unknown=drop`;
  const canonical = `${base}?department=Engineering&location=London&location=New+York&team=A&team=Z`;
  const mock = vi
    .fn()
    .mockImplementation(async () =>
      json(Array.from({ length: 105 }, (_, i) => job(`filter-${i}`, i))),
    );
  vi.stubGlobal("fetch", mock);
  expect(await adapter.normalizeCustomSelection({ careersUrl, label: null })).toMatchObject({
    careersUrl: canonical,
  });
  expect(mock.mock.calls[0][0]).toBe(
    "https://api.lever.co/v0/postings/spotify?mode=json&department=Engineering&location=London&location=New+York&team=A&team=Z&limit=1",
  );
  const catalog = adapter.parseCatalogSources([{ label: "Spotify", careersUrl }]);
  expect(catalog[0].id).toBe(`lever:spotify${new URL(canonical).search}`);
  expect(adapter.parseCatalogSources([{ label: "Spotify", careersUrl: canonical }])[0].id).toBe(
    catalog[0].id,
  );
  const filtered = { ...source, careersUrl: canonical };
  const result = await adapter.fetchJobs({ source: filtered });
  expect(result).toMatchObject({ total: 105, fetched: 60 });
  expect(mock.mock.calls[1][0]).toBe(
    "https://api.lever.co/v0/postings/spotify?mode=json&department=Engineering&location=London&location=New+York&team=A&team=Z",
  );
  expect(result.jobs[0].jobRef).toBe(`${base}/filter-104`);
  expect(
    (
      await adapter.prepareImportDraft({
        source: filtered,
        jobRef: result.jobs[0].jobRef,
      })
    ).draft.jobUrl,
  ).toBe(`${base}/filter-104`);
  expect(mock).toHaveBeenCalledTimes(2);
});
