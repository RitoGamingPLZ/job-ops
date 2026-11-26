import { workdayUrlToCxsJobsUrl } from "@career-boards/workday";
import { AppError, unprocessableEntity } from "@infra/errors";
import { logger } from "@infra/logger";
import { listCareerBoardSources } from "@server/config/career-boards";
import { isDatabaseAvailable } from "@server/db/index";
import { getSiteRecipe } from "@server/repositories/site-recipes";
import {
  getSharedWatchlistSourceByUrlKey,
  listSharedWatchlistSources,
  upsertSharedWatchlistSource,
  type WatchlistSharedSourceRecord,
} from "@server/repositories/watchlist-shared-sources";
import { getWatchlistSourceAdapter } from "@server/watchlist/adapters";
import {
  detectWatchlistSourceTypeForUrl,
  getWatchlistBaseUrlKey,
  stripUrlQueryAndHash,
} from "@server/watchlist/adapters/detect";
import { facetDiscoverers } from "@server/watchlist/autofilter/facets";
import { getRemoteCareersSiteRunner } from "@server/watchlist/careers-site/remote";
import { suggestFilters } from "@server/watchlist/autofilter/suggest";
import type {
  WatchedSourceType,
  WatchlistSource,
  WatchlistSourceScanInput,
  WatchlistSourceScanResponse,
} from "@shared/types";

function isWorkerdRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function getSafeCxsJobsUrl(sourceType: WatchedSourceType, careersUrl: string): string | null {
  if (sourceType !== "workday") return null;
  try {
    return workdayUrlToCxsJobsUrl(careersUrl);
  } catch {
    return null;
  }
}

function sharedRecordToWatchlistSource(record: WatchlistSharedSourceRecord): WatchlistSource {
  return {
    id: record.id,
    label: record.name,
    careersUrl: record.careersUrl,
    cxsJobsUrl: getSafeCxsJobsUrl(record.sourceType, record.careersUrl),
    sourceType: record.sourceType,
    description: record.description || null,
    suggestedFilterUrl: record.defaultFilterPlan?.suggestedUrl ?? null,
    suggestedFilterRationale: record.defaultFilterPlan?.rationale ?? null,
    isShared: true,
  };
}

/**
 * Combines bundled catalog career boards with database-persisted shared sources so
 * custom boards saved or scanned by one user can be reused across workspaces.
 */
export async function listMergedWatchlistCatalogSources(): Promise<WatchlistSource[]> {
  const bundled = await listCareerBoardSources();
  if (!isDatabaseAvailable()) {
    return bundled;
  }

  let sharedRecords: WatchlistSharedSourceRecord[] = [];
  try {
    sharedRecords = listSharedWatchlistSources();
  } catch (error) {
    logger.warn("Failed to list shared watchlist sources", {
      error: error instanceof Error ? error.message : String(error),
    });
    return bundled;
  }

  const sharedByUrlKey = new Map<string, WatchlistSharedSourceRecord>();
  for (const record of sharedRecords) {
    sharedByUrlKey.set(record.urlKey, record);
  }

  const seenUrlKeys = new Set<string>();
  const merged = bundled.map((source) => {
    const key = getWatchlistBaseUrlKey(source.careersUrl);
    seenUrlKeys.add(key);
    const shared = sharedByUrlKey.get(key);
    if (!shared) return source;
    return {
      ...source,
      ...(shared.description ? { description: shared.description } : {}),
      ...(shared.defaultFilterPlan
        ? {
            suggestedFilterUrl: shared.defaultFilterPlan.suggestedUrl,
            suggestedFilterRationale: shared.defaultFilterPlan.rationale,
          }
        : {}),
    };
  });

  for (const record of sharedRecords) {
    if (seenUrlKeys.has(record.urlKey)) continue;
    seenUrlKeys.add(record.urlKey);
    merged.push(sharedRecordToWatchlistSource(record));
  }

  return merged.sort((left, right) => left.label.localeCompare(right.label));
}

export function resolveAdapterTypeForSelection(
  requestedSourceType: WatchedSourceType | null | undefined,
  careersUrl: string,
): WatchedSourceType {
  if (!requestedSourceType || requestedSourceType === "careers_site") {
    return detectWatchlistSourceTypeForUrl(careersUrl);
  }
  return requestedSourceType;
}

export function persistCustomSelectionToSharedSources(input: {
  sourceType: WatchedSourceType;
  label: string;
  careersUrl: string;
  description?: string | null;
}): void {
  if (!isDatabaseAvailable()) return;

  const baseCareersUrl = stripUrlQueryAndHash(input.careersUrl);
  const urlKey = getWatchlistBaseUrlKey(baseCareersUrl || input.careersUrl);
  if (!urlKey) return;

  upsertSharedWatchlistSource({
    urlKey,
    sourceType: input.sourceType,
    name: input.label.trim() || baseCareersUrl || input.careersUrl,
    careersUrl: baseCareersUrl || input.careersUrl,
    description: input.description,
  });
}

async function getCareersSiteScrapingStatus(
  careersUrl: string,
): Promise<{ status: WatchlistSourceScanResponse["scrapingStatus"]; reusedScrapingPlan: boolean }> {
  // Without a browser here or a remote one in the scraper container, nothing can crawl the site.
  if (isWorkerdRuntime() && !getRemoteCareersSiteRunner()) {
    return { status: "unavailable", reusedScrapingPlan: false };
  }

  try {
    const host = new URL(careersUrl).hostname;
    const stored = await getSiteRecipe(host);
    if (stored?.recipe && !stored.blockedReason) {
      return { status: "ready", reusedScrapingPlan: true };
    }
    return { status: "learning", reusedScrapingPlan: false };
  } catch {
    return { status: "learning", reusedScrapingPlan: false };
  }
}

