import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getExtractorRegistry } from "@server/extractors/registry";
import {
  getRemoteContainerExtractorRunner,
  pickSafeContainerExtractorSettings,
} from "@server/extractors/remote-container-runner";
import { getRequestId, getUserId } from "@server/infra/request-context";
import { parseWorkplaceTypes } from "@server/pipeline/settings-parsers";
import { getAllJobUrls } from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import {
  closeHiringCafeBrowser,
  readHiringCafeBrowserPage,
} from "@server/services/hiring-cafe-browser";
import { withHostedUsageReservation } from "@server/services/hosted-usage";
import {
  buildSourceRunCacheKey,
  buildTermCacheKey,
  extractRequestedLimits,
  isScrapeCacheEnabled,
  readScrapeCache,
  writeScrapeCache,
} from "@server/services/scrape-cache";
import { resolveNearbyPlaceNames } from "@server/services/proximity-search";
import {
  getPrivateCloudflareCookieStorageDir,
  getPrivateDataScope,
} from "@server/tenancy/private-scope";
import { asyncPool } from "@server/utils/async-pool";
import { listHydratedWatchlistSelectedSources } from "@server/watchlist/results";
import type { ExtractorSourceId } from "@shared/extractors";
import { deduplicateJobsByTitleAndEmployer, matchJobLocationIntent } from "@shared/job-matching.js";
import {
  buildLocationEvidence as buildSharedLocationEvidence,
  createLocationIntentFromLegacyInputs,
  getPrimaryLocationLabel,
  planLocationSource,
} from "@shared/location-domain.js";
import { formatCountryLabel } from "@shared/location-support.js";
import { normalizeStringArray } from "@shared/normalize-string-array.js";
import { type CreateJobInput, deriveExtractorLimits, type PipelineConfig } from "@shared/types";
import {
  type CrawlSource,
  type PendingChallenge,
  progressHelpers,
  updateProgress,
} from "../progress";
import { discoverWatchlistJobsForPipeline } from "./watchlist-jobs";
import {
  canUseServerCredentials,
  hasOwnExtractorCredentials,
  isOperatorContext,
} from "@server/services/server-credentials";

const DISCOVERY_CONCURRENCY = 3;
const DISCOVERY_SOURCE_TIMEOUT_MS = 10 * 60 * 1000;

type DiscoveryTaskResult = {
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
  challenge?: PendingChallenge;
  fatal?: boolean;
};

type DiscoverySourceTask = {
  source: CrawlSource;
  termsTotal?: number;
  detail: string;
  run: () => Promise<DiscoveryTaskResult>;
};

