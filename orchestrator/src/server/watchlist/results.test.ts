import * as jobsRepo from "@server/repositories/jobs";
import * as watchlistRepo from "@server/repositories/watchlist";
import { getWatchlistSourceAdapter } from "@server/watchlist/adapters";
import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentWatchlistResults,
  getWatchlistResultsForSources,
  hydrateWatchlistSelectedSources,
  WATCHLIST_SOURCE_TIMEOUT_MS,
  withWatchlistSourceTimeout,
} from "./results";
import { makeSelectedSource } from "./testing/fixtures";

vi.mock("@server/repositories/watchlist", () => ({
  listWatchlistSelectedSources: vi.fn(),
  listWatchlistJobStates: vi.fn(),
  recordWatchlistCheck: vi.fn(),
  listWatchlistSourceResults: vi.fn(),
  saveWatchlistSourceResults: vi.fn(),
}));

vi.mock("@server/repositories/jobs", () => ({
  getJobListItems: vi.fn(),
}));

vi.mock("@server/watchlist/adapters", () => ({
  getWatchlistSourceAdapter: vi.fn(),
  listWatchlistSourceAdapters: vi.fn(() => []),
}));

const workdaySource = makeSelectedSource({
  id: "workday-source",
  catalogSourceId: "acme",
  label: "Acme",
  careersUrl: "https://acme.wd1.myworkdayjobs.com/acme",
  sourceType: "workday",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const bamboohrSource = makeSelectedSource({
  id: "bamboohr-source",
  label: "Beta",
  careersUrl: "https://beta.bamboohr.com/careers",
  sourceType: "bamboohr",
  isCustom: true,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("watchlist results service", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(watchlistRepo.listWatchlistSourceResults).mockResolvedValue([]);
    vi.mocked(watchlistRepo.recordWatchlistCheck).mockResolvedValue({
      previousLastCheckedAt: "2026-01-01T00:00:00.000Z",
      checkedAt: "2026-01-02T00:00:00.000Z",
      jobs: [
        {
          source: "workday:acme",
          sourceJobId: "new-job",
          isNewSinceLastCheck: true,
          firstSeenAt: "2026-01-02T00:00:00.000Z",
          lastSeenAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(watchlistRepo.listWatchlistJobStates).mockResolvedValue([
      {
        source: "workday:acme",
        sourceJobId: "ignored-job",
        state: "ignored",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(jobsRepo.getJobListItems).mockResolvedValue([
      {
        id: "workspace-job",
        source: "bamboohr:beta",
        sourceJobId: "imported-job",
        title: "Imported",
        employer: "Beta",
        jobUrl: "https://beta.bamboohr.com/careers/2",
        applicationLink: "https://beta.bamboohr.com/careers/2",
        datePosted: null,
        deadline: null,
        salary: null,
        location: null,
        status: "discovered",
        outcome: null,
        closedAt: null,
        suitabilityScore: null,
        sponsorMatchScore: null,
        pdfRegenerating: false,
        pdfFreshness: "missing",
        salaryMinAmount: null,
        salaryMaxAmount: null,
        salaryCurrency: null,
        discoveredAt: "2026-01-01T00:00:00.000Z",
        readyAt: null,
        appliedAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as any,
    ]);
    vi.mocked(getWatchlistSourceAdapter).mockImplementation((sourceType) => {
      if (sourceType === "workday") {
        return {
          hydrateSelectedSource: (source: WatchlistSelectedSource) => ({
            ...source,
            label: "Hydrated Acme",
          }),
          fetchJobs: vi.fn().mockResolvedValue({
            total: 2,
            fetched: 2,
            jobs: [
              {
                jobRef: "https://example.com/new",
                source: "workday:acme",
                sourceJobId: "new-job",
                sourceType: "workday",
                title: "New Engineer",
                employer: "Acme",
                jobUrl: "https://example.com/new",
                applicationLink: "https://example.com/new",
                location: "London",
                postedAt: "2026-01-02",
              },
              {
                jobRef: "https://example.com/ignored",
                source: "workday:acme",
                sourceJobId: "ignored-job",
                sourceType: "workday",
                title: "Ignored Engineer",
                employer: "Acme",
                jobUrl: "https://example.com/ignored",
                applicationLink: "https://example.com/ignored",
                location: "London",
                postedAt: "2026-01-02",
              },
            ],
          }),
        } as any;
      }

      return {
        hydrateSelectedSource: (source: WatchlistSelectedSource) => source,
        fetchJobs: vi.fn().mockResolvedValue({
          total: 1,
          fetched: 1,
          jobs: [
            {
              jobRef: "https://beta.bamboohr.com/careers/2",
              source: "bamboohr:beta",
              sourceJobId: "imported-job",
              sourceType: "bamboohr",
              title: "Imported",
              employer: "Beta",
              jobUrl: "https://beta.bamboohr.com/careers/2",
              applicationLink: "https://beta.bamboohr.com/careers/2",
              location: "Remote",
              postedAt: null,
            },
          ],
        }),
      } as any;
    });
  });

  it("hydrates selected sources through their adapters", () => {
    expect(hydrateWatchlistSelectedSources([workdaySource])).toMatchObject([
      {
        id: "workday-source",
        label: "Hydrated Acme",
      },
    ]);
  });

  it("fetches sources, records checks, and annotates ignored/imported jobs", async () => {
    const result = await getWatchlistResultsForSources([workdaySource, bamboohrSource]);

    expect(watchlistRepo.recordWatchlistCheck).toHaveBeenCalledWith({
      checks: [
        { source: "workday:acme", sourceJobIds: ["new-job", "ignored-job"] },
        { source: "bamboohr:beta", sourceJobIds: ["imported-job"] },
      ],
    });
    expect(result.checkedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(result.sources).toHaveLength(2);

    const workdayJobs = result.sources[0]?.status === "success" ? result.sources[0].jobs : [];
    expect(workdayJobs.map((job) => job.rowState)).toEqual(["new", "ignored"]);
    expect(workdayJobs[0]?.isNewSinceLastCheck).toBe(true);

    const bamboohrJobs = result.sources[1]?.status === "success" ? result.sources[1].jobs : [];
    expect(bamboohrJobs[0]?.rowState).toBe("moved_to_workspace");
    expect(bamboohrJobs[0]?.workspaceJob).toEqual({
      id: "workspace-job",
      status: "discovered",
    });
  });

  it("matches ignored and imported careers-site postings across filters of the same host", async () => {
    const filter = (letter: string) => `careers_site:example.com?${letter.repeat(24)}`;
    const careers = makeSelectedSource({
      id: "careers-source",
      label: "Example",
      careersUrl: "https://example.com/careers?q=nurse",
      sourceType: "careers_site",
      isCustom: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const posting = (sourceJobId: string) => ({
      jobRef: `https://example.com/jobs/${sourceJobId}`,
      source: filter("b"),
      sourceJobId,
      sourceType: "careers_site",
      title: sourceJobId,
      employer: "Example",
      jobUrl: `https://example.com/jobs/${sourceJobId}`,
      applicationLink: `https://example.com/jobs/${sourceJobId}`,
      location: null,
      postedAt: null,
    });
    vi.mocked(getWatchlistSourceAdapter).mockReturnValue({
      hydrateSelectedSource: (source: WatchlistSelectedSource) => source,
      fetchJobs: vi.fn().mockResolvedValue({
        total: 3,
        fetched: 3,
        jobs: [posting("ignored-elsewhere"), posting("imported-elsewhere"), posting("fresh")],
      }),
    } as any);
    vi.mocked(watchlistRepo.listWatchlistJobStates).mockResolvedValue([
      {
        // Ignored while viewing the board under a different keyword.
        source: filter("a"),
        sourceJobId: "ignored-elsewhere",
        state: "ignored",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(jobsRepo.getJobListItems).mockResolvedValue([
      // Imported from the unfiltered board, so its source key carries no query digest.
      {
        id: "imported-job",
        source: "careers_site:example.com",
        sourceJobId: "imported-elsewhere",
        jobUrl: "https://example.com/other-url",
        status: "discovered",
      } as any,
    ]);
    const result = await getWatchlistResultsForSources([careers]);
    const jobs = result.sources[0]?.status === "success" ? result.sources[0].jobs : [];
    expect(jobs.map((job) => job.rowState)).toEqual(["ignored", "moved_to_workspace", "new"]);
  });

  it("does not widen matching for sources that are not careers sites", async () => {
    vi.mocked(watchlistRepo.listWatchlistJobStates).mockResolvedValue([
      {
        source: "workday:acme?other",
        sourceJobId: "ignored-job",
        state: "ignored",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const result = await getWatchlistResultsForSources([workdaySource]);
    const jobs = result.sources[0]?.status === "success" ? result.sources[0].jobs : [];
    expect(jobs.map((job) => job.rowState)).toEqual(["new", "new"]);
  });

  it("returns a timeout for a non-settling adapter while keeping other source results", async () => {
    vi.useFakeTimers();
    const workingAdapter = getWatchlistSourceAdapter("bamboohr");
    let stalledSignal: AbortSignal | undefined;
    vi.mocked(getWatchlistSourceAdapter).mockImplementation((sourceType) =>
      sourceType === "workday"
        ? ({
            fetchJobs: ({ signal }: { signal: AbortSignal }) => {
              stalledSignal = signal;
              return new Promise(() => {});
            },
          } as any)
        : workingAdapter,
    );
    let finished = false;
    const pending = getWatchlistResultsForSources([workdaySource, bamboohrSource]).then(
      (result) => {
        finished = true;
        return result;
      },
    );

    await vi.advanceTimersByTimeAsync(WATCHLIST_SOURCE_TIMEOUT_MS - 1);
    expect(finished).toBe(false);
    expect(stalledSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(stalledSignal?.aborted).toBe(true);
    expect(result.sources[0]).toMatchObject({
      status: "error",
      source: workdaySource,
      error: "Watchlist source timed out after 30s",
    });
    expect(result.sources[1]).toMatchObject({
      status: "success",
      source: bamboohrSource,
      fetched: 1,
    });
    expect(watchlistRepo.recordWatchlistCheck).toHaveBeenCalledWith({
      checks: [{ source: "bamboohr:beta", sourceJobIds: ["imported-job"] }],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the source timer after success or an adapter error", async () => {
    vi.useFakeTimers();
    await expect(withWatchlistSourceTimeout(async () => "done")).resolves.toBe("done");
    await expect(
      withWatchlistSourceTimeout(async () => {
        throw new Error("adapter failed");
      }),
    ).rejects.toThrow("adapter failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetches at most five sources concurrently", async () => {
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const releaseFetches: Array<() => void> = [];
    const fetchJobs = vi.fn(async () => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await new Promise<void>((resolve) => releaseFetches.push(resolve));
      activeFetches -= 1;
      return { total: 0, fetched: 0, jobs: [] };
    });
    vi.mocked(getWatchlistSourceAdapter).mockReturnValue({ fetchJobs } as any);
    const sources = Array.from({ length: 6 }, (_, index) => ({
      ...workdaySource,
      id: `workday-source-${index}`,
      careersUrl: `https://company${index}.wd1.myworkdayjobs.com/External`,
      sortOrder: index,
    }));

    const resultsPromise = getWatchlistResultsForSources(sources);

    await vi.waitFor(() => expect(fetchJobs).toHaveBeenCalledTimes(5));
    expect(maxActiveFetches).toBe(5);
    for (const release of releaseFetches.splice(0)) release();

    await vi.waitFor(() => expect(fetchJobs).toHaveBeenCalledTimes(6));
    expect(maxActiveFetches).toBe(5);
    for (const release of releaseFetches.splice(0)) release();

    const results = await resultsPromise;
    expect(results.sources.map((result) => result.source.id)).toEqual(
      sources.map((source) => source.id),
    );
  });

  describe("stored results", () => {
    const storedAt = "2026-01-03T00:00:00.000Z";
    const storedWorkday = {
      sourceKey: "workday|https://acme.wd1.myworkdayjobs.com/acme",
      status: "success" as const,
      resultJson: JSON.stringify({
        status: "success",
        total: 2,
        fetched: 2,
        jobs: [
          {
            jobRef: "https://example.com/new",
            source: "workday:acme",
            sourceJobId: "new-job",
            sourceType: "workday",
            title: "New Engineer",
            employer: "Acme",
            jobUrl: "https://example.com/new",
            applicationLink: null,
            location: null,
            postedAt: null,
            isNewSinceLastCheck: true,
          },
          {
            jobRef: "https://example.com/ignored",
            source: "workday:acme",
            sourceJobId: "ignored-job",
            sourceType: "workday",
            title: "Ignored Engineer",
            employer: "Acme",
            jobUrl: "https://example.com/ignored",
            applicationLink: null,
            location: null,
            postedAt: null,
            isNewSinceLastCheck: true,
          },
        ],
      }),
      checkedAt: storedAt,
      previousCheckedAt: "2026-01-02T00:00:00.000Z",
    };
    const storedBamboohrError = {
      sourceKey: "bamboohr|https://beta.bamboohr.com/careers",
      status: "error" as const,
      resultJson: JSON.stringify({ status: "error", error: "Beta is unhealthy" }),
      checkedAt: "2026-01-02T12:00:00.000Z",
      previousCheckedAt: null,
    };
    beforeEach(() => {
      vi.mocked(watchlistRepo.listWatchlistSelectedSources).mockResolvedValue([
        workdaySource,
        bamboohrSource,
      ]);
    });

    it("serves each source's last check without fetching or recording a new check", async () => {
      vi.mocked(watchlistRepo.listWatchlistSourceResults).mockResolvedValue([
        storedWorkday,
        storedBamboohrError,
      ]);

      const result = await getCurrentWatchlistResults();

      expect(watchlistRepo.recordWatchlistCheck).not.toHaveBeenCalled();
      expect(watchlistRepo.saveWatchlistSourceResults).not.toHaveBeenCalled();
      expect(result.checkedAt).toBe(storedAt);
      expect(result.previousLastCheckedAt).toBe("2026-01-02T00:00:00.000Z");
      expect(result.sources[1]).toMatchObject({ status: "error", error: "Beta is unhealthy" });
      const jobs = result.sources[0]?.status === "success" ? result.sources[0].jobs : [];
      // Ignored/imported state is live; the "new since last check" flag is the stored one.
      expect(jobs.map((job) => [job.rowState, job.isNewSinceLastCheck])).toEqual([
        ["new", true],
        ["ignored", false],
      ]);
    });

    it("fetches and stores only sources that were never checked", async () => {
      vi.mocked(watchlistRepo.listWatchlistSourceResults).mockResolvedValue([storedWorkday]);

      const result = await getCurrentWatchlistResults();

      expect(watchlistRepo.recordWatchlistCheck).toHaveBeenCalledWith({
        checks: [{ source: "bamboohr:beta", sourceJobIds: ["imported-job"] }],
      });
      const saved = vi.mocked(watchlistRepo.saveWatchlistSourceResults).mock.calls[0]?.[0];
      expect(saved?.map((entry) => entry.sourceKey)).toEqual([
        "bamboohr|https://beta.bamboohr.com/careers",
      ]);
      expect(result.sources[1]).toMatchObject({ status: "success", fetched: 1 });
      // The other source still comes from its stored check.
      expect(result.sources[0]).toMatchObject({ status: "success", fetched: 2 });
    });

    it("re-checks an unhealthy source on refresh and remembers the new outcome", async () => {
      vi.mocked(watchlistRepo.listWatchlistSourceResults).mockResolvedValue([
        storedWorkday,
        storedBamboohrError,
      ]);

      const result = await getCurrentWatchlistResults({
        refresh: true,
        sourceIds: [bamboohrSource.id],
      });

      expect(watchlistRepo.recordWatchlistCheck).toHaveBeenCalledTimes(1);
      expect(watchlistRepo.recordWatchlistCheck).toHaveBeenCalledWith({
        checks: [{ source: "bamboohr:beta", sourceJobIds: ["imported-job"] }],
      });
      const saved = vi.mocked(watchlistRepo.saveWatchlistSourceResults).mock.calls[0]?.[0] ?? [];
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        sourceKey: "bamboohr|https://beta.bamboohr.com/careers",
        status: "success",
        checkedAt: "2026-01-02T00:00:00.000Z",
      });
      expect(result.sources[1]).toMatchObject({ status: "success" });
    });

    it("re-checks every source on a full refresh", async () => {
      vi.mocked(watchlistRepo.listWatchlistSourceResults).mockResolvedValue([
        storedWorkday,
        storedBamboohrError,
      ]);

      await getCurrentWatchlistResults({ refresh: true });

      const saved = vi.mocked(watchlistRepo.saveWatchlistSourceResults).mock.calls[0]?.[0] ?? [];
      expect(saved.map((entry) => entry.sourceKey).sort()).toEqual([
        "bamboohr|https://beta.bamboohr.com/careers",
        "workday|https://acme.wd1.myworkdayjobs.com/acme",
      ]);
    });

    it("treats an unreadable stored result as never checked", async () => {
      vi.mocked(watchlistRepo.listWatchlistSourceResults).mockResolvedValue([
        { ...storedWorkday, resultJson: "not json" },
        storedBamboohrError,
      ]);

      const result = await getCurrentWatchlistResults();

      expect(watchlistRepo.recordWatchlistCheck).toHaveBeenCalledWith({
        checks: [{ source: "workday:acme", sourceJobIds: ["new-job", "ignored-job"] }],
      });
      expect(result.sources[0]).toMatchObject({ status: "success", fetched: 2 });
    });

    it("still returns fresh results when storing them fails", async () => {
      vi.mocked(watchlistRepo.saveWatchlistSourceResults).mockRejectedValue(new Error("disk full"));

      const result = await getCurrentWatchlistResults();

      expect(result.sources.map((source) => source.status)).toEqual(["success", "success"]);
    });

    it("returns an empty response without any sources", async () => {
      vi.mocked(watchlistRepo.listWatchlistSelectedSources).mockResolvedValue([]);

      await expect(getCurrentWatchlistResults()).resolves.toEqual({
        checkedAt: null,
        previousLastCheckedAt: null,
        sources: [],
      });
    });
  });
});