/**
 * Registers or reuses a custom career source in the shared database and either
 * reuses its cached filter/scraping plan or scans the board once with the LLM.
 */
export async function scanAndStoreWatchlistSource(
  input: WatchlistSourceScanInput & { signal?: AbortSignal },
): Promise<WatchlistSourceScanResponse> {
  const resolvedType = resolveAdapterTypeForSelection(input.sourceType, input.careersUrl);
  const adapter = getWatchlistSourceAdapter(resolvedType);
  if (!adapter) {
    throw unprocessableEntity("Unsupported watchlist source type", {
      sourceType: resolvedType,
    });
  }
  if (!adapter.descriptor.supportsCustomSource) {
    throw unprocessableEntity("Custom sources are not supported for this source type", {
      sourceType: resolvedType,
    });
  }

  let normalized: { label: string; careersUrl: string };
  try {
    normalized = await adapter.normalizeCustomSelection({
      label: input.name,
      careersUrl: input.careersUrl,
    });
  } catch (error) {
    throw unprocessableEntity(
      `${adapter.descriptor.invalidUrlMessage}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { careersUrl: input.careersUrl },
    );
  }

  const baseCareersUrl = stripUrlQueryAndHash(normalized.careersUrl);
  const urlKey = getWatchlistBaseUrlKey(baseCareersUrl);
  const effectiveDescription = input.description?.trim() ?? "";

  const existing = isDatabaseAvailable() ? getSharedWatchlistSourceByUrlKey(urlKey) : null;
  const reusedSource = Boolean(existing);

  const scraping =
    resolvedType === "careers_site"
      ? await getCareersSiteScrapingStatus(baseCareersUrl)
      : { status: "native_adapter" as const, reusedScrapingPlan: false };

  let storedRecord: WatchlistSharedSourceRecord | null = null;
  if (isDatabaseAvailable()) {
    storedRecord = upsertSharedWatchlistSource({
      urlKey,
      sourceType: resolvedType,
      name: input.name?.trim() || normalized.label,
      careersUrl: baseCareersUrl,
      description: effectiveDescription,
    }).record;
  }

  const sourcePayload: WatchlistSource = storedRecord
    ? sharedRecordToWatchlistSource(storedRecord)
    : {
        id: urlKey,
        label: input.name?.trim() || normalized.label,
        careersUrl: baseCareersUrl,
        cxsJobsUrl: getSafeCxsJobsUrl(resolvedType, baseCareersUrl),
        sourceType: resolvedType,
        description: effectiveDescription || null,
        isShared: true,
      };

  const hasFacetDiscoverer = Object.hasOwn(facetDiscoverers, resolvedType);
  if (!hasFacetDiscoverer) {
    return {
      source: sourcePayload,
      reusedSource,
      reusedScrapingPlan: scraping.reusedScrapingPlan,
      reusedFilterPlan: false,
      scrapingStatus: scraping.status,
      filterPlan: null,
      filterNote: "This board does not need URL filter scanning; it is ready to watch.",
    };
  }

  if (!input.forceRefresh && existing?.defaultFilterPlan) {
    return {
      source: {
        ...sourcePayload,
        suggestedFilterUrl: existing.defaultFilterPlan.suggestedUrl,
        suggestedFilterRationale: existing.defaultFilterPlan.rationale,
      },
      reusedSource: true,
      reusedScrapingPlan: scraping.reusedScrapingPlan,
      reusedFilterPlan: true,
      scrapingStatus: scraping.status,
      filterPlan: { ...existing.defaultFilterPlan, reused: true },
      filterNote: null,
    };
  }

  const scanDescription = effectiveDescription || existing?.description || "";
  const usePublicDescriptionOnly = Boolean(scanDescription);

  try {
    const suggestion = await suggestFilters({
      sourceType: resolvedType,
      careersUrl: baseCareersUrl,
      label: sourcePayload.label,
      description: scanDescription || null,
      usePublicDescriptionOnly,
      useCache: true,
      forceRefresh: input.forceRefresh,
      signal: input.signal,
    });

    const refreshedRecord = isDatabaseAvailable() ? getSharedWatchlistSourceByUrlKey(urlKey) : null;
    const finalSource = refreshedRecord
      ? sharedRecordToWatchlistSource(refreshedRecord)
      : {
          ...sourcePayload,
          ...(usePublicDescriptionOnly
            ? {
                suggestedFilterUrl: suggestion.suggestedUrl,
                suggestedFilterRationale: suggestion.rationale,
              }
            : {}),
        };

    return {
      source: finalSource,
      reusedSource,
      reusedScrapingPlan: scraping.reusedScrapingPlan,
      reusedFilterPlan: Boolean(suggestion.reused),
      scrapingStatus: scraping.status,
      filterPlan: suggestion,
      filterNote: null,
    };
  } catch (error) {
    if (error instanceof AppError && (error.status === 422 || error.status === 503)) {
      logger.info("Watchlist source filter scan skipped or unavailable", {
        sourceType: resolvedType,
        status: error.status,
        code: error.code,
        reason: error.message,
      });
      return {
        source: sourcePayload,
        reusedSource,
        reusedScrapingPlan: scraping.reusedScrapingPlan,
        reusedFilterPlan: false,
        scrapingStatus: scraping.status,
        filterPlan: null,
        filterNote: error.message,
      };
    }
    throw error;
  }
}
