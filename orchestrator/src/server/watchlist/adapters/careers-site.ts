import {
  getFreshMapEntry,
  parseCatalogSourcesLenient,
  pruneExpiredTimestamps,
  setBoundedMapEntry,
} from "./common";
import { roleField, roleRank } from "../control-roles";
import { createBudgetSignal, createSoftDeadline } from "./http";
import { parseWatchlistUrl, hasPlainHttpsAuthority } from "./url";
import { isWorkerdRuntime } from "../runtime";
import { createHash } from "node:crypto";
import { badRequest, serviceUnavailable, unprocessableEntity, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import { getRequestContext, runWithRequestContext } from "@infra/request-context";
import {
  getSiteRecipe,
  markSiteBlocked,
  recordSiteRecipeRun,
  saveSiteRecipe,
} from "@server/repositories/site-recipes";
import { parseGreenhouseUrl } from "@career-boards/greenhouse";
import greenhouseCatalog from "@server/config/career-boards-greenhouse.json";
import { resolveLlmRuntimeSettings } from "@server/services/modelSelection";
import { getUserById } from "@server/repositories/users";
import { learnRecipe, RecipeLearningError } from "@server/watchlist/careers-site/learn";
import { shouldRelearnUnderfitRecipe } from "@server/watchlist/careers-site/listing-quality";
import {
  getRemoteCareersSiteRunner,
  RemoteCareersSiteUnavailableError,
  type RemoteCareersSiteRunResult,
} from "@server/watchlist/careers-site/remote";
import {
  CareersWorkPending,
  getLocalCareersTaskQueue,
  type CareersScanRequest,
  type CareersScanStatus,
} from "@server/watchlist/careers-site/scan-task";
import { CAREERS_CRAWL_BUDGET_MS } from "@server/watchlist/careers-site/crawl-budget";
import { sameUrlPath } from "@server/watchlist/careers-site/normalize";
import { runRecipe } from "@server/watchlist/careers-site/run-recipe";
import {
  buildSearchUrl,
  facetParamsFromSearch,
  readSearchValues,
  sameListingPath,
  type SearchValues,
} from "@server/watchlist/careers-site/search";
import {
  type CrawledJob,
  detailRenders,
  type Recipe,
  SiteBlockedError,
  type SiteRecipeRecord,
} from "@server/watchlist/careers-site/types";
import type {
  WatchlistScanOutcome,
  WatchlistSearchControlsResponse,
  WatchlistSelectedSource,
} from "@shared/types";
import { convert } from "html-to-text";
import { z } from "zod";
import { greenhouseWatchlistAdapter } from "./greenhouse";
import type { WatchlistCatalogSourceAdapter } from "./types";

const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const LEARNING = "Learning this careers site, check again in a minute";
// Explicitly global: public recipes/learning use host keys; public posting
// caches include the normalized source query. No tenant settings, credentials,
// selections or import state are retained here.
const learning = new Map<string, Promise<void>>();
const failedLearns = new Map<string, number>();
const FAILED_LEARN_COOLDOWN_MS = 30 * 60_000;
const cache = new Map<string, { expires: number; jobs: Map<string, CrawledJob> }>();

function careersUrl(value: string): URL {
  const url = parseWatchlistUrl(value, "Use an HTTPS careers URL without credentials or a port.");
  if (url.protocol !== "https:" || !hasPlainHttpsAuthority(value))
    throw badRequest("Use an HTTPS careers URL without credentials or a port.");
  url.hash = "";
  // Snapshot keys before deleting parameters from the live search params.
  const parameterNames = Array.from(url.searchParams.keys());
  for (const name of parameterNames) {
    if (/^(?:utm_.*|gclid|dclid|fbclid|msclkid|gbraid|wbraid|mc_cid|mc_eid|_ga|_gl)$/i.test(name))
      url.searchParams.delete(name);
  }
  url.searchParams.sort();
  // Plain source ids retain the established host format and must fit state APIs.
  if (!url.search && `careers_site:${url.hostname}`.length > 120)
    throw badRequest("Use a careers hostname of at most 107 characters.");
  return url;
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
function key(host: string, query = "") {
  if (!query) return `careers_site:${host}`;
  const shortHost = host.length <= 82 ? host : `~${digest(host)}`;
  return `careers_site:${shortHost}?${digest(query)}`;
}
function clearHostCache(host: string) {
  const plain = key(host);
  const filteredPrefix = key(host, "?").split("?")[0];
  for (const sourceKey of cache.keys()) {
    if (sourceKey === plain || sourceKey.startsWith(`${filteredPrefix}?`)) cache.delete(sourceKey);
  }
}
/** A recorded block is retried after this long, so a transient 403/challenge cannot disable a host forever. */
const BLOCK_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
function blockIsActive(stored: { updatedAt: string }): boolean {
  const blockedAt = Date.parse(stored.updatedAt);
  return Number.isFinite(blockedAt) && Date.now() - blockedAt < BLOCK_RETRY_AFTER_MS;
}
function blocked(host: string) {
  return upstreamError(
    `Careers site ${host} blocks automated access. It will be retried automatically after 24 hours.`,
  );
}
/** The Cloudflare Durable Object bundle stubs out Playwright and jsdom, which this adapter needs. */
let greenhouseBoards: Map<string, string> | undefined;
/**
 * Without a browser, serve a careers site from the company's Greenhouse board when the
 * catalog has one (matched on the site's domain name, e.g. www.okta.com -> okta).
 */
function greenhouseFallback(source: WatchlistSelectedSource): WatchlistSelectedSource | null {
  if (!isWorkerdRuntime()) return null;
  greenhouseBoards ??= new Map(
    greenhouseCatalog.flatMap((entry) => {
      try {
        const board = parseGreenhouseUrl(entry.greenhouseUrl);
        return [[board.token.toLowerCase(), board.canonicalCareersUrl] as const];
      } catch {
        return [];
      }
    }),
  );
  const labels = careersUrl(source.careersUrl).hostname.toLowerCase().split(".");
  const board = labels.length >= 2 ? greenhouseBoards.get(labels[labels.length - 2]) : undefined;
  return board
    ? { ...source, sourceType: "greenhouse", careersUrl: board, cxsJobsUrl: null }
    : null;
}
/**
 * Where the crawl runs. The Cloudflare Worker has no browser, so there it is delegated to the
 * scraper container; everywhere else Playwright and jsdom run in-process.
 */
function remoteRunner() {
  return isWorkerdRuntime() ? getRemoteCareersSiteRunner() : null;
}
function careersQueue() {
  return isWorkerdRuntime() ? remoteRunner() : getLocalCareersTaskQueue();
}
async function crawl(
  recipe: Recipe,
  host: string,
  options: { limit: number; signal: AbortSignal; stopAt: number; sourceUrl?: string },
): Promise<CrawledJob[]> {
  const remote = remoteRunner();
  if (!remote) return runRecipe(recipe, options);
  const result = await remote.run({
    recipe,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    limit: options.limit,
    budgetMs: Math.max(0, options.stopAt - Date.now()),
    signal: options.signal,
  });
  if (result.kind === "unavailable") throw new RemoteCareersSiteUnavailableError(result.message);
  if (result.kind === "blocked") throw new SiteBlockedError(host, result.reason);
  if (result.kind === "failed") throw new Error("Remote careers crawl failed");
  return result.jobs;
}
async function learn(host: string, url: string, signal: AbortSignal): Promise<Recipe> {
  const remote = remoteRunner();
  if (!remote) return learnRecipe(url, { signal });
  // The container is stateless: it learns with this tenant's own LLM connection and returns the recipe.
  const runtime = await resolveLlmRuntimeSettings("default");
  const result = await remote.learn({
    careersUrl: url,
    requestId: getRequestContext()?.requestId,
    llm: {
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
    },
    signal,
  });
  if (result.kind === "unavailable") throw new RemoteCareersSiteUnavailableError(result.message);
  if (result.kind === "blocked") throw new SiteBlockedError(host, result.reason);
  if (result.kind === "failed") throw new RecipeLearningError(result.message);
  return result.recipe;
}

/** Execute an authorized coordinator scan with the initiating user's current settings. */
export async function executeCareersScan(input: CareersScanRequest): Promise<WatchlistScanOutcome> {
  const url = careersUrl(input.careersUrl);
  url.search = "";
  url.hash = "";
  const user = await getUserById(input.userId);
  if (!user || user.isDisabled || user.workspaceId !== input.tenantId) return { outcome: "failed" };
  return runWithRequestContext(
    {
      requestId: input.requestId,
      tenantId: input.tenantId,
      userId: input.userId,
      isSystemAdmin: user.isSystemAdmin,
      pipelineRunId: input.pipelineRunId,
    },
    async () => {
      try {
        const recipe = await learn(url.hostname, url.href, createBudgetSignal(undefined, 180_000));
        await saveSiteRecipe(url.hostname, recipe);
        clearHostCache(url.hostname);
        return { outcome: recipe.search ? "found" : "none" };
      } catch (error) {
        if (error instanceof SiteBlockedError) {
          await markSiteBlocked(url.hostname, error.reason);
          return { outcome: "blocked" };
        }
        if (error instanceof RemoteCareersSiteUnavailableError) return { outcome: "unavailable" };
        logger.warn("Queued careers scan failed", { host: url.hostname });
        return { outcome: "failed" };
      }
    },
  );
}

/** Update the recipe once per completed queue execution, regardless of how many users read it. */
export async function recordQueuedCareersCrawl(
  host: string,
  filtered: boolean,
  result: { kind: string; jobs?: unknown; reason?: unknown },
): Promise<void> {
  if (result.kind === "blocked" && typeof result.reason === "string") {
    await markSiteBlocked(host, result.reason);
  } else if (result.kind === "jobs" && Array.isArray(result.jobs)) {
    if (result.jobs.length || !filtered) await recordSiteRecipeRun(host, result.jobs.length > 0);
  } else if (result.kind === "failed") {
    await recordSiteRecipeRun(host, false);
  }
}
// Explicitly global and public: how the last background scan of a host ended. No tenant data; the
// reasons are the learner's own bounded messages, never page text.
const scans = new Map<string, WatchlistScanOutcome & { at: number }>();
function recordScan(host: string, outcome: WatchlistScanOutcome["outcome"], reason?: string) {
  setBoundedMapEntry(scans, host, { at: Date.now(), outcome, ...(reason ? { reason } : {}) }, 500);
}
function lastScan(host: string): WatchlistScanOutcome | undefined {
  const scan = scans.get(host);
  return scan && { outcome: scan.outcome, ...(scan.reason ? { reason: scan.reason } : {}) };
}

/** Start (or join) background learning for a host; throws only while a failed learn cools down. */
async function ensureLearning(
  host: string,
  url: string,
  repair = false,
): Promise<CareersScanStatus | void> {
  const plainUrl = new URL(url);
  plainUrl.search = "";
  plainUrl.hash = "";
  const queue = careersQueue();
  if (queue?.enqueueScan) {
    const { tenantId, userId, requestId, pipelineRunId } = getRequestContext() ?? {};
    if (!tenantId || !userId || !requestId)
      throw serviceUnavailable("Careers scans require a workspace user.");
    const scan = await queue.enqueueScan({
      careersUrl: plainUrl.href,
      tenantId,
      userId,
      requestId,
      pipelineRunId,
      repair,
    });
    if (scan.state === "finished" && scan.outcome.outcome === "failed")
      throw serviceUnavailable("Could not learn this careers site. Try again later.");
    return scan;
  }
  clearHostCache(host);
  const failedAt = failedLearns.get(host);
  if (failedAt !== undefined && Date.now() - failedAt < FAILED_LEARN_COOLDOWN_MS)
    throw serviceUnavailable("Could not learn this careers site. Try again later.");
  if (!learning.has(host)) {
    const p = (async () => {
      try {
        const recipe = await learn(host, plainUrl.href, createBudgetSignal(undefined, 180_000));
        await saveSiteRecipe(host, recipe);
        failedLearns.delete(host);
        recordScan(host, recipe.search ? "found" : "none");
      } catch (error) {
        if (error instanceof SiteBlockedError) {
          await markSiteBlocked(host, error.reason);
          recordScan(host, "blocked", error.reason);
        } else if (error instanceof RemoteCareersSiteUnavailableError) {
          // A browser that is still starting says nothing about this site: no cooldown, and a
          // later scan is allowed straight away.
          recordScan(host, "unavailable", error.message);
        } else {
          const now = Date.now();
          pruneExpiredTimestamps(failedLearns, FAILED_LEARN_COOLDOWN_MS, now);
          failedLearns.set(host, now);
          recordScan(
            host,
            "failed",
            error instanceof RecipeLearningError
              ? error.message
              : "Learning failed outside recipe validation",
          );
        }
        throw error;
      }
    })().finally(() => {
      learning.delete(host);
    });
    learning.set(host, p);
    // The shared logger sanitizes metadata and keeps the initiating ALS context.
    // Only the learner's own bounded errors are safe to include.
    void p.catch((error: unknown) => {
      logger.warn("Careers site learning failed", {
        host,
        sourceType: "careers_site",
        reason:
          error instanceof SiteBlockedError
            ? error.reason
            : error instanceof RecipeLearningError
              ? error.message
              : "Careers learning failed outside recipe validation",
      });
    });
  }
}
async function startLearning(host: string, url: string): Promise<never> {
  const scan = await ensureLearning(host, url, true);
  if (careersQueue()?.enqueueCrawl) {
    if (scan?.state === "queued" && scan.taskId)
      await crawlQueued(null, new URL(url), 4, scan.taskId);
    throw new CareersWorkPending(LEARNING);
  }
  throw serviceUnavailable(LEARNING);
}

function crawlQueueKey(recipe: Recipe | null, url: URL): string {
  const context = getRequestContext();
  const params =
    recipe?.search && sameListingPath(recipe.search, url.href) ? recipe.search.params : [];
  const entries = [...url.searchParams];
  const publicFilters =
    entries.length <= 2 &&
    entries.every(([name, value]) =>
      params.some(
        (param) =>
          param.key === name &&
          param.input.kind === "choice" &&
          param.input.options.some((choice) => choice.value === value),
      ),
    );
  const scope = publicFilters ? "public" : [context?.tenantId, context?.userId];
  if (!publicFilters && (!context?.tenantId || !context.userId))
    throw serviceUnavailable("Filtered careers crawls require a workspace user.");
  return digest(JSON.stringify([url.href, scope]));
}

async function crawlQueued(
  recipe: Recipe | null,
  url: URL,
  limit: number,
  scanTaskId?: string,
  useLastCrawl = false,
): Promise<CrawledJob[]> {
  const queue = careersQueue()?.enqueueCrawl;
  if (!queue) throw new Error("Careers crawl queue is unavailable.");
  const status = await queue({
    key: crawlQueueKey(recipe, url),
    host: url.hostname,
    payload: recipe
      ? {
          recipe,
          ...(url.search ? { sourceUrl: url.href } : {}),
          limit,
          budgetMs: CAREERS_CRAWL_BUDGET_MS,
        }
      : { careersUrl: url.href },
    scanTaskId,
    requestId: getRequestContext()?.requestId,
  });
  const result = (
    status.state === "finished"
      ? status.result
      : useLastCrawl
        ? await careersQueue()?.readCrawl?.(crawlQueueKey(recipe, url), url.hostname)
        : null
  ) as RemoteCareersSiteRunResult | null;
  if (status.state === "queued" && !result) throw new CareersWorkPending("Careers crawl queued.");
  if (result?.kind === "jobs" && Array.isArray(result.jobs)) return result.jobs;
  if (result?.kind === "blocked") throw new SiteBlockedError(url.hostname, result.reason);
  if (result?.kind === "unavailable") throw new RemoteCareersSiteUnavailableError(result.message);
  throw new Error("Careers crawl failed.");
}
async function cachedJob(input: {
  source: WatchlistSelectedSource;
  jobRef: string;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const url = careersUrl(input.source.careersUrl);
  const host = url.hostname;
  const sourceKey = key(host, url.search);
  const entry = careersQueue()?.readCrawl ? undefined : getFreshMapEntry(cache, sourceKey);
  let job = entry?.jobs.get(input.jobRef);
  const readCrawl = careersQueue()?.readCrawl;
  if (!job && readCrawl) {
    const recipe = (await getSiteRecipe(host))?.recipe ?? null;
    const publicResult = (await readCrawl(
      crawlQueueKey(recipe, url),
      host,
    )) as RemoteCareersSiteRunResult | null;
    const result =
      publicResult?.kind === "jobs"
        ? publicResult
        : url.search
          ? ((await readCrawl(crawlQueueKey(null, url), host)) as RemoteCareersSiteRunResult | null)
          : null;
    if (result?.kind === "jobs") job = result.jobs.find((item) => item.url === input.jobRef);
  }
  if (!job) throw badRequest("Refresh this careers site before importing or opening this posting.");
  return { host, sourceKey, job };
}

export const careersSiteWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "careers_site",
  descriptor: {
    sourceType: "careers_site",
    label: "Careers site",
    catalogLabel: "Company careers site",
    customSourceOptionLabel: "Custom careers site URL",
    customSourceSearchText: "custom careers site url",
    customSourceInputLabel: "Company careers URL",
    customSourcePlaceholder: "https://www.okta.com/company/careers/",
    customSourceHelpText:
      "Paste an HTTPS careers URL. First visits learn the site in the background; check again in a minute. Fetches up to 60 postings, 10 when only the listing renders, or 4 when details render.",
    emptyCatalogText: "No careers site sources found.",
    fetchingLabel: "Fetching from careers site...",
    invalidUrlMessage: "Use an HTTPS careers URL without credentials or a port.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  parseCatalogSources(entries) {
    return parseCatalogSourcesLenient(entries, sourceSchema, (parsed) => {
      const url = careersUrl(parsed.careersUrl);
      return {
        id: key(url.hostname, url.search),
        label: parsed.label,
        sourceType: "careers_site",
        careersUrl: url.href,
        cxsJobsUrl: null,
      };
    });
  },
  hydrateSelectedSource(source) {
    const url = careersUrl(source.careersUrl);
    return {
      ...source,
      careersUrl: url.href,
      label: source.label.trim() || url.hostname,
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const url = careersUrl(input.careersUrl);
    return { careersUrl: url.href, label: input.label?.trim() || url.hostname };
  },
  async fetchJobs(input) {
    const url = careersUrl(input.source.careersUrl);
    const host = url.hostname;
    if (isWorkerdRuntime()) {
      // A known Greenhouse board is a cheap API request; prefer it over driving a browser.
      const fallback = greenhouseFallback(input.source);
      if (fallback) return greenhouseWatchlistAdapter.fetchJobs({ ...input, source: fallback });
      if (!getRemoteCareersSiteRunner()) {
        throw serviceUnavailable(
          `Careers-site sources need a browser, which is not available on this deployment yet, and no Greenhouse board is known for ${host}.`,
        );
      }
    }
    const sourceKey = key(host, url.search);
    const { signal, stopAt } = createSoftDeadline(input.signal, {
      hardMs: 25_000,
      softMs: 20_000,
      abortAtSoft: false,
    });
    signal.throwIfAborted();
    const stored = await getSiteRecipe(host);
    signal.throwIfAborted();
    if (stored?.blockedReason) {
      clearHostCache(host);
      if (blockIsActive(stored)) throw blocked(host);
      // The block has expired: relearn once. A new block refreshes the timestamp.
      return startLearning(host, url.href);
    }
    if (learning.has(host) || !stored?.recipe || stored.consecutiveFailures >= 3)
      return startLearning(host, url.href);
    const recipe = stored.recipe;
    // Rendered details take 2–20 s/page. Keep their cap at 4 within the
    // 25 s hard budget; listing-only rendering gets 10, while plain/JSON-LD
    // recipes get 60.
    const listingRenders =
      url.search && recipe.search && sameListingPath(recipe.search, url.href)
        ? recipe.search.render
        : recipe.listing.kind === "page" && recipe.listing.render;
    const limit = detailRenders(recipe) ? 4 : listingRenders ? 10 : 60;
    cache.delete(sourceKey);
    let collected: CrawledJob[];
    const queued = !input.preview && Boolean(careersQueue()?.enqueueCrawl);
    try {
      collected = queued
        ? await crawlQueued(recipe, url, limit, undefined, input.useLastCrawl)
        : await crawl(recipe, host, {
            limit,
            signal,
            stopAt,
            ...(url.search ? { sourceUrl: url.href } : {}),
          });
      signal.throwIfAborted();
    } catch (error) {
      if (error instanceof CareersWorkPending) throw error;
      if (error instanceof SiteBlockedError) {
        if (!queued && !input.preview) await markSiteBlocked(host, error.reason);
        throw blocked(host);
      }
      input.signal?.throwIfAborted();
      // An unreachable browser says nothing about the recipe; do not count it toward relearning.
      if (error instanceof RemoteCareersSiteUnavailableError)
        throw serviceUnavailable(error.message);
      if (!queued && !input.preview && (await recordSiteRecipeRun(host, false)) >= 3)
        return startLearning(host, url.href);
      throw upstreamError("Could not read jobs from this careers site. Try again later.");
    }
    // An empty filtered listing says nothing about the shared host recipe.
    if (!queued && !input.preview && (collected.length > 0 || !url.search)) {
      const failures = await recordSiteRecipeRun(host, collected.length > 0);
      if (failures >= 3) return startLearning(host, url.href);
    }
    const jobs = collected.slice(0, limit);
    // A recipe learned before the quality gate may fit one posting of hundreds and still look
    // healthy, so it would never be relearned. Relearn it once in the background (the learner now
    // vets the replacement) and keep serving what it found meanwhile.
    if (
      !url.search &&
      shouldRelearnUnderfitRecipe({ learnedAt: stored.learnedAt, postings: jobs.length })
    ) {
      void ensureLearning(host, url.href, true).catch(() => undefined);
    }
    if (!queued && !input.preview) {
      setBoundedMapEntry(
        cache,
        sourceKey,
        {
          expires: Date.now() + 15 * 60_000,
          jobs: new Map(jobs.map((job) => [job.url, job])),
        },
        100,
      );
    }
    return {
      total: jobs.length,
      fetched: jobs.length,
      jobs: jobs.map((job) => ({
        jobRef: job.url,
        source: sourceKey,
        sourceJobId: job.id,
        sourceType: "careers_site",
        title: job.title,
        employer: job.employer || input.source.label,
        jobUrl: job.url,
        applicationLink: job.url,
        location: job.location,
        postedAt: job.postedAt,
      })),
    };
  },
  async fetchJobDetails(input) {
    const fallback = greenhouseFallback(input.source);
    if (fallback) return greenhouseWatchlistAdapter.fetchJobDetails({ ...input, source: fallback });
    const { job } = await cachedJob(input);
    return {
      jobRef: input.jobRef,
      jobUrl: job.url,
      descriptionHtml: job.descriptionHtml || "",
    };
  },
  async discoverSearchFacets({ careersUrl: value }) {
    const { search } = await searchFor(careersUrl(value));
    return search ? facetParamsFromSearch(search) : [];
  },
  async prepareImportDraft(input) {
    const fallback = greenhouseFallback(input.source);
    if (fallback)
      return greenhouseWatchlistAdapter.prepareImportDraft({ ...input, source: fallback });
    const { host, sourceKey, job } = await cachedJob(input);
    return {
      source: sourceKey,
      sourceHost: host,
      draft: {
        source: sourceKey,
        sourceJobId: job.id,
        title: job.title,
        employer: job.employer || input.source.label,
        jobUrl: job.url,
        applicationLink: job.url,
        location: job.location ?? undefined,
        // Only fields the recipe verified are present; ones a posting lacks stay blank.
        salary: job.salary ?? undefined,
        deadline: job.deadline ?? undefined,
        jobType: job.jobType ?? undefined,
        jobLevel: job.jobLevel ?? undefined,
        jobDescription: convert(job.descriptionHtml || "", { wordwrap: false }),
      },
    };
  },
};

/** The verified search of this host's public recipe, when it describes the given listing path. */
async function searchFor(url: URL) {
  const stored = await getSiteRecipe(url.hostname);
  const search = stored?.recipe?.search;
  return { stored, search: search && sameListingPath(search, url.href) ? search : undefined };
}

/**
 * Which filters a custom careers URL can offer. Reads only the public recipe: no model call, no
 * network request, and nothing about the caller beyond the URL they already hold.
 */
export async function getCareersSiteSearchControls(
  value: string,
): Promise<WatchlistSearchControlsResponse> {
  const url = careersUrl(value);
  const { stored, search } = await searchFor(url);
  if (stored?.blockedReason && blockIsActive(stored)) return { status: "unsupported" };
  if (search) {
    return {
      status: "ready",
      controls: search.params
        .map((param) => ({
          key: param.key,
          ...(param.label ? { label: param.label } : {}),
          ...roleField(param),
          input: param.input,
          multiple:
            param.input.kind === "choice"
              ? param.encoding !== "single"
              : param.input.multiple === true,
        }))
        // The same controls appear in the same order on every board: keyword first, then location.
        .sort((a, b) => roleRank(a.role) - roleRank(b.role)),
      values: readSearchValues(search, url.href),
    };
  }
  const queuedScan = await careersQueue()?.scanStatus?.(url.href);
  if (queuedScan?.state === "queued" || learning.has(url.hostname)) return { status: "learning" };
  if (!canRescan(stored, url)) return { status: "unsupported" };
  const scan = queuedScan?.state === "finished" ? queuedScan.outcome : lastScan(url.hostname);
  // A scan that finished and found nothing is an answer; offering the button again would only
  // repeat it. A failed or unfinished one says why, so it can be retried or reported.
  if (
    scan?.outcome === "none" &&
    (queuedScan?.state === "finished"
      ? Date.now() - queuedScan.finishedAt < RESCAN_COOLDOWN_MS
      : scannedRecently(url.hostname))
  )
    return { status: "none", lastScan: scan };
  return { status: "rescan", ...(scan ? { lastScan: scan } : {}) };
}

/** Build the source URL for the user's own filter values, validated against the verified controls. */
export async function applyCareersSiteSearch(
  value: string,
  values: SearchValues,
): Promise<{ careersUrl: string }> {
  const { search } = await searchFor(careersUrl(value));
  if (!search)
    throw unprocessableEntity("Search filters are not available for this careers site yet.");
  // Keep the user's other filters (a Suggest result, say) when only the verified controls change.
  return { careersUrl: careersUrl(buildSearchUrl(search, values, careersUrl(value).href)).href };
}

/** A host whose scan finished is not scanned again within this long, whether or not it found anything. */
const RESCAN_COOLDOWN_MS = 6 * 60 * 60_000;
/** Only a scan that really ran counts: a browser that was still starting did not look at the site. */
function scannedRecently(host: string): boolean {
  const scan = scans.get(host);
  return (
    scan !== undefined &&
    scan.outcome !== "unavailable" &&
    Date.now() - scan.at < RESCAN_COOLDOWN_MS
  );
}

/**
 * Whether this page may trigger a relearn. The recipe is shared by every user of the host, so a
 * relearn must not replace one that already has verified search, nor one whose page listing is a
 * different page than the one asked about (a sitemap recipe is host-wide and has no page).
 */
function canRescan(stored: SiteRecipeRecord | null, url: URL): boolean {
  const recipe = stored?.recipe;
  if (!recipe) return true;
  if (recipe.search) return false;
  return recipe.listing.kind === "sitemap" || sameUrlPath(recipe.listing.url, url.href);
}

/**
 * Re-learn a host on request so an existing recipe can gain search controls. The working recipe
 * stays in place until a verified replacement is saved.
 */
export async function rescanCareersSite(value: string): Promise<void> {
  const url = careersUrl(value);
  const stored = await getSiteRecipe(url.hostname);
  if (stored?.blockedReason && blockIsActive(stored)) throw blocked(url.hostname);
  if (!canRescan(stored, url))
    throw unprocessableEntity("This site's search filters cannot be re-learned from this page.");
  if (scannedRecently(url.hostname) && !learning.has(url.hostname))
    throw serviceUnavailable("This site was scanned recently. Try again later.");
  await ensureLearning(url.hostname, url.href);
}
