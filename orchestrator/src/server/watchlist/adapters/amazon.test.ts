import catalog from "@server/config/career-boards-amazon.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, makeSelectedSource } from "../testing/fixtures";
import { amazonWatchlistAdapter as adapter } from "./amazon";

vi.mock("node:timers/promises", async (importOriginal) => {
  const { withFakeTimeouts } = await import("../testing/timers");
  return withFakeTimeouts(await importOriginal<typeof import("node:timers/promises")>());
});

const source = makeSelectedSource({
  id: "selected-amazon",
  label: "Amazon",
  sourceType: "amazon",
  careersUrl:
    "https://www.amazon.jobs/en/search?base_query=software&loc_query=Seattle&category[]=software-development",
  isCustom: true,
  createdAt: "2026-11-06T00:00:00Z",
  updatedAt: "2026-11-06T00:00:00Z",
});
const job = {
  id: "uuid",
  id_icims: "123",
  title: "Software Engineer",
  job_path: "/en/jobs/123/software-engineer",
  company_name: "Amazon Development",
  location: "US, WA, Seattle",
  posted_date: "November 6, 2026",
  description: "<p>Build &amp; ship.</p>",
  basic_qualifications: "<p>TypeScript</p>",
  preferred_qualifications: "<p>Cloud experience</p>",
};
function response(jobs: unknown[] = [job], hits = jobs.length) {
  return jsonResponse({ error: null, hits, jobs });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("amazonWatchlistAdapter", () => {
  it("follows server page offsets until 60 jobs with filters intact", async () => {
    const mock = vi.fn().mockImplementation(async (value: URL) => {
      const offset = Number(value.searchParams.get("offset"));
      expect(value.searchParams.get("base_query")).toBe("software");
      expect(value.searchParams.get("loc_query")).toBe("Seattle");
      return response(
        Array.from({ length: 20 }, (_, i) => ({
          ...job,
          id_icims: String(offset + i + 1),
          job_path: `/en/jobs/${offset + i + 1}/engineer`,
        })),
        100,
      );
    });
    vi.stubGlobal("fetch", mock);
    expect(await adapter.fetchJobs({ source })).toMatchObject({
      total: 100,
      fetched: 60,
    });
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("parses the shipped catalog", () => {
    expect(adapter.parseCatalogSources(catalog)).toEqual([
      {
        id: "amazon:software-development",
        label: "Amazon software development",
        sourceType: "amazon",
        cxsJobsUrl: null,
        careersUrl:
          "https://www.amazon.jobs/en/search?category%5B%5D=software-development&sort=recent",
      },
    ]);
    expect(adapter.parseCatalogSources([])).toEqual([]);
  });
  it("canonicalizes custom searches, preserving filters and resetting pagination", async () => {
    const normalized = await adapter.normalizeCustomSelection({
      label: " Seattle ",
      careersUrl:
        "https://amazon.jobs/en/search/?base_query=engineer&loc_query=Seattle&offset=80&result_limit=100&sort=relevant#jobs",
    });
    expect(normalized).toEqual({
      label: "Seattle",
      careersUrl:
        "https://www.amazon.jobs/en/search?base_query=engineer&loc_query=Seattle&sort=recent",
    });
    expect(
      adapter.hydrateSelectedSource({
        ...source,
        careersUrl: normalized.careersUrl,
      }),
    ).toMatchObject({ careersUrl: normalized.careersUrl, cxsJobsUrl: null });
    expect(
      await adapter.normalizeCustomSelection({
        label: " ",
        careersUrl: source.careersUrl,
      }),
    ).toMatchObject({ label: "Amazon" });
  });
  it.each([
    "https://amazon.jobs.evil.test/en/search",
    "http://www.amazon.jobs/en/search",
    "https://www.amazon.jobs/en/jobs/123",
  ])("rejects unsupported search URL %s", (careersUrl) => {
    expect(() => adapter.normalizeCustomSelection({ label: null, careersUrl })).toThrow();
  });
  it("maps identities and dates, sorts newest first, and caps at 60", async () => {
    const jobs = Array.from({ length: 65 }, (_, i) => ({
      ...job,
      id_icims: String(i + 1),
      job_path: `/en/jobs/${i + 1}/role`,
      posted_date: new Date(Date.UTC(2026, 0, i + 1)).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue(response(jobs, 1000));
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 1000, fetched: 60 });
    expect(result.jobs[0]).toMatchObject({
      jobRef: "65",
      source: "amazon",
      sourceJobId: "65",
      sourceType: "amazon",
      title: job.title,
      employer: job.company_name,
      location: job.location,
    });
    expect(result.jobs.at(-1)?.sourceJobId).toBe("6");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/en/search.json");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      base_query: "software",
      loc_query: "Seattle",
      "category[]": "software-development",
      offset: "0",
      result_limit: "60",
      sort: "recent",
    });
  });
  it.each(["America/Los_Angeles", "Asia/Tokyo"])(
    "parses posted dates as UTC in %s",
    async (timezone) => {
      vi.stubEnv("TZ", timezone);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
      const result = await adapter.fetchJobs({ source });
      expect(result.jobs[0].postedAt).toBe("2026-11-06T00:00:00.000Z");
    },
  );
  it("skips malformed entries in search and exact-ID re-queries", async () => {
    const entries = [
      null,
      { ...job, title: null },
      { ...job, job_path: "https://evil.test/en/jobs/123/role" },
      job,
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(response(entries))),
    );
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({
      total: 4,
      fetched: 1,
      jobs: [{ sourceJobId: "123" }],
    });
    await expect(adapter.fetchJobDetails({ source, jobRef: "123" })).resolves.toMatchObject({
      jobRef: "123",
      jobUrl: "https://www.amazon.jobs/en/jobs/123/software-engineer",
    });
    await expect(adapter.prepareImportDraft({ source, jobRef: "123" })).resolves.toMatchObject({
      draft: { sourceJobId: "123" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(entries.slice(0, 3))));
    await expect(adapter.prepareImportDraft({ source, jobRef: "123" })).rejects.toThrow(
      "not found",
    );
  });
  it("re-queries the exact ID independently of source filters for details and import", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    const details = await adapter.fetchJobDetails({ source, jobRef: "123" });
    expect(details.descriptionHtml).toContain("<h2>Basic qualifications</h2><p>TypeScript</p>");
    expect(details.descriptionHtml).toContain("Preferred qualifications");
    const result = await adapter.prepareImportDraft({ source, jobRef: "123" });
    expect(result).toMatchObject({
      source: "amazon",
      sourceHost: "www.amazon.jobs",
      draft: {
        source: "amazon",
        sourceJobId: "123",
        title: job.title,
        jobUrl: "https://www.amazon.jobs/en/jobs/123/software-engineer",
        jobDescription: expect.stringContaining("Build & ship."),
      },
    });
    expect(result.draft.jobDescription).toContain("Cloud experience");
    for (const [url] of fetchMock.mock.calls) {
      expect(url.searchParams.get("base_query")).toBe("123");
      expect(url.searchParams.has("loc_query")).toBe(false);
    }
  });
  it("rejects missing exact IDs and drops unsafe upstream job URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(
          response([{ ...job, job_path: "https://evil.test/en/jobs/123/role" }]),
        ),
    );
    await expect(adapter.prepareImportDraft({ source, jobRef: "999" })).rejects.toThrow(
      "not found",
    );
    await expect(adapter.fetchJobs({ source })).resolves.toMatchObject({
      total: 1,
      fetched: 0,
      jobs: [],
    });
    await expect(adapter.fetchJobDetails({ source, jobRef: "https://evil.test" })).rejects.toThrow(
      "reference",
    );
  });
  it("backs off on 429, stopping after three attempts without leaking upstream bodies", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("sensitive upstream body", { status: 429 })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const pending = adapter.fetchJobs({ source }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 429");
    expect((error as Error).message).not.toContain("sensitive upstream body");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("retries a transient 429 and respects cancellation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetchMock);
    const pending = adapter.fetchJobs({ source });
    await vi.runAllTimersAsync();
    expect((await pending).fetched).toBe(1);
    await expect(adapter.fetchJobs({ source, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
