import { badRequest, conflict, serviceUnavailable } from "@infra/errors";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { type ExtractorRegistry, getExtractorRegistry } from "@server/extractors/registry";
import { getActivePipelineCount, getPipelineStatus, runPipeline } from "@server/pipeline/index";
import { reserveHostedUsage, settleHostedUsageReservation } from "@server/services/hosted-usage";
import { ensurePipelineSearchTerms } from "@server/services/pipeline-search-terms";
import { ensureUserHasLlmAccess } from "@server/services/server-credentials";
import { currentUserHasPermission } from "@server/services/user-permissions";
import { PIPELINE_EXTRACTOR_SOURCE_IDS } from "@shared/extractors";
import {
  createLocationIntent,
  LOCATION_MATCH_STRICTNESS_VALUES,
  LOCATION_SEARCH_SCOPE_VALUES,
  LOCATION_WORKPLACE_TYPE_VALUES,
  planLocationSources,
} from "@shared/location-domain.js";
import { MAX_PIPELINE_RUN_BUDGET, normalizePipelineRunBudget } from "@shared/types";
import { z } from "zod";
import { saveRunRequest } from "./storage";

export const pipelineSourceSchema = z.enum(
  PIPELINE_EXTRACTOR_SOURCE_IDS as [
    (typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number],
    ...(typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number][],
  ],
);
export const pipelineRunBudgetSchema = z
  .number()
  .int()
  .max(MAX_PIPELINE_RUN_BUDGET)
  .transform(normalizePipelineRunBudget);
export const locationProximitySchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radiusMiles: z.number().int().min(1).max(200),
});
export const runPipelineSchema = z.object({
  topN: z.number().min(1).max(50).optional(),
  minSuitabilityScore: z.number().min(0).max(100).optional(),
  sources: z.array(pipelineSourceSchema).min(1).optional(),
  runBudget: pipelineRunBudgetSchema.optional(),
  searchTerms: z.array(z.string().trim().min(1)).optional(),
  scoringInstructions: z.string().trim().max(4000).optional(),
  country: z.string().trim().optional(),
  cityLocations: z.array(z.string().trim().min(1)).optional(),
  proximity: locationProximitySchema.nullable().optional(),
  workplaceTypes: z.array(z.enum(LOCATION_WORKPLACE_TYPE_VALUES)).min(1).max(3).optional(),
  searchScope: z.enum(LOCATION_SEARCH_SCOPE_VALUES).optional(),
  matchStrictness: z.enum(LOCATION_MATCH_STRICTNESS_VALUES).optional(),
  // Per-#621: optional client-supplied per-run Watchlist source filter.
  // Omitted preserves the legacy "include every saved Watchlist source"
  // behavior; [] disables Watchlist entirely; non-empty restricts to a
  // subset. Cross-tenant safety is enforced by re-resolving IDs against
  // the user's saved Watchlist sources inside discoverJobsStep.
  watchlistSelectedSourceIds: z.array(z.string().min(1).max(128)).optional(),
});

export type PipelineRunRequest = z.infer<typeof runPipelineSchema>;
export async function validateRequestedPipeline(config: PipelineRunRequest) {
  const locationIntent = createLocationIntent({
    selectedCountry: config.country,
    cityLocations: config.cityLocations,
    proximity: config.proximity,
    workplaceTypes: config.workplaceTypes,
    geoScope: config.searchScope,
    matchStrictness: config.matchStrictness,
  });
  if (config.sources && config.sources.length > 0) {
    let registry: ExtractorRegistry;
    try {
      registry = await getExtractorRegistry();
    } catch (error) {
      logger.error("Extractor registry unavailable during source validation", {
        route: "/api/pipeline/run",
        error: sanitizeUnknown(error),
      });
      throw serviceUnavailable(
        "Extractor registry is unavailable. Try again after fixing startup errors.",
      );
    }
    const unavailableSources = config.sources.filter(
      (source) => !registry.manifestBySource.has(source),
    );
    if (unavailableSources.length > 0) {
      throw badRequest(
        `Requested sources are not available at runtime: ${unavailableSources.join(", ")}`,
        { unavailableSources },
      );
    }

    const sourcePlans = planLocationSources({
      intent: locationIntent,
      sources: config.sources,
      capabilitiesBySource: registry.locationCapabilitiesBySource ?? {},
    });
    if (sourcePlans.incompatibleSources.length > 0) {
      const incompatible = sourcePlans.plans
        .filter((plan) => !plan.isCompatible)
        .map((plan) => ({
          source: plan.source,
          reasons: plan.reasons,
        }));

      throw badRequest("Requested sources are incompatible with the selected location setup", {
        incompatibleSources: incompatible,
      });
    }
  }

  return locationIntent;
}

/**
 * Stores the search that the admin's daily schedule runs for this workspace, without starting a
 * run. It is the same snapshot a manual run remembers, so the two stay in step.
 */
export async function saveScheduledSearch(config: PipelineRunRequest): Promise<void> {
  await validateRequestedPipeline(config);
  const canUseWatchlist = await currentUserHasPermission("watchlist");
  await saveRunRequest(canUseWatchlist ? config : { ...config, watchlistSelectedSourceIds: [] });
}

export async function startRequestedPipeline(config: PipelineRunRequest, remember = true) {
  await ensureUserHasLlmAccess();
  const locationIntent = await validateRequestedPipeline(config);
  if (getPipelineStatus().isRunning) {
    throw conflict("Pipeline is already running");
  }
  if (getActivePipelineCount() >= readMaxConcurrentPipelines()) {
    throw serviceUnavailable(
      "Other searches are using the scrapers right now. Try again in a few minutes.",
    );
  }

  const searchTermsState = await ensurePipelineSearchTerms({
    requestedSearchTerms: config.searchTerms,
  });
  const pipelineUsage = await reserveHostedUsage({
    action: "pipeline_run",
  });

  const canUseWatchlist = await currentUserHasPermission("watchlist");
  const effectiveWatchlistSelectedSourceIds = canUseWatchlist
    ? config.watchlistSelectedSourceIds
    : [];

  if (remember) {
    try {
      await saveRunRequest(
        canUseWatchlist
          ? config
          : { ...config, watchlistSelectedSourceIds: effectiveWatchlistSelectedSourceIds },
      );
    } catch (error) {
      if (pipelineUsage.reservation)
        await settleHostedUsageReservation({
          reservationId: pipelineUsage.reservation.id,
          usedUnits: 0,
        });
      throw error;
    }
  }

  // Start pipeline in background
  runWithRequestContext({}, () => {
    runPipeline(
      {
        topN: config.topN,
        minSuitabilityScore: config.minSuitabilityScore,
        sources: config.sources,
        scoringInstructions: config.scoringInstructions,
        runBudget: config.runBudget,
        locationIntent,
        watchlistSelectedSourceIds: effectiveWatchlistSelectedSourceIds,
      },
      {
        hostedUsageReservationId: pipelineUsage.reservation?.id ?? null,
      },
    )
      .then((result) => {
        if (!result.success)
          logger.warn("Pipeline run failed", {
            error: sanitizeUnknown(result.error),
          });
      })
      .catch((error) => {
        logger.error("Background pipeline run failed", {
          error: sanitizeUnknown(error),
        });
      });
  });
  return searchTermsState;
}

export function readMaxConcurrentPipelines(): number {
  const parsed = Number.parseInt(process.env.MAX_CONCURRENT_PIPELINES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}
