import catalog from "@server/config/career-boards-google.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistCatalogSourceAdapter } from "./types";

let adapter: WatchlistCatalogSourceAdapter;
beforeEach(async () => {
  vi.resetModules();
  adapter = (await import("./google")).googleWatchlistAdapter;
});

const base = "https://www.google.com/about/careers/applications/jobs/results/";
const source: WatchlistSelectedSource = {
  id: "selected-google",
  catalogSourceId: "google:google",
  label: "Google",
  sourceType: "google",
  careersUrl: `${base}?q=software+engineer&location=London`,
  cxsJobsUrl: null,
  isCustom: false,
  sortOrder: 0,
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-07T00:00:00Z",
};

// Trimmed real 2026-11-07 response. Keep the positional layout, callback syntax,
// and representative HTML; omit long prose, apply URL query and address details.
const realJob = [
  "79008891555193542",
  "Technical Program Manager, Infrastructure Deployment Software",
  "https://www.google.com/about/careers/applications/signin",
  [
    null,
    "<ul>\n<li>Drive roadmap planning, milestone definition, resource allocation, and risk management across multi-quarter, multi-team engineering programs with minimal supervision.</li>\n</ul>",
  ],
  [
    null,
    "<h3>Minimum qualifications:</h3><ul>\n<li>Bachelor's degree in a technical field, or equivalent practical experience. <br></li>\n</ul>",
  ],
  "projects/gweb-careers-proto/tenants/example/companies/example",
  null,
  "Google",
  "en-US",
  [
    [
      "Sunnyvale, CA, USA",
      ["237 Moffett Park Dr, Sunnyvale, CA 94089, USA"],
      "Sunnyvale",
      "94089",
      "CA",
      "US",
    ],
  ],
  [
    null,
    "<p>Google's projects, like our users, span the globe and require managers to keep the big picture in focus while being able to dive into the unique engineering challenges we face daily.</p>",
  ],
  [2],
  [1794004883, 101000000],
  [1794004883, 101000000],
  [1794004883, 353000000],
  [null, ""],
  null,
  null,
  [null, ""],
  [null, "<ul><li>Bachelor's degree</li></ul>"],
  3,
];
function callback(data: unknown, key = "ds:1") {
  return `<script class="ds:1" nonce="example">AF_initDataCallback({key: '${key}', hash: '2', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
}
const realListHtml = `<!doctype html><html><body>${callback([[["unrelated company"]]], "ds:0")}${callback([[realJob], null, 1420, 20])}</body></html>`;
const jobRef = `${base}79008891555193542-technical-program-manager-infrastructure-deployment-software`;
function job(index: number) {
  return [String(index), `Software Engineer, AI/ML ${index}`, ...realJob.slice(2)];
}
function list(jobs: unknown[] | null = [realJob], total = jobs?.length ?? 0) {
  return new Response(callback([jobs, null, total, 20]));
}
function detail(record: unknown = realJob) {
  return new Response(callback([record], "ds:0"));
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("googleWatchlistAdapter", () => {
  it("parses its shipped catalog without throwing, and skips invalid entries", () => {
    expect(adapter.parseCatalogSources(catalog)).toEqual([
      {
        id: "google:google",
        label: "Google - Software Engineering",
        sourceType: "google",
        cxsJobsUrl: null,
        careersUrl: `${base}?q=software+engineer&sort_by=date`,
      },
    ]);
    expect(adapter.catalogSchema.safeParse(catalog[0]).success).toBe(true);
    expect(
      adapter.parseCatalogSources([null, {}, { label: "Bad", careersUrl: "https://evil.test/" }]),
    ).toEqual([]);
  });
  it("keeps supported repeated filters, removes paging and enforces newest first", () => {
    expect(
      adapter.normalizeCustomSelection({
        label: " Engineering ",
        careersUrl: `${base}?q=engineer&location=London&target_level=MID&target_level=ADVANCED&employment_type=FULL_TIME&degree=BACHELORS&sort_by=relevance&page=9&unknown=drop#jobs`,
      }),
    ).toEqual({
      label: "Engineering",
      careersUrl: `${base}?degree=BACHELORS&employment_type=FULL_TIME&location=London&q=engineer&sort_by=date&target_level=MID&target_level=ADVANCED`,
    });
    expect(
      adapter.normalizeCustomSelection({
        label: source.careersUrl,
        careersUrl: source.careersUrl,
      }),
    ).toMatchObject({ label: "Google" });
    expect(
      adapter.hydrateSelectedSource({
        ...source,
        label: " ",
        careersUrl: `${source.careersUrl}&page=2`,
      }),
    ).toMatchObject({
      label: "Google",
      cxsJobsUrl: null,
      careersUrl: `${base}?location=London&q=software+engineer&sort_by=date`,
    });
    expect(adapter.descriptor.supportsCustomSource).toBe(true);
  });
  it.each([
    "https://evil.test/about/careers/applications/jobs/results/",
    "https://www.google.com.evil.test/about/careers/applications/jobs/results/",
    "http://www.google.com/about/careers/applications/jobs/results/",
    "https://user:password@www.google.com/about/careers/applications/jobs/results/",
    "https://@www.google.com/about/careers/applications/jobs/results/",
    "https://www.google.com:8443/about/careers/applications/jobs/results/",
    "https://www.google.com:443/about/careers/applications/jobs/results/",
    `${base}123-title`,
    "https://www.google.com/",
    "not a url",
  ])("rejects untrusted search URL %s", (careersUrl) => {
    expect(() => adapter.normalizeCustomSelection({ careersUrl, label: null })).toThrow();
  });
  it("maps the real HTML fixture without fetching detail pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(realListHtml));
    vi.stubGlobal("fetch", fetchMock);
    // One row in this deliberately trimmed real 20-row page.
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({
      total: 1420,
      fetched: 1,
      jobs: [
        {
          jobRef,
          source: "google",
          sourceJobId: realJob[0],
          sourceType: "google",
          title: realJob[1],
          employer: "Google",
          jobUrl: jobRef,
          applicationLink: jobRef,
          location: "Sunnyvale, CA, USA",
          postedAt: null,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });
  it("pages until the total is reached, strips saved paging and preserves filters and order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 20 }, (_, i) => job(i + 1)),
          40,
        ),
      )
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 20 }, (_, i) => job(i + 21)),
          40,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapter.fetchJobs({
      source: { ...source, careersUrl: `${source.careersUrl}&page=9&page=2` },
    });
    expect(result).toMatchObject({ total: 40, fetched: 40 });
    expect(result.jobs.map((row) => row.sourceJobId)).toEqual(
      Array.from({ length: 40 }, (_, i) => String(i + 1)),
    );
    expect(result.jobs[0].jobUrl).toBe(`${base}1-software-engineer-aiml-1`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [index, [url, options]] of fetchMock.mock.calls.entries()) {
      const parsed = new URL(url);
      expect(parsed.searchParams.getAll("page")).toEqual([String(index + 1)]);
      expect(parsed.searchParams.get("q")).toBe("software engineer");
      expect(parsed.searchParams.get("location")).toBe("London");
      expect(parsed.searchParams.get("sort_by")).toBe("date");
      expect(options.signal).toBe(fetchMock.mock.calls[0][1].signal);
    }
  });
  it("stops at three pages and 60 jobs", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return list(
        Array.from({ length: 20 }, (_, i) => job((page - 1) * 20 + i + 1)),
        100,
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 100, fetched: 60 });
    expect(result.jobs.map((row) => row.sourceJobId)).toEqual(
      Array.from({ length: 60 }, (_, i) => String(i + 1)),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([0, 5])("stops on a short subsequent page of %s jobs", async (length) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 20 }, (_, i) => job(i + 1)),
          100,
        ),
      )
      .mockResolvedValueOnce(
        list(
          Array.from({ length }, (_, i) => job(i + 21)),
          100,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await adapter.fetchJobs({ source })).toMatchObject({
      total: 100,
      fetched: 20 + length,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not exceed three pages when pages repeat jobs", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      list(
        Array.from({ length: 20 }, (_, i) => job(i + 1)),
        100,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await adapter.fetchJobs({ source })).toMatchObject({
      total: 100,
      fetched: 20,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("deduplicates the first results page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(list([job(1), job(1), job(2)], 3)));
    expect((await adapter.fetchJobs({ source })).jobs.map((row) => row.sourceJobId)).toEqual([
      "1",
      "2",
    ]);
  });
  it.each([null, []])("accepts a genuine empty list (%s)", async (jobs) => {
    const fetchMock = vi.fn().mockResolvedValue(list(jobs, 0));
    vi.stubGlobal("fetch", fetchMock);
    expect(await adapter.fetchJobs({ source })).toEqual({
      total: 0,
      fetched: 0,
      jobs: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    "<html>No callback</html>",
    callback([[], null, 1]),
    callback([null, null, 1]),
    callback([[{ id: "wrong shape" }], null, 1]),
    callback([[], null, "0"]),
    `<script>AF_initDataCallback({key: 'ds:1', data:[(()=>{throw new Error('executed')})()], sideChannel: {}});</script>`,
    `<script>AF_initDataCallback({key: 'ds:1', data:[[],null,0, sideChannel: {}});</script>`,
  ])("fails loudly on missing/malformed/changed structure", async (html) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(/structure may have changed/);
  });
  it("handles brackets, escaped quotes and backslashes inside JSON strings", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          list([[...job(1).slice(0, 1), 'Engineer [a] "quote" \\ special', ...job(1).slice(2)]]),
        ),
    );
    expect((await adapter.fetchJobs({ source })).jobs[0].title).toBe(
      'Engineer [a] "quote" \\ special',
    );
  });
  it("retries 429 with bounded backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("private", { status: 429 }))
      .mockResolvedValueOnce(list());
    vi.stubGlobal("fetch", fetchMock);
    expect((await adapter.fetchJobs({ source })).fetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("stops after three retries without exposing upstream bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("secret", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Google careers returned HTTP 429.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("rejects upstream errors without leaking response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret", { status: 502 })));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Google careers returned HTTP 502.",
    );
  });
  it("propagates caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, options) => {
        options.signal.throwIfAborted();
      }),
    );
    await expect(adapter.fetchJobs({ source, signal: controller.signal })).rejects.toThrow();
  });
  it("fetches one detail page on a cache miss and imports all sections with matching identity", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => detail());
    vi.stubGlobal("fetch", fetchMock);
    const details = await adapter.fetchJobDetails({ source, jobRef });
    expect(details.descriptionHtml).toContain("Drive roadmap planning");
    const result = await adapter.prepareImportDraft({ source, jobRef });
    expect(result).toMatchObject({
      source: "google",
      sourceHost: "www.google.com",
      draft: {
        source: "google",
        sourceJobId: realJob[0],
        title: realJob[1],
        employer: "Google",
        jobUrl: jobRef,
        applicationLink: jobRef,
        location: "Sunnyvale, CA, USA",
      },
    });
    expect(result.draft.jobDescription).toContain("Bachelor's degree");
    expect(result.draft.jobDescription).toContain("Drive roadmap planning");
    expect(result.draft.jobDescription).toContain("Google's projects");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${base}${realJob[0]}`,
      `${base}${realJob[0]}`,
    ]);
  });
  it("reuses list descriptions for details and import without any detail fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(list());
    vi.stubGlobal("fetch", fetchMock);
    const listed = (await adapter.fetchJobs({ source })).jobs[0];
    const details = await adapter.fetchJobDetails({
      source,
      jobRef: listed.jobRef,
    });
    const result = await adapter.prepareImportDraft({
      source,
      jobRef: listed.jobRef,
    });
    expect(details.descriptionHtml).toContain("Drive roadmap planning");
    expect(result.draft.jobDescription).toContain("Bachelor's degree");
    expect(result.draft.sourceJobId).toBe(listed.sourceJobId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fetches details when the cached list row has no description", async () => {
    const empty = [...realJob];
    empty[3] = [null, ""];
    empty[4] = [null, ""];
    empty[10] = [null, ""];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(list([empty]))
      .mockResolvedValueOnce(detail());
    vi.stubGlobal("fetch", fetchMock);
    await adapter.fetchJobs({ source });
    const result = await adapter.prepareImportDraft({ source, jobRef });
    expect(result.draft.jobDescription).toContain("Drive roadmap planning");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("replaces cached rows on every search and falls back to one detail request on a miss", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce(list(null, 0))
      .mockResolvedValueOnce(detail());
    vi.stubGlobal("fetch", fetchMock);
    await adapter.fetchJobs({ source });
    await adapter.fetchJobs({ source });
    await adapter.prepareImportDraft({ source, jobRef });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(`${base}${realJob[0]}`);
  });
  it("keeps at most the 60 returned rows in the public posting cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 20 }, (_, i) => job(i + 1)),
          100,
        ),
      )
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 20 }, (_, i) => job(i + 21)),
          100,
        ),
      )
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 20 }, (_, i) => job(i + 41)),
          100,
        ),
      )
      .mockResolvedValueOnce(detail(job(61)));
    vi.stubGlobal("fetch", fetchMock);
    await adapter.fetchJobs({ source });
    await adapter.prepareImportDraft({ source, jobRef: `${base}60` });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await adapter.prepareImportDraft({ source, jobRef: `${base}61` });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("rejects ds:1 related-job envelopes on a detail cache miss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(callback([[realJob], null, 1, 20]))),
    );
    await expect(adapter.prepareImportDraft({ source, jobRef })).rejects.toThrow(
      /structure may have changed/,
    );
  });
  it("rejects mismatched job identity, empty descriptions and changed detail data", async () => {
    const empty = [...realJob];
    empty[3] = [null, ""];
    empty[4] = [null, ""];
    empty[10] = [null, ""];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(detail(job(999)))
        .mockResolvedValueOnce(detail(empty))
        .mockResolvedValueOnce(detail({})),
    );
    for (let i = 0; i < 3; i += 1)
      await expect(adapter.prepareImportDraft({ source, jobRef })).rejects.toThrow(
        /structure may have changed/,
      );
  });
  it.each([
    "https://evil.test/123",
    `${base}?q=engineer`,
    `${base}123/anything`,
    "https://www.google.com:443/about/careers/applications/jobs/results/123",
  ])("rejects unsafe job refs before fetching %s", async (jobRef) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.prepareImportDraft({ source, jobRef })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
