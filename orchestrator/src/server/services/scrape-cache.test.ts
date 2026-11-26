import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateJobInput } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUR_MS = 60 * 60 * 1000;

function job(url: string): CreateJobInput {
  return {
    source: "hiringcafe",
    title: "Engineer",
    employer: "Acme",
    jobUrl: url,
  } as CreateJobInput;
}

describe("scrape cache", () => {
  const originalEnv = { ...process.env };
  let tempDir: string;
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-scrape-cache-"));
    vi.resetModules();
    process.env = { ...originalEnv, DATA_DIR: tempDir, NODE_ENV: "test" };
    await import("@server/db/migrate");
    ({ closeDb } = await import("@server/db"));
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    process.env = { ...originalEnv };
    await rm(tempDir, { recursive: true, force: true });
  });

  const keyInput = {
    manifestId: "hiringcafe",
    sources: ["hiringcafe"],
    searchTerms: ["Backend Engineer", "Data Engineer"],
    locationIntent: { selectedCountry: "canada", cityLocations: ["Toronto"] },
    settings: { jobspyResultsWanted: "50" },
    tenantId: "tenant-a",
  };

  it("builds a stable key that ignores term order and casing but not real differences", async () => {
    const { buildSourceRunCacheKey } = await import("./scrape-cache");
    const base = buildSourceRunCacheKey(keyInput);

    expect(
      buildSourceRunCacheKey({
        ...keyInput,
        searchTerms: ["data engineer", " BACKEND ENGINEER"],
        settings: { jobspyResultsWanted: "50" },
      }),
    ).toBe(base);
    expect(buildSourceRunCacheKey({ ...keyInput, searchTerms: ["Backend Engineer"] })).not.toBe(
      base,
    );
    expect(
      buildSourceRunCacheKey({
        ...keyInput,
        locationIntent: { selectedCountry: "canada", cityLocations: ["Ottawa"] },
      }),
    ).not.toBe(base);
    expect(
      buildSourceRunCacheKey({ ...keyInput, settings: { jobspyResultsWanted: "100" } }),
    ).not.toBe(base);
    expect(buildSourceRunCacheKey({ ...keyInput, tenantId: "tenant-b" })).not.toBe(base);
  });

  it("replays a stored scrape within 24 hours and misses after that", async () => {
    const { buildSourceRunCacheKey, readScrapeCache, writeScrapeCache } =
      await import("./scrape-cache");
    const key = buildSourceRunCacheKey(keyInput);
    const start = new Date("2026-11-25T12:00:00.000Z");

    expect(await readScrapeCache(key, { now: start })).toBeNull();

    await writeScrapeCache({
      scrapeKey: key,
      source: "hiringcafe",
      jobs: [job("https://example.com/1"), job("https://example.com/2")],
      sourceErrors: [],
      now: start,
    });

    const hit = await readScrapeCache(key, { now: new Date(start.getTime() + 23 * HOUR_MS) });
    expect(hit?.jobs.map((j) => j.jobUrl)).toEqual([
      "https://example.com/1",
      "https://example.com/2",
    ]);
    expect(hit?.completedAt).toBe(start.toISOString());

    expect(
      await readScrapeCache(key, { now: new Date(start.getTime() + 25 * HOUR_MS) }),
    ).toBeNull();
  });

  it("does not store empty results and keeps one live row per key", async () => {
    const { buildSourceRunCacheKey, readScrapeCache, writeScrapeCache } =
      await import("./scrape-cache");
    const { db, schema } = await import("@server/db");
    const key = buildSourceRunCacheKey(keyInput);
    const start = new Date("2026-11-25T12:00:00.000Z");

    await writeScrapeCache({
      scrapeKey: key,
      source: "hiringcafe",
      jobs: [],
      sourceErrors: [],
      now: start,
    });
    expect(await readScrapeCache(key, { now: start })).toBeNull();

    await writeScrapeCache({
      scrapeKey: key,
      source: "hiringcafe",
      jobs: [job("https://example.com/old")],
      sourceErrors: [],
      now: start,
    });
    await writeScrapeCache({
      scrapeKey: key,
      source: "hiringcafe",
      jobs: [job("https://example.com/new")],
      sourceErrors: [],
      now: new Date(start.getTime() + HOUR_MS),
    });

    const rows = await db.select().from(schema.scrapeTasks);
    expect(rows).toHaveLength(1);
    const hit = await readScrapeCache(key, { now: new Date(start.getTime() + 2 * HOUR_MS) });
    expect(hit?.jobs.map((j) => j.jobUrl)).toEqual(["https://example.com/new"]);
  });

  it("prunes cache rows and blobs older than the retention window", async () => {
    const { buildSourceRunCacheKey, writeScrapeCache } = await import("./scrape-cache");
    const { getBlobStore } = await import("@infra/blob-store");
    const { db, schema } = await import("@server/db");
    const start = new Date("2026-11-20T12:00:00.000Z");
    const oldKey = buildSourceRunCacheKey({ ...keyInput, searchTerms: ["Old"] });
    await writeScrapeCache({
      scrapeKey: oldKey,
      source: "hiringcafe",
      jobs: [job("https://example.com/stale")],
      sourceErrors: [],
      now: start,
    });
    const [staleRow] = await db.select().from(schema.scrapeTasks);
    expect(await getBlobStore().exists(staleRow?.resultKey ?? "")).toBe(true);

    await writeScrapeCache({
      scrapeKey: buildSourceRunCacheKey(keyInput),
      source: "hiringcafe",
      jobs: [job("https://example.com/fresh")],
      sourceErrors: [],
      now: new Date(start.getTime() + 4 * 24 * HOUR_MS),
    });

    const rows = await db.select().from(schema.scrapeTasks);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scrapeKey).not.toBe(oldKey);
    expect(await getBlobStore().exists(staleRow?.resultKey ?? "")).toBe(false);
  });

  it("treats a missing or unreadable blob as a miss instead of failing", async () => {
    const { buildSourceRunCacheKey, readScrapeCache, writeScrapeCache } =
      await import("./scrape-cache");
    const { getBlobStore } = await import("@infra/blob-store");
    const { db, schema } = await import("@server/db");
    const key = buildSourceRunCacheKey(keyInput);
    const start = new Date("2026-11-25T12:00:00.000Z");
    await writeScrapeCache({
      scrapeKey: key,
      source: "hiringcafe",
      jobs: [job("https://example.com/1")],
      sourceErrors: [],
      now: start,
    });
    const [row] = await db.select().from(schema.scrapeTasks);

    await getBlobStore().put(row?.resultKey ?? "", "not json");
    expect(await readScrapeCache(key, { now: start })).toBeNull();

    await getBlobStore().delete(row?.resultKey ?? "");
    expect(await readScrapeCache(key, { now: start })).toBeNull();
  });

  it("can be switched off with JOBOPS_SCRAPE_CACHE=0", async () => {
    const { isScrapeCacheEnabled } = await import("./scrape-cache");
    expect(isScrapeCacheEnabled()).toBe(true);
    process.env.JOBOPS_SCRAPE_CACHE = "0";
    expect(isScrapeCacheEnabled()).toBe(false);
  });

  describe("per-term entries", () => {
    const termInput = {
      manifestId: "jobspy",
      sources: ["indeed", "linkedin"],
      term: "Backend Engineer",
      locationIntent: { selectedCountry: "canada", cityLocations: ["Toronto"] },
      settings: { jobspyResultsWanted: "25", jobspyHoursOld: "72" },
      tenantId: "tenant-a",
    };

    it("keys on the term but not on the term-count-dependent result limits", async () => {
      const { buildTermCacheKey } = await import("./scrape-cache");
      const base = buildTermCacheKey(termInput);

      expect(buildTermCacheKey({ ...termInput, term: "  backend   engineer " })).toBe(base);
      expect(
        buildTermCacheKey({
          ...termInput,
          settings: { jobspyResultsWanted: "10", jobspyHoursOld: "72" },
        }),
      ).toBe(base);
      expect(buildTermCacheKey({ ...termInput, term: "Data Engineer" })).not.toBe(base);
      expect(
        buildTermCacheKey({
          ...termInput,
          settings: { jobspyResultsWanted: "25", jobspyHoursOld: "24" },
        }),
      ).not.toBe(base);
      expect(buildTermCacheKey({ ...termInput, sources: ["indeed"] })).not.toBe(base);
      expect(buildTermCacheKey({ ...termInput, tenantId: "tenant-b" })).not.toBe(base);
    });

    it("extracts the numeric per-term limits from settings", async () => {
      const { extractRequestedLimits } = await import("./scrape-cache");
      expect(
        extractRequestedLimits({
          jobspyResultsWanted: "25",
          adzunaMaxJobsPerTerm: "abc",
          jobindexMaxJobsPerTerm: "0",
          jobspyHoursOld: "72",
        }),
      ).toEqual({ jobspyResultsWanted: 25 });
    });

    it("serves a request whose limit is no larger than the stored one", async () => {
      const { buildTermCacheKey, readScrapeCache, writeScrapeCache } =
        await import("./scrape-cache");
      const key = buildTermCacheKey(termInput);
      const now = new Date("2026-11-25T12:00:00.000Z");
      await writeScrapeCache({
        scrapeKey: key,
        source: "jobspy",
        jobs: [job("https://example.com/1")],
        sourceErrors: [],
        limits: { jobspyResultsWanted: 25 },
        now,
      });

      // Fewer terms later means a bigger per-term limit: the stored scrape is too small.
      expect(await readScrapeCache(key, { now, limits: { jobspyResultsWanted: 50 } })).toBeNull();
      // More terms later means a smaller per-term limit: the stored scrape still covers it.
      expect(
        (await readScrapeCache(key, { now, limits: { jobspyResultsWanted: 10 } }))?.jobs,
      ).toHaveLength(1);
      expect(
        (await readScrapeCache(key, { now, limits: { jobspyResultsWanted: 25 } }))?.jobs,
      ).toHaveLength(1);
      // A limit the stored scrape never recorded cannot be proven covered.
      expect(await readScrapeCache(key, { now, limits: { adzunaMaxJobsPerTerm: 5 } })).toBeNull();
    });
  });
});