async function withDiscoverySourceTimeout<T>(run: Promise<T>, onTimeout: () => void): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout();
      reject(new Error("timed out after 10 minutes"));
    }, DISCOVERY_SOURCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([run, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseBlockedCompanyKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeStringArray(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return [];
  }
}

function isBlockedEmployer(
  employer: string | null | undefined,
  blockedKeywordsLowerCase: string[],
): boolean {
  if (!employer) return false;
  if (blockedKeywordsLowerCase.length === 0) return false;
  const normalizedEmployer = employer.toLowerCase();
  return blockedKeywordsLowerCase.some((keyword) => normalizedEmployer.includes(keyword));
}

function getLegacyLocationSelection(intent: NonNullable<PipelineConfig["locationIntent"]>): string {
  return intent.selectedCountry ?? "";
}

function getSourceLocationPlan(
  source: CrawlSource,
  intent: NonNullable<PipelineConfig["locationIntent"]>,
  capabilities?: Parameters<typeof planLocationSource>[0]["capabilities"],
): ReturnType<typeof planLocationSource> & {
  canRun: boolean;
  warnings: string[];
} {
  const plan = planLocationSource({ source, intent, capabilities });
  return {
    ...plan,
    canRun: plan.isCompatible,
    warnings: plan.reasons,
  };
}

function buildLocationEvidence(args: {
  location?: string | null;
  isRemote?: boolean | null;
  sourceNotes?: readonly string[] | null;
}): CreateJobInput["locationEvidence"] {
  if (!args.location && args.isRemote !== true) return undefined;
  return buildSharedLocationEvidence({
    location: args.location ?? (args.isRemote ? "Remote" : null),
    isRemote: args.isRemote ?? null,
    source: args.sourceNotes?.find((note) => note.startsWith("source:"))?.slice(7) ?? null,
  });
}

export async function discoverJobsStep(args: {
  mergedConfig: PipelineConfig;
  includeWatchlist?: boolean;
  preserveFanout?: boolean;
  fanoutSeedJobs?: CreateJobInput[];
  retryChallengeUrls?: Record<string, string>;
  resumeStates?: Record<string, unknown>;
  skippedChallengeSearchStates?: string[];
  watchlistSelectedSourceIds?: string[] | null;
  shouldCancel?: () => boolean;
  onSourceDiscovered?: (jobs: CreateJobInput[], source: string) => Promise<void> | void;
}): Promise<{
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
  pendingChallenges: PendingChallenge[];
}> {
  logger.info("Running discovery step");

  const discoveredJobs: CreateJobInput[] = [];
  const sourceErrors: string[] = [];
  const includeWatchlist = args.includeWatchlist !== false;
  const watchlistFilterIds = args.watchlistSelectedSourceIds ?? null;
  // [] explicitly disables Watchlist for this run; treat as "no Watchlist
  // sources" without short-circuiting includeWatchlist (so the explicit
  // disable still emits accurate progress totals).
  const watchlistExplicitlyDisabled =
    Array.isArray(watchlistFilterIds) && watchlistFilterIds.length === 0;

  const settings = await settingsRepo.getAllSettings();
  const registry = await getExtractorRegistry();

  const searchTermsSetting = settings.searchTerms;
  let searchTerms: string[] = [];

  if (searchTermsSetting) {
    searchTerms = JSON.parse(searchTermsSetting) as string[];
  } else {
    const defaultSearchTermsEnv = (await isOperatorContext())
      ? process.env.JOBSPY_SEARCH_TERMS || "web developer"
      : "web developer";
    searchTerms = defaultSearchTermsEnv
      .split("|")
      .map((term) => term.trim())
      .filter(Boolean);
  }

  let locationIntent =
    args.mergedConfig.locationIntent ??
    createLocationIntentFromLegacyInputs({
      selectedCountry: settings.jobspyCountryIndeed ?? "",
      searchCities: settings.searchCities ?? settings.jobspyLocation ?? "",
      workplaceTypes: parseWorkplaceTypes(settings.workplaceTypes),
      searchScope: settings.locationSearchScope,
      matchStrictness: settings.locationMatchStrictness,
      proximity:
        settings.locationSearchMode === "radius" &&
        settings.locationLatitude != null &&
        settings.locationLongitude != null
          ? {
              latitude: Number(settings.locationLatitude),
              longitude: Number(settings.locationLongitude),
              radiusMiles: Number(settings.locationRadiusMiles ?? 50),
            }
          : null,
    });
  if (locationIntent.proximity) {
    locationIntent = {
      ...locationIntent,
      cityLocations: await resolveNearbyPlaceNames(locationIntent.proximity),
    };
  }
  const sourcePlans = args.mergedConfig.sources.map((source) => ({
    source,
    plan: getSourceLocationPlan(
      source,
      locationIntent,
      registry.locationCapabilitiesBySource?.[source],
    ),
  }));
  const sourcePlanBySource = new Map(sourcePlans.map(({ source, plan }) => [source, plan]));
  const compatibleSources = sourcePlans
    .filter(({ plan }) => plan.canRun)
    .map(({ source }) => source);
  const runSettings =
    args.mergedConfig.runBudget !== undefined
      ? Object.fromEntries(
          Object.entries(
            deriveExtractorLimits({
              budget: args.mergedConfig.runBudget,
              searchTerms,
              sources: compatibleSources,
            }),
          ).map(([key, value]) => [key, String(value)]),
        )
      : {};
  let existingJobUrlsPromise: Promise<string[]> | null = null;
  const getExistingJobUrls = (): Promise<string[]> => {
    if (!existingJobUrlsPromise) {
      existingJobUrlsPromise = getAllJobUrls();
    }
    return existingJobUrlsPromise;
  };
  const skippedSources = sourcePlans.filter(({ plan }) => !plan.canRun);

  if (skippedSources.length > 0) {
    logger.info("Skipping incompatible sources for requested location intent", {
      step: "discover-jobs",
      locationIntent: {
        selectedCountry: locationIntent.selectedCountry,
        cityCount: locationIntent.cityLocations.length,
        radiusMiles: locationIntent.proximity?.radiusMiles ?? null,
      },
      primaryLocation: getPrimaryLocationLabel(locationIntent),
      requestedSources: args.mergedConfig.sources,
      skippedSources: skippedSources.map(({ source }) => source),
      warnings: skippedSources.flatMap(({ plan }) => plan.warnings),
    });
  }

  if (args.mergedConfig.sources.length > 0 && compatibleSources.length === 0) {
    throw new Error(
      locationIntent.selectedCountry
        ? `No compatible sources for selected country: ${formatCountryLabel(locationIntent.selectedCountry)}`
        : `No compatible sources for requested location: ${getPrimaryLocationLabel(locationIntent)}`,
    );
  }

  const groupedByManifest = new Map<
    string,
    { sources: string[]; detail: string; termsTotal?: number }
  >();

  // Sources that authenticate with the operator's accounts (e.g. Adzuna) are
  // off limits to other users unless the extractor takes their own credentials.
  const mayUseServerCredentials = await canUseServerCredentials();

  for (const source of compatibleSources) {
    const manifest = registry.manifestBySource.get(source);
    if (!manifest) {
      sourceErrors.push(`${source}: extractor manifest not registered`);
      continue;
    }
    if (
      !mayUseServerCredentials &&
      !hasOwnExtractorCredentials(manifest, settings as Record<string, string | undefined>)
    ) {
      sourceErrors.push(`${source}: not available for your account`);
      continue;
    }

    const existing = groupedByManifest.get(manifest.id);
    if (existing) {
      existing.sources.push(source);
      continue;
    }

    groupedByManifest.set(manifest.id, {
      sources: [source],
      termsTotal: searchTerms.length,
      detail: `${manifest.displayName}: fetching jobs...`,
    });
  }

  const sourceTasks: DiscoverySourceTask[] = [];

  for (const [manifestId, grouped] of groupedByManifest) {
    const manifest = registry.manifests.get(manifestId);
    if (!manifest) continue;

    sourceTasks.push({
      source: manifest.id,
      termsTotal: grouped.termsTotal,
      detail:
        grouped.sources.length > 1
          ? `${manifest.displayName}: ${grouped.sources.join(", ")}...`
          : grouped.detail,
      run: async () => {
        const filteredSettings = Object.fromEntries(
          Object.entries({ ...settings, ...runSettings }).filter(
            ([, value]) => typeof value === "string" || typeof value === "undefined",
          ),
        ) as Record<string, string | undefined>;

        // A challenge retry/resume is a continuation of a specific earlier run, never a repeat.
        const cacheable =
          isScrapeCacheEnabled() &&
          !args.retryChallengeUrls?.[manifest.id] &&
          args.resumeStates?.[manifest.id] === undefined &&
          !args.skippedChallengeSearchStates?.length;
        // Hiring Cafe checkpoints are positions in the full term list, so it is cached as one
        // run; every other source is cached per search term so that adding or removing a term
        // only re-scrapes that term.
        const perTermCache = cacheable && manifest.id !== "hiringcafe" && searchTerms.length > 0;
        const safeSettings = pickSafeContainerExtractorSettings(manifest.id, filteredSettings);
        const requestedLimits = extractRequestedLimits(filteredSettings);
        const scrapeCacheKey =
          cacheable && !perTermCache
            ? buildSourceRunCacheKey({
                manifestId: manifest.id,
                sources: grouped.sources,
                searchTerms,
                locationIntent,
                settings: safeSettings,
              })
            : null;
        if (scrapeCacheKey) {
          const cached = await readScrapeCache(scrapeCacheKey);
          if (cached) {
            logger.info("Reusing recent extractor results", {
              step: "discover-jobs",
              source: manifest.id,
              jobCount: cached.jobs.length,
              completedAt: cached.completedAt,
            });
            updateProgress({
              step: "crawling",
              detail: `${manifest.displayName}: reusing results from the last 24 hours`,
            });
            return {
              discoveredJobs: cached.jobs,
              sourceErrors: cached.sourceErrors,
            };
          }
        }

        let timedOut = false;
        const shouldCancel = () => timedOut || args.shouldCancel?.() === true;
        const browserScopeKey =
          manifest.id === "hiringcafe" ? getPrivateDataScope().scopeKey : null;
        const browserCookieDir = browserScopeKey ? getPrivateCloudflareCookieStorageDir() : null;
        const sourceLocationPlan = getSourceLocationPlan(
          grouped.sources[0] as CrawlSource,
          locationIntent,
          registry.locationCapabilitiesBySource?.[grouped.sources[0] as ExtractorSourceId],
        );
        const remoteRunner = getRemoteContainerExtractorRunner();
        const runViaRemote = (terms: string[]) => {
          if (!remoteRunner) {
            throw new Error(`Remote container runner unavailable for ${manifest.id}`);
          }
          return remoteRunner({
            manifestId: manifest.id,
            source: grouped.sources[0] as ExtractorSourceId,
            selectedSources: grouped.sources,
            searchTerms: terms,
            selectedCountry: getLegacyLocationSelection(locationIntent),
            settings: safeSettings,
            locationIntent,
            sourceLocationPlan,
            runtime: "container",
            requestId: getRequestId(),
          });
        };
        // `termProgress` places a single-term call inside the whole run's term counters.
        const runLocalManifest = (
          terms: string[],
          termProgress?: { done: number; total: number },
        ) =>
          manifest.run({
            source: grouped.sources[0],
            selectedSources: grouped.sources,
            settings: filteredSettings,
            searchTerms: terms,
            selectedCountry: getLegacyLocationSelection(locationIntent),
            cookieStorageDir: getPrivateCloudflareCookieStorageDir(),
            browserPageReader:
              browserScopeKey && browserCookieDir
                ? (url) => readHiringCafeBrowserPage(browserScopeKey, browserCookieDir, url)
                : undefined,
            retryChallengeUrl: args.retryChallengeUrls?.[manifest.id],
            resumeState: args.resumeStates?.[manifest.id],
            skippedChallengeSearchStates: args.skippedChallengeSearchStates,
            locationIntent,
            sourceLocationPlan,
            getExistingJobUrls,
            shouldCancel,
            onProgress: (event) => {
              if (shouldCancel()) return;
              const role =
                searchTerms.find((term) => event.currentUrl === term) ??
                searchTerms.find((term) => event.currentUrl?.startsWith(`${term} @`));
              if (event.termsProcessed !== undefined && role) {
                progressHelpers.updateFanoutTaskTerms(
                  manifest.id,
                  role,
                  event.termsProcessed,
                  event.termsTotal,
                );
              }
              // One call covers one term across every location, so scale by the location count
              // (the call's own total) to keep the counters in whole-run units.
              const unit = event.termsTotal ?? 1;
              const scale = event.termsTotal !== undefined ? termProgress : undefined;
              progressHelpers.crawlingUpdate({
                source: manifest.id,
                termsProcessed:
                  scale && event.termsProcessed !== undefined
                    ? scale.done * unit + event.termsProcessed
                    : event.termsProcessed,
                termsTotal: scale ? scale.total * unit : event.termsTotal,
                listPagesProcessed: event.listPagesProcessed,
                listPagesTotal: event.listPagesTotal,
                jobCardsFound: event.jobCardsFound,
                jobPagesEnqueued: event.jobPagesEnqueued,
                jobPagesSkipped: event.jobPagesSkipped,
                jobPagesProcessed: event.jobPagesProcessed,
                phase: event.phase,
                currentUrl: event.currentUrl,
              });

              if (event.detail) {
                updateProgress({
                  step: "crawling",
                  detail: event.detail,
                });
              }
            },
          });
        const runExtractor = async (
          terms: string[],
          termProgress?: { done: number; total: number },
        ) => {
          if (manifest.runtime === "container" && remoteRunner) {
            return runViaRemote(terms);
          }
          return runLocalManifest(terms, termProgress);
        };

        // Replays each term cached in the last 24 hours and calls the extractor once for every
        // other term, so each term's jobs can be stored under that term. The result has the same
        // shape as a single extractor call.
        const runPerTerm = async (): Promise<Awaited<ReturnType<typeof runExtractor>>> => {
          const seenTerms = new Set<string>();
          const uniqueTerms = searchTerms.filter((term) => {
            const normalized = term.trim().toLowerCase();
            if (seenTerms.has(normalized)) return false;
            seenTerms.add(normalized);
            return true;
          });
          const entries = await Promise.all(
            uniqueTerms.map(async (term) => {
              const key = buildTermCacheKey({
                manifestId: manifest.id,
                sources: grouped.sources,
                term,
                locationIntent,
                settings: safeSettings,
              });
              return {
                term,
                key,
                cached: await readScrapeCache(key, { limits: requestedLimits }),
              };
            }),
          );

          const jobsByUrl = new Map<string, CreateJobInput>();
          const addJobs = (jobs: CreateJobInput[]) => {
            for (const job of jobs) {
              if (!jobsByUrl.has(job.jobUrl)) jobsByUrl.set(job.jobUrl, job);
            }
          };
          const missing: typeof entries = [];
          for (const entry of entries) {
            if (entry.cached) addJobs(entry.cached.jobs);
            else missing.push(entry);
          }
          const cachedTermCount = entries.length - missing.length;
          if (cachedTermCount > 0) {
            logger.info("Reusing recent extractor results", {
              step: "discover-jobs",
              source: manifest.id,
              cachedTermCount,
              termCount: entries.length,
              jobCount: jobsByUrl.size,
            });
            updateProgress({
              step: "crawling",
              detail: `${manifest.displayName}: reusing ${cachedTermCount} of ${entries.length} terms from the last 24 hours`,
            });
          }

          const errors: string[] = [];
          for (const [index, entry] of missing.entries()) {
            if (shouldCancel()) break;
            const termResult = await runExtractor([entry.term], {
              done: cachedTermCount + index,
              total: entries.length,
            });
            if (!termResult.success) {
              // Terms finished earlier are already cached and stay in this run; only a run with
              // nothing to show is reported as a failed source.
              if (jobsByUrl.size === 0) return { ...termResult, jobs: [] };
              errors.push(
                `${manifest.displayName || manifest.id}: ${termResult.error ?? "unknown error"} (term: ${entry.term})`,
              );
              break;
            }
            addJobs(termResult.jobs);
            const termErrors = termResult.sourceErrors ?? [];
            errors.push(...termErrors);
            if (termResult.challengeRequired) {
              return {
                success: true,
                jobs: [...jobsByUrl.values()],
                sourceErrors: errors,
                challengeRequired: termResult.challengeRequired,
                resumeState: termResult.resumeState,
              };
            }
            // Same rule as a whole run: only clean, complete, non-empty results are reusable.
            if (termErrors.length === 0 && !shouldCancel()) {
              await writeScrapeCache({
                scrapeKey: entry.key,
                source: manifest.id,
                runtime: manifest.runtime,
                jobs: termResult.jobs,
                sourceErrors: [],
                limits: requestedLimits,
              });
            }
          }
          return { success: true, jobs: [...jobsByUrl.values()], sourceErrors: errors };
        };

        const run = perTermCache ? runPerTerm() : runExtractor(searchTerms);
        let result: Awaited<typeof run>;
        try {
          result = await withDiscoverySourceTimeout(run, () => {
            timedOut = true;
          });
        } catch (error) {
          if (browserScopeKey) await closeHiringCafeBrowser(browserScopeKey);
          throw error;
        }
        if (browserScopeKey && !result.challengeRequired) {
          await closeHiringCafeBrowser(browserScopeKey);
        }

        if (!result.success) {
          return {
            discoveredJobs: [],
            sourceErrors: [
              `${manifest.displayName || manifest.id}: ${result.error ?? "unknown error"} (sources: ${grouped.sources.join(",")})`,
            ],
            fatal: true,
            challenge: result.challengeRequired
              ? {
                  extractorId: manifest.id,
                  extractorName: manifest.displayName || manifest.id,
                  url: result.challengeRequired,
                  resumeState: result.resumeState,
                  sources: grouped.sources as ExtractorSourceId[],
                }
              : undefined,
          };
        }

        // Only clean, complete, non-empty runs are worth reusing: a partial or challenged run
        // would otherwise be replayed as if it were the full answer for a day.
        if (
          scrapeCacheKey &&
          !result.challengeRequired &&
          !timedOut &&
          !shouldCancel() &&
          (result.sourceErrors ?? []).length === 0
        ) {
          await writeScrapeCache({
            scrapeKey: scrapeCacheKey,
            source: manifest.id,
            runtime: manifest.runtime,
            jobs: result.jobs,
            sourceErrors: [],
          });
        }

        return {
          discoveredJobs: result.jobs,
          sourceErrors: result.sourceErrors ?? [],
          challenge: result.challengeRequired
            ? {
                extractorId: manifest.id,
                extractorName: manifest.displayName || manifest.id,
                url: result.challengeRequired,
                resumeState: result.resumeState,
                sources: grouped.sources as ExtractorSourceId[],
              }
            : undefined,
        };
      },
    });
  }

  let watchlistSelectedSources: Awaited<ReturnType<typeof listHydratedWatchlistSelectedSources>> =
    [];
  if (includeWatchlist && !watchlistExplicitlyDisabled && getUserId()) {
    try {
      watchlistSelectedSources = await listHydratedWatchlistSelectedSources();
    } catch (error) {
      logger.warn("Failed to load Watchlist sources for pipeline discovery", {
        step: "discover-jobs",
        error: sanitizeUnknown(error),
      });
      sourceErrors.push("Watchlist: failed to load selected sources");
    }

    // When the caller passed an explicit subset, intersect by ID and drop
    // anything the current user does not own. Never trust the client to
    // scope across tenants — IDs always re-resolve through the user-scoped
    // listHydratedWatchlistSelectedSources() call above.
    if (
      Array.isArray(watchlistFilterIds) &&
      watchlistFilterIds.length > 0 &&
      watchlistSelectedSources.length > 0
    ) {
      const ownedIds = new Set(watchlistSelectedSources.map((source) => source.id));
      const requestedIds = new Set(watchlistFilterIds);
      const unknownIds = watchlistFilterIds.filter((id) => !ownedIds.has(id));
      if (unknownIds.length > 0) {
        logger.warn("Ignoring unknown Watchlist source IDs in pipeline discovery", {
          step: "discover-jobs",
          unknownIdCount: unknownIds.length,
          requestedIdCount: watchlistFilterIds.length,
        });
      }
      watchlistSelectedSources = watchlistSelectedSources.filter((source) =>
        requestedIds.has(source.id),
      );
    }
  }

  const totalSources = sourceTasks.length + (watchlistSelectedSources.length > 0 ? 1 : 0);
  let completedSources = 0;
  let successfulSearchUnits = 0;

  progressHelpers.startCrawling(totalSources, args.preserveFanout);
  if (!args.preserveFanout) {
    const locationCount = Math.max(1, locationIntent.cityLocations.length);
    progressHelpers.initializeFanout({
      roles: searchTerms,
      tasks: [
        ...sourceTasks.map((task) => ({
          id: task.source,
          unitsPerRole: (groupedByManifest.get(task.source)?.sources.length ?? 1) * locationCount,
        })),
        ...(watchlistSelectedSources.length > 0
          ? [{ id: "watchlist", unitsPerRole: locationCount }]
          : []),
      ],
      locations:
        locationIntent.cityLocations.length > 0
          ? locationIntent.cityLocations
          : [getPrimaryLocationLabel(locationIntent)],
      sources: [
        ...compatibleSources,
        ...(watchlistSelectedSources.length > 0 ? ["watchlist"] : []),
      ],
      locationCount,
      sourceCount: compatibleSources.length + (watchlistSelectedSources.length > 0 ? 1 : 0),
      capacity: DISCOVERY_CONCURRENCY,
    });
  }

  if (args.shouldCancel?.()) {
    return { discoveredJobs, sourceErrors, pendingChallenges: [] };
  }
  if (totalSources === 0) {
    return { discoveredJobs, sourceErrors, pendingChallenges: [] };
  }

  return withHostedUsageReservation(
    {
      action: "job_search",
      units: totalSources,
    },
    async () => {
      const settledJobs: CreateJobInput[] = [...(args.fanoutSeedJobs ?? [])];
      const liveBlockedKeywordsLowerCase = parseBlockedCompanyKeywords(
        settings.blockedCompanyKeywords,
      ).map((value) => value.toLowerCase());
      const filterForFanout = (jobs: CreateJobInput[]) =>
        jobs
          .filter((job) => {
            const evidence =
              job.locationEvidence ??
              buildLocationEvidence({
                location: job.location,
                isRemote: job.isRemote,
                sourceNotes: [`source:${job.source}`],
              });
            job.locationEvidence = evidence;
            return matchJobLocationIntent(job, locationIntent, {
              nativeRadiusApplied:
                sourcePlanBySource.get(job.source as ExtractorSourceId)?.usesNativeRadius ?? false,
            }).matched;
          })
          .filter((job) => !isBlockedEmployer(job.employer, liveBlockedKeywordsLowerCase));
      const updateFanoutResults = () => {
        progressHelpers.updateFanoutResults(
          settledJobs.length,
          deduplicateJobsByTitleAndEmployer(filterForFanout(settledJobs)).length,
        );
      };
      const sourceResults = await asyncPool<DiscoverySourceTask, DiscoveryTaskResult>({
        items: sourceTasks,
        concurrency: DISCOVERY_CONCURRENCY,
        shouldStop: args.shouldCancel,
        onTaskStarted: (sourceTask) => {
          progressHelpers.startFanoutTask(sourceTask.source);
          progressHelpers.startSource(sourceTask.source, completedSources, totalSources, {
            termsTotal: sourceTask.termsTotal,
            detail: sourceTask.detail,
          });
        },
        onTaskSettled: (sourceTask, _index, outcome) => {
          completedSources += 1;
          progressHelpers.completeSource(completedSources, totalSources);
          if (outcome.status === "fulfilled") {
            settledJobs.push(...outcome.result.discoveredJobs);
            progressHelpers.settleFanoutTask(
              sourceTask.source,
              outcome.result.challenge ? "check" : "complete",
            );
            updateFanoutResults();
          } else {
            progressHelpers.settleFanoutTask(sourceTask.source, "complete");
          }
        },
        task: async (sourceTask) => {
          try {
            const result = await sourceTask.run();
            if (
              args.onSourceDiscovered &&
              result.discoveredJobs.length > 0 &&
              !args.shouldCancel?.()
            ) {
              const filtered = filterForFanout(result.discoveredJobs);
              if (filtered.length > 0) {
                await args.onSourceDiscovered(filtered, sourceTask.source);
              }
            }
            return result;
          } catch (error) {
            logger.warn("Discovery source task failed", {
              sourceTask: sourceTask.source,
              error: sanitizeUnknown(error),
            });

            return {
              discoveredJobs: [],
              sourceErrors: [
                `${sourceTask.source}: ${error instanceof Error ? error.message : "unknown error"}`,
              ],
              fatal: true,
            };
          }
        },
      });

      // Collect challenges after ALL extractors finish, not on first failure.
      // This way the user sees every challenged site at once and can solve them
      // in a single batch, rather than solve-one → re-run → hit-next → solve-again.
      const pendingChallenges: PendingChallenge[] = [];
      for (const sourceResult of sourceResults) {
        discoveredJobs.push(...sourceResult.discoveredJobs);
        sourceErrors.push(...sourceResult.sourceErrors);
        if (sourceResult.challenge) {
          pendingChallenges.push(sourceResult.challenge);
        } else if (!sourceResult.fatal) {
          successfulSearchUnits += 1;
        }
      }

      if (watchlistSelectedSources.length > 0 && !args.shouldCancel?.()) {
        progressHelpers.startFanoutTask("watchlist");
        progressHelpers.startSource("watchlist", completedSources, totalSources, {
          detail: "Watchlist: fetching saved sources...",
        });
        const watchlistResult = await discoverWatchlistJobsForPipeline({
          selectedSources: watchlistSelectedSources,
          searchTerms,
          shouldCancel: args.shouldCancel,
        });
        completedSources += 1;
        progressHelpers.completeSource(completedSources, totalSources);

        if (
          args.onSourceDiscovered &&
          watchlistResult.discoveredJobs.length > 0 &&
          !args.shouldCancel?.()
        ) {
          const filtered = filterForFanout(watchlistResult.discoveredJobs);
          if (filtered.length > 0) {
            await args.onSourceDiscovered(filtered, "watchlist");
          }
        }

        discoveredJobs.push(...watchlistResult.discoveredJobs);
        settledJobs.push(...watchlistResult.discoveredJobs);
        progressHelpers.settleFanoutTask("watchlist", "complete");
        updateFanoutResults();
        sourceErrors.push(...watchlistResult.sourceErrors);
        if (watchlistResult.failedSourceCount < watchlistResult.selectedSourceCount) {
          successfulSearchUnits += 1;
        }

        if (
          sourceTasks.length === 0 &&
          watchlistResult.selectedSourceCount > 0 &&
          watchlistResult.failedSourceCount === watchlistResult.selectedSourceCount
        ) {
          throw new Error(`All sources failed: ${sourceErrors.join("; ")}`);
        }
      }

      const locationFilterReasonCounts: Record<string, number> = {};
      const locationFilteredJobs = discoveredJobs.filter((job) => {
        const evidence =
          job.locationEvidence ??
          buildLocationEvidence({
            location: job.location,
            isRemote: job.isRemote,
            sourceNotes: [`source:${job.source}`],
          });
        job.locationEvidence = evidence;
        const match = matchJobLocationIntent(job, locationIntent, {
          nativeRadiusApplied:
            sourcePlanBySource.get(job.source as ExtractorSourceId)?.usesNativeRadius ?? false,
        });
        if (match.matched) {
          return true;
        }
        const reasonCode = match.reasonCode;
        locationFilterReasonCounts[reasonCode] = (locationFilterReasonCounts[reasonCode] ?? 0) + 1;
        return false;
      });
      const locationFilteredOutCount = discoveredJobs.length - locationFilteredJobs.length;

      if (locationFilteredOutCount > 0) {
        logger.info("Dropped discovered jobs that did not satisfy location preferences", {
          step: "discover-jobs",
          droppedCount: locationFilteredOutCount,
          locationIntent: {
            selectedCountry: locationIntent.selectedCountry,
            cityCount: locationIntent.cityLocations.length,
            radiusMiles: locationIntent.proximity?.radiusMiles ?? null,
          },
          primaryLocation: getPrimaryLocationLabel(locationIntent),
          reasonCounts: locationFilterReasonCounts,
        });
      }

      const blockedCompanyKeywords = parseBlockedCompanyKeywords(settings.blockedCompanyKeywords);
      const blockedKeywordsLowerCase = blockedCompanyKeywords.map((value) => value.toLowerCase());
      const filteredDiscoveredJobs = locationFilteredJobs.filter(
        (job) => !isBlockedEmployer(job.employer, blockedKeywordsLowerCase),
      );
      const droppedCount = locationFilteredJobs.length - filteredDiscoveredJobs.length;

      if (droppedCount > 0) {
        const blockedCompanyKeywordsPreview = blockedCompanyKeywords.slice(0, 10);
        const blockedCompanyKeywordsTruncated =
          blockedCompanyKeywordsPreview.length < blockedCompanyKeywords.length;

        logger.info("Dropped discovered jobs matching blocked company keywords", {
          step: "discover-jobs",
          droppedCount,
          blockedKeywordCount: blockedCompanyKeywords.length,
          blockedCompanyKeywordsPreview,
          blockedCompanyKeywordsTruncated,
        });

        logger.debug("Full blocked company keywords used for filtering", {
          step: "discover-jobs",
          blockedCompanyKeywords,
        });
      }

      if (args.shouldCancel?.()) {
        return {
          result: {
            discoveredJobs: filteredDiscoveredJobs,
            sourceErrors,
            pendingChallenges,
          },
          usedUnits: successfulSearchUnits,
        };
      }

      // Don't throw "all sources failed" when challenges are pending — the
      // orchestrator will pause, let the user solve them, then re-run those
      // extractors.  Jobs from non-challenged extractors (if any) are kept.
      const fatalSourceFailures = sourceResults.filter((sourceResult) => sourceResult.fatal).length;
      if (
        filteredDiscoveredJobs.length === 0 &&
        sourceResults.length > 0 &&
        fatalSourceFailures === sourceResults.length &&
        pendingChallenges.length === 0
      ) {
        throw new Error(`All sources failed: ${sourceErrors.join("; ")}`);
      }

      if (sourceErrors.length > 0) {
        if (pendingChallenges.length > 0) {
          logger.info("Some discovery sources hit challenges and will be retried", {
            sourceErrors,
            pendingChallenges,
          });
        } else {
          logger.warn("Some discovery sources failed", { sourceErrors });
        }
      }

      // Don't transition to "importing" yet if there are challenges to solve —
      // the orchestrator will pause and re-run after challenges are resolved.
      if (pendingChallenges.length === 0) {
        progressHelpers.crawlingComplete(filteredDiscoveredJobs.length);
      }

      return {
        result: {
          discoveredJobs: filteredDiscoveredJobs,
          sourceErrors,
          pendingChallenges,
        },
        usedUnits: successfulSearchUnits,
      };
    },
  );
}
