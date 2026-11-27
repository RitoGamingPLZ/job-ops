import catalog from "@server/config/career-boards-oracle.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, makeSelectedSource } from "../testing/fixtures";
import { oracleWatchlistAdapter as adapter } from "./oracle";

vi.mock("node:timers/promises", async (importOriginal) => {
  const { withFakeTimeouts } = await import("../testing/timers");
  return withFakeTimeouts(await importOriginal<typeof import("node:timers/promises")>());
});

const base = catalog[0].careersUrl;
const source = makeSelectedSource({
  id: "oracle-selected",
  label: "Uber",
  sourceType: "oracle",
  careersUrl: base,
  isCustom: true,
  createdAt: "",
  updatedAt: "",
});
function job(id = "304060") {
  return {
    Id: id,
    Title: `Engineer ${id}`,
    PostedDate: "2026-11-07",
    PrimaryLocation: "Toronto",
    secondaryLocations: [{ Name: "London" }, { Name: "Toronto" }],
  };
}
const json = jsonResponse;
function page(total = 1, jobs = [job()]) {
  return json({ items: [{ TotalJobsCount: total, requisitionList: jobs }] });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("oracleWatchlistAdapter", () => {
  it("loads the real catalog, skips bad entries and keeps distinct canonical filtered IDs", () => {
    const parsedCatalog = adapter.parseCatalogSources(catalog);
    expect(parsedCatalog).toHaveLength(catalog.length);
    expect(parsedCatalog[0]).toMatchObject({
      label: "Uber",
      sourceType: "oracle",
      careersUrl: base,
    });
    expect(parsedCatalog.map((source) => source.label)).toEqual(
      expect.arrayContaining(["Kroger", "Albertsons", "Americold"]),
    );
    expect(
      adapter.parseCatalogSources([null, {}, { label: "bad", careersUrl: "https://evil.com" }]),
    ).toEqual([]);
    const sources = adapter.parseCatalogSources([
      { label: "Uber", careersUrl: base },
      {
        label: "Uber",
        careersUrl: `${base}?keyword=software engineer&tracking=no`,
      },
      { label: "Uber", careersUrl: `${base}?keyword=designer` },
      {
        label: "Uber",
        careersUrl: `${base}?tracking=yes&keyword=software+engineer`,
      },
    ]);
    expect(new Set(sources.map((s) => s.id)).size).toBe(3);
    expect(sources[1].id).toBe(sources[3].id);
    expect(sources[1].careersUrl).toBe(`${base}?keyword=software+engineer`);
  });
  it.each([
    base.replace("https:", "http:"),
    base.replace("oraclecloud.com", "oraclecloud.com.evil.test"),
    base.replace("iaziqy.fa.ocs.oraclecloud.com", "oraclecloud.com"),
    base.replace("/jobs", "/job/123"),
    base.replace("iaziqy.fa.ocs.oraclecloud.com", "127.0.0.1"),
  ])("rejects unsafe or unsupported URL %s", (careersUrl) => {
    expect(() => adapter.normalizeCustomSelection({ careersUrl, label: null })).toThrow();
  });
  it("preserves only allow-listed filters on any valid Oracle tenant, without network access", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const careersUrl =
      "https://example.fa.oraclecloud.com/hcmUI/CandidateExperience/fr-CA/sites/CX_2/jobs/?keyword=engineer&locationId=12&location=Canada&radius=50&radiusUnit=KM&selectedCategoriesFacet=1;2&selectedLocationsFacet=3;4&selectedPostingDatesFacet=5&selectedWorkplaceTypesFacet=6&selectedTitlesFacet=7&siteNumber=CX_99&limit=999&offset=99&evil=x#foo";
    const normalized = adapter.normalizeCustomSelection({
      careersUrl,
      label: "Example",
    }) as { careersUrl: string };
    const url = new URL(normalized.careersUrl);
    expect([...url.searchParams.keys()]).toHaveLength(10);
    expect(url.searchParams.get("selectedLocationsFacet")).toBe("3;4");
    expect(url.hash).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("encodes finder once, quoting spaces and commas and escaping facet semicolons", async () => {
    const fetch = vi.fn().mockResolvedValue(page());
    vi.stubGlobal("fetch", fetch);
    await adapter.fetchJobs({
      source: {
        ...source,
        careersUrl: `${base}?keyword=software%20engineer%2C%20platform&selectedLocationsFacet=1%3B2&siteNumber=CX_99`,
      },
    });
    const url = new URL(fetch.mock.calls[0][0]);
    const finder = url.searchParams.get("finder");
    expect(finder).toBe(
      'findReqs;siteNumber=CX_1,limit=25,offset=0,sortBy=POSTING_DATES_DESC,keyword="software engineer, platform",selectedLocationsFacet=1;2',
    );
    expect(url.toString()).toContain("selectedLocationsFacet%3D1%3B2");
    expect(url.toString()).not.toContain("%253B");
    expect(url.searchParams.get("expand")).toBe("requisitionList.secondaryLocations");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: { "user-agent": "job-ops-watchlist/0.1" },
    });
  });
  it("pages newest first to 60, retains the pre-cap total and maps public URLs", async () => {
    const fetch = vi.fn().mockImplementation(async (value: string) => {
      const offset = Number(new URL(value).searchParams.get("finder")?.match(/offset=(\d+)/)?.[1]);
      return page(
        826,
        Array.from({ length: 25 }, (_, i) => job(String(offset + i + 1))),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 826, fetched: 60 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.jobs[0]).toMatchObject({
      jobRef: "1",
      sourceJobId: "1",
      title: "Engineer 1",
      location: "Toronto; London",
      jobUrl: "https://jobs.uber.com/en/jobs/1/",
      postedAt: "2026-11-07",
    });
    expect(result.jobs.at(-1)?.sourceJobId).toBe("60");
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get("finder")).toContain("offset=50");
  });
  it("stops at the total or an empty page", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(100, [job()]))
      .mockResolvedValueOnce(page(100, []));
    vi.stubGlobal("fetch", fetch);
    expect((await adapter.fetchJobs({ source })).fetched).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("discovers custom site numbers and uses the generic public job URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('<div data-sitenumber="CX_9">'))
      .mockResolvedValueOnce(page());
    vi.stubGlobal("fetch", fetch);
    const careersUrl = base.replace("iaziqy", "other").replace("UberCareers", "Other");
    const result = await adapter.fetchJobs({
      source: { ...source, careersUrl },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("finder")).toContain("siteNumber=CX_9");
    expect(result.jobs[0].jobUrl).toBe(careersUrl.replace("/jobs", "/job/304060"));
  });
  it("loads detail HTML and imports text with the same source identity as listings", async () => {
    const detail = {
      ...job(),
      ExternalDescriptionStr: "<p>Build &amp; ship.</p>",
      ExternalResponsibilitiesStr: "<p>Salary $100.</p>",
      ExternalQualificationsStr: "<p>TypeScript.</p>",
      JobSchedule: "Full time",
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page())
      .mockImplementation(async () => json({ items: [detail] }));
    vi.stubGlobal("fetch", fetch);
    const listing = await adapter.fetchJobs({ source });
    const response = await adapter.fetchJobDetails({
      source,
      jobRef: "304060",
    });
    expect(response.descriptionHtml).toContain("Salary $100");
    const imported = await adapter.prepareImportDraft({
      source,
      jobRef: "304060",
    });
    expect(imported.draft).toMatchObject({
      source: listing.jobs[0].source,
      sourceJobId: "304060",
      title: "Engineer 304060",
      employer: "Uber",
      jobType: "Full time",
    });
    expect(imported.draft.jobDescription).toContain("Build & ship.");
    expect(imported.draft.jobDescription).toContain("TypeScript.");
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("finder")).toBe(
      'ById;Id="304060",siteNumber=CX_1',
    );
    expect(imported.sourceHost).toBe("iaziqy.fa.ocs.oraclecloud.com");
  });
  it("rejects mismatched detail IDs, arbitrary references, invalid payloads and redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ items: [job("999")] }));
    vi.stubGlobal("fetch", fetch);
    await expect(adapter.fetchJobDetails({ source, jobRef: "304060" })).rejects.toThrow(
      "invalid job details",
    );
    await expect(adapter.fetchJobDetails({ source, jobRef: "1,siteNumber=CX_9" })).rejects.toThrow(
      "Invalid Oracle job reference",
    );
    fetch.mockResolvedValueOnce(json({ items: [] }));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("invalid job listings");
    fetch.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("HTTP 302");
  });
  it("rejects finder syntax injection through unquoted filters", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      adapter.fetchJobs({
        source: {
          ...source,
          careersUrl: `${base}?selectedLocationsFacet=1%2Climit%3D999`,
        },
      }),
    ).rejects.toThrow("Invalid Oracle search filter");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("honors cancellation before making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const signal = AbortSignal.abort();
    await expect(adapter.fetchJobs({ source, signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("backs off on 429 within the shared 25 second budget", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(page());
    vi.stubGlobal("fetch", fetch);
    const result = adapter.fetchJobs({ source });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).fetched).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
