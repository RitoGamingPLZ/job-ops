import { getErrorMessage, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as watchlistRepo from "@server/repositories/watchlist";
import { asyncPool } from "@server/utils/async-pool";
import { getWatchlistSourceAdapter, listWatchlistSourceAdapters } from "@server/watchlist/adapters";
import type {
  JobListItem,
  WatchlistJobResult,
  WatchlistResultsResponse,
  WatchlistSelectedSource,
  WatchlistSourceResult,
} from "@shared/types";

export const WATCHLIST_SOURCE_TIMEOUT_MS = 30000;
// ponytail: preserve the old five-source peak; use tenant-wide scheduling if aggregate load becomes a problem.
const WATCHLIST_SOURCE_CONCURRENCY = 5;

type StoredWatchlistJob = Omit<WatchlistJobResult, "rowState" | "workspaceJob">;
type StoredWatchlistPayload =
  | { status: "success"; jobs: StoredWatchlistJob[]; total: number; fetched: number }
  | { status: "error"; error: string };
interface WatchlistResultEntry {
  payload: StoredWatchlistPayload;
  checkedAt: string;
  previousCheckedAt: string | null;
}

export function getWatchlistSourceTypeDescriptors() {
  return listWatchlistSourceAdapters().map((adapter) => adapter.descriptor);
}

function hydrateWatchlistSelectedSource(source: WatchlistSelectedSource): WatchlistSelectedSource {
  const adapter = getWatchlistSourceAdapter(source.sourceType);
  return adapter?.hydrateSelectedSource(source) ?? source;
}

export function hydrateWatchlistSelectedSources(
  selectedSources: WatchlistSelectedSource[],
): WatchlistSelectedSource[] {
  return selectedSources.map(hydrateWatchlistSelectedSource);
}

export async function listHydratedWatchlistSelectedSources(): Promise<WatchlistSelectedSource[]> {
  return hydrateWatchlistSelectedSources(await watchlistRepo.listWatchlistSelectedSources());
}

/**
 * Selected sources get a new id every time the watchlist is saved, so cached results are keyed by
 * what is being watched instead.
 */
function getWatchlistSourceKey(
  source: Pick<WatchlistSelectedSource, "sourceType" | "careersUrl">,
): string {
  return `${source.sourceType}|${source.careersUrl}`;
}

function toStoredPayload(result: WatchlistSourceResult): StoredWatchlistPayload {
  if (result.status === "error") return { status: "error", error: result.error };
  return {
    status: "success",
    total: result.total,
    fetched: result.fetched,
    jobs: result.jobs.map(({ rowState: _rowState, workspaceJob: _workspaceJob, ...job }) => job),
  };
}

function parseStoredEntry(
  stored: watchlistRepo.StoredWatchlistSourceResult,
): WatchlistResultEntry | null {
  try {
    const payload = JSON.parse(stored.resultJson) as StoredWatchlistPayload;
    if (payload?.status !== stored.status) return null;
    if (payload.status === "success" && !Array.isArray(payload.jobs)) return null;
    return {
      payload,
      checkedAt: stored.checkedAt,
      previousCheckedAt: stored.previousCheckedAt,
    };
  } catch {
    return null;
  }
}

/** Fetches the given sources live, records the check, and remembers each source's outcome. */
async function fetchAndStoreWatchlistSources(
  sources: WatchlistSelectedSource[],
): Promise<Map<string, WatchlistResultEntry>> {
  const entries = new Map<string, WatchlistResultEntry>();
  if (sources.length === 0) return entries;

  const fetchedSources = await asyncPool({
    items: sources,
    concurrency: WATCHLIST_SOURCE_CONCURRENCY,
    task: fetchWatchlistSource,
  });
  const checksBySource = new Map<string, Set<string>>();

  for (const item of fetchedSources) {
    if (item.status !== "success") continue;
    for (const job of item.jobs) {
      const sourceJobIds = checksBySource.get(job.source) ?? new Set<string>();
      sourceJobIds.add(job.sourceJobId);
      checksBySource.set(job.source, sourceJobIds);
    }
  }

  const check = await watchlistRepo.recordWatchlistCheck({
    checks: Array.from(checksBySource, ([source, sourceJobIds]) => ({
      source,
      sourceJobIds: Array.from(sourceJobIds),
    })),
  });
  const newJobKeys = new Set(
    check.jobs
      .filter((job) => job.isNewSinceLastCheck)
      .map((job) => getWatchlistJobKey(String(job.source), job.sourceJobId)),
  );

  for (const item of fetchedSources) {
    const payload = toStoredPayload(item);
    if (payload.status === "success") {
      payload.jobs = payload.jobs.map((job) => ({
        ...job,
        isNewSinceLastCheck: newJobKeys.has(
          getWatchlistJobKey(String(job.source), job.sourceJobId),
        ),
      }));
    }
    entries.set(getWatchlistSourceKey(item.source), {
      payload,
      checkedAt: check.checkedAt,
      previousCheckedAt: check.previousLastCheckedAt,
    });
  }

  try {
    await watchlistRepo.saveWatchlistSourceResults(
      Array.from(entries, ([sourceKey, entry]) => ({
        sourceKey,
        status: entry.payload.status,
        resultJson: JSON.stringify(entry.payload),
        checkedAt: entry.checkedAt,
        previousCheckedAt: entry.previousCheckedAt,
      })),
    );
  } catch (error) {
    // The fresh results are still returned; they just will not be remembered for the next visit.
    logger.warn("Failed to store watchlist source results", {
      error: getErrorMessage(error),
    });
  }
  return entries;
}

async function assembleWatchlistResults(
  sources: WatchlistSelectedSource[],
  entries: Map<string, WatchlistResultEntry>,
): Promise<WatchlistResultsResponse> {
  const [states, workspaceJobs] = await Promise.all([
    watchlistRepo.listWatchlistJobStates(),
    jobsRepo.getJobListItems(),
  ]);
  const sourceEntries = sources.map((source) => ({
    source,
    entry: entries.get(getWatchlistSourceKey(source)),
  }));
  const latest = sourceEntries.reduce<WatchlistResultEntry | null>(
    (best, { entry }) => (entry && (!best || entry.checkedAt > best.checkedAt) ? entry : best),
    null,
  );

  return {
    checkedAt: latest?.checkedAt ?? null,
    previousLastCheckedAt: latest?.previousCheckedAt ?? null,
    sources: annotateWatchlistSourceResults({ sourceEntries, states, workspaceJobs }),
  };
}

/** Fetches every given source live (used by pipeline runs), remembering the outcome of each. */
export async function getWatchlistResultsForSources(
  selectedSources: WatchlistSelectedSource[],
): Promise<WatchlistResultsResponse> {
  if (selectedSources.length === 0) {
    return {
      checkedAt: null,
      previousLastCheckedAt: null,
      sources: [],
    };
  }

  return assembleWatchlistResults(
    selectedSources,
    await fetchAndStoreWatchlistSources(selectedSources),
  );
}

/**
 * Opening the page serves the outcome of each source's last check, so an unhealthy source is not
 * re-fetched on every visit. A source is only fetched when it has never been checked, or when the
 * caller asks to refresh (all sources, or just `sourceIds`).
 */
export async function getCurrentWatchlistResults(
  options: { refresh?: boolean; sourceIds?: string[] } = {},
): Promise<WatchlistResultsResponse> {
  const sources = await listHydratedWatchlistSelectedSources();
  if (sources.length === 0) return getWatchlistResultsForSources([]);

  const entries = new Map<string, WatchlistResultEntry>();
  for (const stored of await watchlistRepo.listWatchlistSourceResults()) {
    const entry = parseStoredEntry(stored);
    if (entry) entries.set(stored.sourceKey, entry);
  }

  const sourceIds = options.sourceIds?.length ? new Set(options.sourceIds) : null;
  const toFetch = sources.filter((source) =>
    options.refresh
      ? !sourceIds || sourceIds.has(source.id)
      : !entries.has(getWatchlistSourceKey(source)),
  );
  for (const [key, entry] of await fetchAndStoreWatchlistSources(toFetch)) {
    entries.set(key, entry);
  }

  return assembleWatchlistResults(sources, entries);
}

export async function getWatchlistSelectedSourceById(
  selectedSourceId: string,
): Promise<WatchlistSelectedSource> {
  const source = (await listHydratedWatchlistSelectedSources()).find(
    (item) => item.id === selectedSourceId,
  );
  if (!source) {
    throw notFound("Watchlist source was not found");
  }
  return source;
}

async function fetchWatchlistSource(
  source: WatchlistSelectedSource,
): Promise<WatchlistSourceResult> {
  const adapter = getWatchlistSourceAdapter(source.sourceType);
  if (!adapter) {
    return {
      status: "error",
      source,
      error: `Unsupported watchlist source type: ${source.sourceType}`,
    };
  }

  try {
    const result = await withWatchlistSourceTimeout((signal) =>
      adapter.fetchJobs({ source, signal }),
    );
    return {
      status: "success",
      source,
      jobs: result.jobs.map((job) => ({
        ...job,
        rowState: "new",
        isNewSinceLastCheck: false,
        workspaceJob: null,
      })),
      total: result.total,
      fetched: result.fetched,
    };
  } catch (error) {
    return {
      status: "error",
      source,
      error: getErrorMessage(error),
    };
  }
}

function annotateWatchlistSourceResults(input: {
  sourceEntries: Array<{
    source: WatchlistSelectedSource;
    entry: WatchlistResultEntry | undefined;
  }>;
  states: Awaited<ReturnType<typeof watchlistRepo.listWatchlistJobStates>>;
  workspaceJobs: JobListItem[];
}): WatchlistSourceResult[] {
  const ignoredKeys = new Set(
    input.states
      .filter((state) => state.state === "ignored")
      .map((state) => getWatchlistJobKey(state.source, state.sourceJobId)),
  );
  const importedByKey = new Map<string, JobListItem>();
  const importedByUrl = new Map<string, JobListItem>();
  for (const job of input.workspaceJobs) {
    if (job.sourceJobId) {
      importedByKey.set(getWatchlistJobKey(String(job.source), job.sourceJobId), job);
    }
    importedByUrl.set(job.jobUrl, job);
  }

  return input.sourceEntries.map(({ source, entry }): WatchlistSourceResult => {
    if (!entry) return { status: "error", source, error: "This source has not been checked yet." };
    const { payload } = entry;
    if (payload.status === "error") return { status: "error", source, error: payload.error };

    return {
      status: "success",
      source,
      total: payload.total,
      fetched: payload.fetched,
      jobs: payload.jobs.map((job): WatchlistJobResult => {
        const jobKey = getWatchlistJobKey(String(job.source), job.sourceJobId);
        const workspaceJob = importedByKey.get(jobKey) ?? importedByUrl.get(job.jobUrl) ?? null;
        const rowState = workspaceJob
          ? "moved_to_workspace"
          : ignoredKeys.has(jobKey)
            ? "ignored"
            : "new";

        return {
          ...job,
          rowState,
          isNewSinceLastCheck: rowState === "new" && job.isNewSinceLastCheck,
          workspaceJob: workspaceJob ? { id: workspaceJob.id, status: workspaceJob.status } : null,
        };
      }),
    };
  });
}

export async function withWatchlistSourceTimeout<T>(
  callback: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(
        `Watchlist source timed out after ${WATCHLIST_SOURCE_TIMEOUT_MS / 1000}s`,
      );
      reject(error);
      controller.abort(error);
    }, WATCHLIST_SOURCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([callback(controller.signal), timedOut]);
  } finally {
    clearTimeout(timeout);
  }
}

function getWatchlistJobKey(source: string, sourceJobId: string): string {
  return `${source}:${sourceJobId}`;
}
