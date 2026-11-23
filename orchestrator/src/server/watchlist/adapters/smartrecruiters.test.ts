import catalog from "@server/config/career-boards-smartrecruiters.json";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistCatalogSourceAdapter } from "./types";

let adapter: WatchlistCatalogSourceAdapter;
const base = "https://jobs.smartrecruiters.com/ServiceNow";
const source: WatchlistSelectedSource = {
  id: "selected",
  catalogSourceId: "smartrecruiters:servicenow",
  label: "ServiceNow",
  sourceType: "smartrecruiters",
  careersUrl: base,
  cxsJobsUrl: null,
  isCustom: false,
  sortOrder: 0,
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-07T00:00:00Z",
};
function job(id = 1, company = "ServiceNow") {
  return {
    id: String(id),
    name: `Engineer ${id}`,
    releasedDate: new Date(1_790_000_000_000 + id * 1000).toISOString(),
    company: { identifier: company, name: company },
    location: { fullLocation: "London, UK", remote: true },
  };
}
function list(content: unknown[] = [job()], totalFound = content.length, offset = 0, limit = 100) {
  return Response.json({ content, totalFound, offset, limit });
}
function detail(id = 1, company = "ServiceNow") {
  return Response.json({
    ...job(id, company),
    jobAd: {
      sections: {
        jobDescription: {
          title: "About <us>",
          text: "<p>Build &amp; ship software.</p>",
        },
        qualifications: {
          title: "Qualifications",
          text: "<ul><li>TypeScript</li></ul>",
        },
      },
    },
  });
}
beforeEach(async () => {
  vi.resetModules();
  adapter = (await import("./smartrecruiters")).smartrecruitersWatchlistAdapter;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("smartrecruitersWatchlistAdapter", () => {
  it("parses the shipped two-company catalog and skips invalid entries", () => {
    expect(adapter.parseCatalogSources(catalog).map((entry) => entry.id)).toEqual([
      "smartrecruiters:servicenow",
      "smartrecruiters:canva",
    ]);
    for (const entry of catalog) expect(adapter.catalogSchema.safeParse(entry).success).toBe(true);
    expect(
      adapter.parseCatalogSources([null, {}, { label: "Bad", careersUrl: "https://evil.test/x" }]),
    ).toEqual([]);
    expect(adapter.descriptor.supportsCustomSource).toBe(true);
  });
  it.each([base, `${base}/123-engineer`, `${base}/123-engineer/apply?x=y#top`])(
    "validates and canonicalizes custom URL %s in one request",
    async (careersUrl) => {
      const mock = vi.fn().mockResolvedValue(list());
      vi.stubGlobal("fetch", mock);
      expect(await adapter.normalizeCustomSelection({ careersUrl, label: null })).toEqual({
        label: "ServiceNow",
        careersUrl: base,
      });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][0]).toBe(
        "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=1&offset=0",
      );
      expect(mock.mock.calls[0][1]).toMatchObject({
        redirect: "manual",
        signal: expect.any(AbortSignal),
      });
    },
  );
  it("canonicalizes company case from the first valid posting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => list()),
    );
    for (const careersUrl of [base, base.toLowerCase()]) {
      expect(await adapter.normalizeCustomSelection({ careersUrl, label: null })).toEqual({
        label: "ServiceNow",
        careersUrl: base,
      });
    }
  });
  it("preserves the supplied company case for an empty board", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(list([])));
    expect(await adapter.normalizeCustomSelection({ careersUrl: base, label: null })).toEqual({
      label: "ServiceNow",
      careersUrl: base,
    });
  });
  it("preserves custom labels and hydrates without network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(list()));
    expect(
      await adapter.normalizeCustomSelection({
        careersUrl: base,
        label: " My team ",
      }),
    ).toMatchObject({ label: "My team" });
    expect(
      adapter.hydrateSelectedSource({
        ...source,
        label: " ",
        careersUrl: `${base}/123/apply`,
      }),
    ).toMatchObject({
      label: "ServiceNow",
      careersUrl: base,
      cxsJobsUrl: null,
    });
  });
  it.each([
    "http://jobs.smartrecruiters.com/Acme",
    "https://jobs.smartrecruiters.com.evil.test/Acme",
    "https://user@jobs.smartrecruiters.com/Acme",
    "https://@jobs.smartrecruiters.com/Acme",
    "https://jobs.smartrecruiters.com:443/Acme",
    "https://jobs.smartrecruiters.com/",
    `${base}/../../evil`,
    `${base}/not-a-posting`,
    "invalid",
  ])("rejects unsafe URLs without network %s", async (careersUrl) => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(adapter.normalizeCustomSelection({ careersUrl, label: null })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("paginates, deduplicates, sorts newest first and caps 60 without details", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        list(
          Array.from({ length: 100 }, (_, i) => job(i)),
          102,
        ),
      )
      .mockResolvedValueOnce(list([job(99), job(101)], 102, 100));
    vi.stubGlobal("fetch", mock);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 102, fetched: 60 });
    expect(result.jobs[0]).toEqual({
      jobRef: `${base}/101`,
      source: "smartrecruiters:servicenow",
      sourceJobId: "101",
      sourceType: "smartrecruiters",
      title: "Engineer 101",
      employer: "ServiceNow",
      jobUrl: `${base}/101`,
      applicationLink: `${base}/101`,
      location: "London, UK; Remote",
      postedAt: job(101).releasedDate,
    });
    expect(result.jobs[59].sourceJobId).toBe("41");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0]).toContain("limit=100&offset=100");
  });
  it("limits large boards to five pages and sorts the first 500 locally", async () => {
    const mock = vi.fn().mockImplementation(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return list(
        Array.from({ length: 100 }, (_, i) => job(offset + i)),
        1200,
        offset,
      );
    });
    vi.stubGlobal("fetch", mock);
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({ total: 1200, fetched: 60 });
    expect(result.jobs.map((entry) => entry.sourceJobId)).toEqual(
      Array.from({ length: 60 }, (_, i) => String(499 - i)),
    );
    expect(mock.mock.calls.map(([url]) => url)).toEqual(
      [0, 100, 200, 300, 400].map(
        (offset) =>
          `https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?limit=100&offset=${offset}`,
      ),
    );
  });
  it("skips malformed postings while retaining valid rows and pagination", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(list([null, { ...job(), releasedDate: "invalid" }, job(2)], 101))
      .mockResolvedValueOnce(list([{ ...job(), location: null }, job(101)], 101, 100));
    vi.stubGlobal("fetch", mock);
    const result = await adapter.fetchJobs({ source });
    expect(result.jobs.map((entry) => entry.sourceJobId)).toEqual(["101", "2"]);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("skips malformed custom-selection rows but rejects entirely invalid non-empty pages", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(list([null, job()]))
      .mockImplementation(async () => list([null, {}]));
    vi.stubGlobal("fetch", mock);
    expect(
      await adapter.normalizeCustomSelection({
        careersUrl: base.toLowerCase(),
        label: null,
      }),
    ).toEqual({ label: "ServiceNow", careersUrl: base });
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "response structure may have changed",
    );
    await expect(
      adapter.normalizeCustomSelection({ careersUrl: base, label: null }),
    ).rejects.toThrow("response structure may have changed");
  });
  it("accepts empty boards", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(list([], 0)));
    expect(await adapter.fetchJobs({ source })).toEqual({
      total: 0,
      fetched: 0,
      jobs: [],
    });
  });
  it("fetches exactly one detail on a miss and reuses it for import", async () => {
    const mock = vi.fn().mockResolvedValueOnce(list()).mockResolvedValueOnce(detail());
    vi.stubGlobal("fetch", mock);
    const listed = (await adapter.fetchJobs({ source })).jobs[0];
    const details = await adapter.fetchJobDetails({
      source,
      jobRef: listed.jobRef,
    });
    expect(details.descriptionHtml).toContain("About &lt;us&gt;");
    expect(mock).toHaveBeenCalledTimes(2);
    const imported = await adapter.prepareImportDraft({
      source,
      jobRef: listed.jobRef,
    });
    expect(imported).toMatchObject({
      source: listed.source,
      sourceHost: "jobs.smartrecruiters.com",
      draft: {
        source: listed.source,
        sourceJobId: listed.sourceJobId,
        title: listed.title,
        employer: listed.employer,
        jobUrl: listed.jobUrl,
        applicationLink: listed.applicationLink,
        location: listed.location,
      },
    });
    expect(imported.draft.jobDescription).toContain("Build & ship software.");
    expect(imported.draft.jobDescription).toContain("TypeScript");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0]).toBe(
      "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/1",
    );
  });
  it("keeps company A details when company B is fetched before A imports", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(list([job(1, "Canva")]));
    vi.stubGlobal("fetch", mock);
    const listed = (await adapter.fetchJobs({ source })).jobs[0];
    await adapter.fetchJobDetails({ source, jobRef: listed.jobRef });
    await adapter.fetchJobs({
      source: {
        ...source,
        careersUrl: "https://jobs.smartrecruiters.com/Canva",
      },
    });
    const result = await adapter.prepareImportDraft({
      source,
      jobRef: listed.jobRef,
    });
    expect(result.draft.source).toBe("smartrecruiters:servicenow");
    expect(result.draft.sourceJobId).toBe(listed.sourceJobId);
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it("caches after direct import, expires after 15 minutes and isolates public company identities", async () => {
    vi.useFakeTimers();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce(detail(1, "Canva"))
      .mockResolvedValueOnce(detail());
    vi.stubGlobal("fetch", mock);
    await adapter.prepareImportDraft({ source, jobRef: `${base}/1` });
    const other = {
      ...source,
      id: "other-tenant-selection",
      label: "Private tenant label",
    };
    expect(
      (await adapter.prepareImportDraft({ source: other, jobRef: `${base}/1` })).draft.employer,
    ).toBe("ServiceNow");
    await adapter.prepareImportDraft({
      source: {
        ...source,
        careersUrl: "https://jobs.smartrecruiters.com/Canva",
      },
      jobRef: "https://jobs.smartrecruiters.com/Canva/1",
    });
    expect(mock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await adapter.prepareImportDraft({ source, jobRef: `${base}/1` });
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it.each([
    `${base}`,
    "https://evil.test/ServiceNow/1",
    "https://jobs.smartrecruiters.com/Canva/1",
  ])("rejects foreign or missing posting refs %s", async (jobRef) => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(adapter.prepareImportDraft({ source, jobRef })).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it("rejects malformed, wrong-company and stalled lists", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(list([job(1, "Canva")]))
      .mockResolvedValueOnce(list([], 20));
    vi.stubGlobal("fetch", mock);
    for (let i = 0; i < 3; i++) await expect(adapter.fetchJobs({ source })).rejects.toThrow();
  });
  it("rejects mismatched and empty details without caching them", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(detail(2))
      .mockResolvedValueOnce(detail(1, "Canva"))
      .mockResolvedValueOnce(Response.json({ ...job(), jobAd: { sections: {} } }));
    vi.stubGlobal("fetch", mock);
    for (let i = 0; i < 3; i++)
      await expect(adapter.prepareImportDraft({ source, jobRef: `${base}/1` })).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it("backs off 1/3/8 seconds and stops after three retries", async () => {
    const times: number[] = [];
    const mock = vi.fn().mockImplementation(async () => {
      times.push(Date.now());
      return new Response("secret", { status: 429 });
    });
    vi.stubGlobal("fetch", mock);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "SmartRecruiters returned HTTP 429.",
    );
    expect(mock).toHaveBeenCalledTimes(4);
    for (const [i, minimum] of [1000, 3000, 8000].entries())
      expect(times[i + 1] - times[i]).toBeGreaterThanOrEqual(minimum - 20);
  });
  it.each(["seconds", "date"])("honors Retry-After %s", async (kind) => {
    const retry = kind === "seconds" ? "1" : new Date(Date.now() + 2000).toUTCString();
    const start = Date.now();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": retry } }))
      .mockResolvedValueOnce(list());
    vi.stubGlobal("fetch", mock);
    expect((await adapter.fetchJobs({ source })).fetched).toBe(1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(980);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it.each(["seconds", "date"])(
    "fails fast on Retry-After longer than ten seconds (%s)",
    async (kind) => {
      const retry = kind === "seconds" ? "60" : new Date(Date.now() + 60_000).toUTCString();
      const mock = vi.fn().mockResolvedValue(
        new Response("secret", {
          status: 429,
          headers: { "Retry-After": retry },
        }),
      );
      vi.stubGlobal("fetch", mock);
      const start = Date.now();
      await expect(adapter.fetchJobs({ source })).rejects.toThrow(
        "SmartRecruiters returned HTTP 429.",
      );
      expect(Date.now() - start).toBeLessThan(1000);
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );
  it("combines a 25-second budget with caller cancellation during retries", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const mock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "10" } }));
    vi.stubGlobal("fetch", mock);
    const controller = new AbortController();
    const outcome = expect(
      adapter.fetchJobs({ source, signal: controller.signal }),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await outcome;
    expect(mock).toHaveBeenCalledTimes(1);
    const signal = mock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(timeout).toHaveBeenCalledWith(25_000);
    timeout.mockRestore();
  });
  it("checks cancellation on cached details and before fetch", async () => {
    const mock = vi.fn().mockResolvedValue(detail());
    vi.stubGlobal("fetch", mock);
    await adapter.prepareImportDraft({ source, jobRef: `${base}/1` });
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.prepareImportDraft({
        source,
        jobRef: `${base}/1`,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await expect(adapter.fetchJobs({ source, signal: controller.signal })).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("reports HTTP and invalid JSON errors without response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("secret", { status: 502 }))
        .mockResolvedValueOnce(new Response("secret")),
    );
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "SmartRecruiters returned HTTP 502.",
    );
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "SmartRecruiters returned invalid JSON.",
    );
  });
});
