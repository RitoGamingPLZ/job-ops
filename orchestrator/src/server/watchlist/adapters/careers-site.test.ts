import catalog from "@server/config/career-boards-careers_site.json";
import type {
  CrawledJob,
  Recipe,
  SiteRecipeRecord,
} from "@server/watchlist/careers-site/types";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchlistCatalogSourceAdapter } from "./types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  record: vi.fn(),
  block: vi.fn(),
  learn: vi.fn(),
  run: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@server/repositories/site-recipes", () => ({
  getSiteRecipe: mocks.get,
  saveSiteRecipe: mocks.save,
  recordSiteRecipeRun: mocks.record,
  markSiteBlocked: mocks.block,
}));
vi.mock("@server/watchlist/careers-site/learn", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@server/watchlist/careers-site/learn")
  >()),
  learnRecipe: mocks.learn,
}));
vi.mock("@server/watchlist/careers-site/run-recipe", () => ({
  runRecipe: mocks.run,
}));
vi.mock("@server/watchlist/careers-site/fetch", () => ({
  fetchPublicText: vi.fn(),
  isAllowedByRobots: vi.fn(),
  loadPage: vi.fn(),
}));
vi.mock("@infra/logger", () => ({ logger: { warn: mocks.warn } }));
const recipe: Recipe = {
  version: 1,
  jobUrlPattern: "/jobs/",
  listing: { kind: "sitemap", url: "https://example.com/sitemap.xml" },
  detail: { kind: "jsonld" },
};
const source: WatchlistSelectedSource = {
  id: "selected",
  catalogSourceId: null,
  sourceType: "careers_site",
  label: "Example",
  careersUrl: "https://example.com/careers",
  cxsJobsUrl: null,
  isCustom: true,
  sortOrder: 0,
  createdAt: "2026-11-07",
  updatedAt: "2026-11-07",
};
function record(overrides: Partial<SiteRecipeRecord> = {}): SiteRecipeRecord {
  return {
    host: "example.com",
    recipe,
    learnedAt: "2026-11-07",
    lastSuccessAt: null,
    consecutiveFailures: 0,
    blockedReason: null,
    ...overrides,
  };
}
function job(id = "1", host = "example.com"): CrawledJob {
  return {
    id,
    url: `https://${host}/jobs/${id}`,
    title: `Engineer ${id}`,
    employer: "Example Inc",
    location: "London",
    postedAt: "2026-11-07T00:00:00Z",
    descriptionHtml: "<p>Build &amp; ship.</p>",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let adapter: WatchlistCatalogSourceAdapter;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    }),
  );
  mocks.get.mockResolvedValue(record());
  mocks.run.mockResolvedValue([job()]);
  mocks.record.mockResolvedValue(0);
  mocks.learn.mockResolvedValue(recipe);
  adapter = (await import("./careers-site")).careersSiteWatchlistAdapter;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("careersSiteWatchlistAdapter", () => {
  it("parses all 13 exact survey URLs and safely skips invalid entries", () => {
    const parsed = adapter.parseCatalogSources(catalog);
    expect(parsed).toHaveLength(13);
    expect(parsed.map((s) => s.careersUrl)).toEqual(
      catalog.map((s) => s.careersUrl),
    );
    expect(parsed.map((s) => s.id)).toEqual(
      catalog.map((s) => `careers_site:${new URL(s.careersUrl).hostname}`),
    );
    expect(
      adapter.parseCatalogSources([
        null,
        {},
        { label: "Bad", careersUrl: "http://example.com" },
        { label: "Bad", careersUrl: "https://example.com:443" },
      ]),
    ).toEqual([]);
    expect(adapter.descriptor.supportsCustomSource).toBe(true);
  });
  it("normalizes any HTTPS careers URL and hydrates without network", async () => {
    expect(
      await adapter.normalizeCustomSelection({
        label: "  Custom  ",
        careersUrl: "https://EXAMPLE.COM/careers?q=eng#top",
      }),
    ).toEqual({
      label: "Custom",
      careersUrl: "https://example.com/careers?q=eng",
    });
    expect(
      await adapter.normalizeCustomSelection({
        label: null,
        careersUrl: source.careersUrl,
      }),
    ).toEqual({ label: "example.com", careersUrl: source.careersUrl });
    expect(
      adapter.hydrateSelectedSource({ ...source, label: " " }),
    ).toMatchObject({ label: "example.com", cxsJobsUrl: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "http://example.com/careers",
    "https://user:pass@example.com",
    "https://example.com:443/careers",
    "https://example.com:8443",
    "https://@example.com",
    "oops",
  ])("rejects %s", async (careersUrl) => {
    await expect(async () =>
      adapter.normalizeCustomSelection({ label: null, careersUrl }),
    ).rejects.toThrow("HTTPS careers URL");
  });
  it("maps jobs and imports cached HTML without another crawl", async () => {
    const result = await adapter.fetchJobs({ source });
    expect(result).toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [
        {
          source: "careers_site:example.com",
          sourceJobId: "1",
          jobRef: job().url,
          employer: "Example Inc",
          location: "London",
          postedAt: job().postedAt,
        },
      ],
    });
    expect(mocks.record).toHaveBeenCalledWith("example.com", true);
    expect(
      await adapter.fetchJobDetails({ source, jobRef: job().url }),
    ).toMatchObject({ descriptionHtml: job().descriptionHtml });
    expect(
      await adapter.prepareImportDraft({ source, jobRef: job().url }),
    ).toMatchObject({
      source: "careers_site:example.com",
      sourceHost: "example.com",
      draft: {
        source: "careers_site:example.com",
        sourceJobId: "1",
        jobDescription: "Build & ship.",
      },
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "http://example.com/jobs/1",
    "https://example.com:8443/jobs/1",
    "https://example.com/jobs/1#posting",
  ])("opens and imports the exact cached posting URL %s", async (url) => {
    mocks.run.mockResolvedValue([{ ...job(), url }]);
    const result = await adapter.fetchJobs({ source });
    const jobRef = result.jobs[0].jobRef;
    expect(jobRef).toBe(url);
    expect(await adapter.fetchJobDetails({ source, jobRef })).toMatchObject({
      jobUrl: url,
      descriptionHtml: job().descriptionHtml,
    });
    expect(await adapter.prepareImportDraft({ source, jobRef })).toMatchObject({
      draft: { jobUrl: url, applicationLink: url, sourceJobId: "1" },
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("caps plain recipes at 40 and records empty results as failures", async () => {
    mocks.run.mockResolvedValue(
      Array.from({ length: 45 }, (_, i) => job(String(i))),
    );
    expect((await adapter.fetchJobs({ source })).jobs).toHaveLength(40);
    expect(mocks.run).toHaveBeenCalledWith(recipe, {
      limit: 40,
      signal: expect.any(AbortSignal),
    });
    mocks.run.mockResolvedValue([]);
    expect(await adapter.fetchJobs({ source })).toMatchObject({ fetched: 0 });
    expect(mocks.record).toHaveBeenLastCalledWith("example.com", false);
  });
  it.each([
    ["detail", 4],
    ["listing", 10],
    ["both", 4],
  ])("caps rendered %s recipes at %s", async (stage, limit) => {
    const rendered: Recipe = {
      ...recipe,
      ...(stage !== "listing"
        ? {
            detail: {
              kind: "selectors",
              render: true,
              title: "h1",
              description: "main",
            },
          }
        : {}),
      ...(stage !== "detail"
        ? {
            listing: {
              kind: "page",
              url: source.careersUrl,
              render: true,
              maxPages: 1,
              pagination: { kind: "none" },
            },
          }
        : {}),
    };
    mocks.get.mockResolvedValue(record({ recipe: rendered }));
    await adapter.fetchJobs({ source });
    expect(mocks.run).toHaveBeenCalledWith(rendered, {
      limit,
      signal: expect.any(AbortSignal),
    });
  });
  it("uses 40 for selectors without rendering", async () => {
    mocks.get.mockResolvedValue(
      record({
        recipe: {
          ...recipe,
          detail: {
            kind: "selectors",
            render: false,
            title: "h1",
            description: "main",
          },
        },
      }),
    );
    await adapter.fetchJobs({ source });
    expect(mocks.run.mock.calls[0][1].limit).toBe(40);
  });
  it.each([
    null,
    record({ recipe: null }),
    record({ consecutiveFailures: 3 }),
  ])("learns missing/corrupt/failed recipes detached and deduplicates per host", async (stored) => {
    const pending = deferred<Recipe>();
    mocks.get.mockResolvedValue(stored);
    mocks.learn.mockReturnValue(pending.promise);
    const caller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await expect(
      adapter.fetchJobs({ source, signal: caller.signal }),
    ).rejects.toThrow("Learning this careers site, check again in a minute");
    caller.abort();
    const ownSignal = mocks.learn.mock.calls[0][1].signal as AbortSignal;
    expect(ownSignal.aborted).toBe(false);
    expect(timeout).toHaveBeenCalledWith(180_000);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Learning this careers site",
    );
    expect(mocks.learn).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    pending.resolve(recipe);
    await vi.waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("example.com", recipe),
    );
    mocks.get.mockResolvedValue(record());
    await expect(adapter.fetchJobs({ source })).resolves.toMatchObject({
      fetched: 1,
    });
  });
  it("cools down failed learns, logs safely, and permits retry only after 30 minutes", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    mocks.get.mockResolvedValue(null);
    mocks.learn.mockRejectedValue(new Error("sensitive upstream body"));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Learning");
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("sensitive");
    for (const elapsed of [0, 30 * 60_000 - 1]) {
      now.mockReturnValue(1_000_000 + elapsed);
      await expect(adapter.fetchJobs({ source })).rejects.toThrow(
        "Could not learn this careers site. Try again later.",
      );
    }
    expect(mocks.learn).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    now.mockReturnValue(1_000_000 + 30 * 60_000);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Learning");
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalledTimes(2));
  });
  it("logs the learner's bounded rejection message", async () => {
    const { RecipeLearningError } = await import(
      "@server/watchlist/careers-site/learn"
    );
    mocks.get.mockResolvedValue(null);
    const reason =
      "Could not learn a verified careers recipe: LLM request failed (HTTP 400)";
    mocks.learn.mockRejectedValue(new RecipeLearningError(reason));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Learning");
    await vi.waitFor(() =>
      expect(mocks.warn).toHaveBeenCalledWith(
        "Careers site learning failed",
        expect.objectContaining({ host: "example.com", reason }),
      ),
    );
  });
  it("keeps failed-learn cooldowns separate by host", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.learn.mockRejectedValueOnce(new Error("no jobs"));
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Learning");
    await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalledTimes(1));
    await expect(
      adapter.fetchJobs({
        source: { ...source, careersUrl: "https://other.example/careers" },
      }),
    ).rejects.toThrow("Learning");
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.learn).toHaveBeenCalledTimes(2);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Could not learn this careers site",
    );
  });
  it("never learns or crawls blocked hosts, even with null recipes", async () => {
    mocks.get.mockResolvedValue(
      record({ recipe: null, blockedReason: "403", consecutiveFailures: 9 }),
    );
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "remains blocked",
    );
    expect(mocks.learn).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    "run",
    "learn",
  ])("persists blocks thrown during %s", async (stage) => {
    const { SiteBlockedError } = await import(
      "@server/watchlist/careers-site/types"
    );
    const error = new SiteBlockedError("example.com", "403");
    if (stage === "learn") {
      mocks.get.mockResolvedValue(null);
      mocks.learn.mockRejectedValue(error);
      await expect(adapter.fetchJobs({ source })).rejects.toThrow("Learning");
      await vi.waitFor(() =>
        expect(mocks.block).toHaveBeenCalledWith("example.com", "403"),
      );
    } else {
      mocks.run.mockRejectedValue(error);
      await expect(adapter.fetchJobs({ source })).rejects.toThrow(
        "blocks automated access",
      );
      expect(mocks.block).toHaveBeenCalledWith("example.com", "403");
      expect(mocks.record).not.toHaveBeenCalled();
      expect(mocks.learn).not.toHaveBeenCalled();
    }
  });
  it.each([
    false,
    true,
  ])("relearns on the third failed run (thrown=%s)", async (throws) => {
    mocks.record.mockResolvedValue(3);
    if (throws) mocks.run.mockRejectedValue(new Error("bad selector"));
    else mocks.run.mockResolvedValue([]);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow("Learning");
    expect(mocks.record).toHaveBeenCalledWith("example.com", false);
    expect(mocks.learn).toHaveBeenCalledTimes(1);
  });
  it("returns a clear crawl failure before the relearn threshold", async () => {
    mocks.run.mockRejectedValue(new Error("raw upstream body"));
    mocks.record.mockResolvedValue(2);
    await expect(adapter.fetchJobs({ source })).rejects.toThrow(
      "Could not read jobs",
    );
    expect(mocks.learn).not.toHaveBeenCalled();
  });
  it("combines the caller signal with the 25 s deadline and discards aborted results", async () => {
    const caller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mocks.run.mockImplementation(async (_recipe, { signal }) => {
      expect(signal).not.toBe(caller.signal);
      caller.abort();
      expect(signal.aborted).toBe(true);
      return [job()];
    });
    await expect(
      adapter.fetchJobs({ source, signal: caller.signal }),
    ).rejects.toThrow();
    expect(timeout).toHaveBeenCalledWith(25_000);
    expect(mocks.record).not.toHaveBeenCalled();
    await expect(
      adapter.prepareImportDraft({ source, jobRef: job().url }),
    ).rejects.toThrow("Refresh");
  });
  it("keeps public caches separate by host and rejects cross-host or unknown refs", async () => {
    await adapter.fetchJobs({ source });
    const other = { ...source, careersUrl: "https://other.example/careers" };
    await expect(
      adapter.prepareImportDraft({ source: other, jobRef: job().url }),
    ).rejects.toThrow("Refresh");
    await expect(
      adapter.prepareImportDraft({
        source: other,
        jobRef: job("1", "other.example").url,
      }),
    ).rejects.toThrow("Refresh");
    mocks.run.mockResolvedValue([job("1", "other.example")]);
    await adapter.fetchJobs({ source: other });
    expect(
      (
        await adapter.prepareImportDraft({
          source: other,
          jobRef: job("1", "other.example").url,
        })
      ).source,
    ).toBe("careers_site:other.example");
    expect(
      (await adapter.prepareImportDraft({ source, jobRef: job().url })).source,
    ).toBe("careers_site:example.com");
  });
  it("expires cached postings after 15 minutes", async () => {
    await adapter.fetchJobs({ source });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000);
    await expect(
      adapter.fetchJobDetails({ source, jobRef: job().url }),
    ).rejects.toThrow("Refresh");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
});
