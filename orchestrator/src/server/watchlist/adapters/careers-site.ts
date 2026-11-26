import { createHash } from "node:crypto";
import { badRequest, serviceUnavailable, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import {
  getSiteRecipe,
  markSiteBlocked,
  recordSiteRecipeRun,
  saveSiteRecipe,
} from "@server/repositories/site-recipes";
import { parseGreenhouseUrl } from "@career-boards/greenhouse";
import greenhouseCatalog from "@server/config/career-boards-greenhouse.json";
import { resolveLlmRuntimeSettings } from "@server/services/modelSelection";
import { learnRecipe, RecipeLearningError } from "@server/watchlist/careers-site/learn";
import {
  getRemoteCareersSiteRunner,
  RemoteCareersSiteUnavailableError,
} from "@server/watchlist/careers-site/remote";
import { runRecipe } from "@server/watchlist/careers-site/run-recipe";
import {
  type CrawledJob,
  type Recipe,
  SiteBlockedError,
} from "@server/watchlist/careers-site/types";
import type { WatchlistSelectedSource } from "@shared/types";
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
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Use an HTTPS careers URL without credentials or a port.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (url.protocol !== "https:" || !authority || authority.includes("@") || authority.includes(":"))
    throw badRequest("Use an HTTPS careers URL without credentials or a port.");
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) {
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
function isWorkerdRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}
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
function startLearning(host: string, url: string): never {
  const plainUrl = new URL(url);
  plainUrl.search = "";
  plainUrl.hash = "";
  clearHostCache(host);
  const failedAt = failedLearns.get(host);
  if (failedAt !== undefined && Date.now() - failedAt < FAILED_LEARN_COOLDOWN_MS)
    throw serviceUnavailable("Could not learn this careers site. Try again later.");
  if (!learning.has(host)) {
    const p = (async () => {
      try {
        const recipe = await learn(host, plainUrl.href, AbortSignal.timeout(180_000));
        await saveSiteRecipe(host, recipe);
        failedLearns.delete(host);
      } catch (error) {
        if (error instanceof SiteBlockedError) await markSiteBlocked(host, error.reason);
        // A browser that is still starting says nothing about this site; do not start a cooldown.
        else if (!(error instanceof RemoteCareersSiteUnavailableError)) {
          const now = Date.now();
          for (const [failedHost, failedAt] of failedLearns) {
            if (now - failedAt >= FAILED_LEARN_COOLDOWN_MS) failedLearns.delete(failedHost);
          }
          failedLearns.set(host, now);
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
  throw serviceUnavailable(LEARNING);
}
function cachedJob(input: {
  source: WatchlistSelectedSource;
  jobRef: string;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const url = careersUrl(input.source.careersUrl);
  const host = url.hostname;
  const sourceKey = key(host, url.search);
  const entry = cache.get(sourceKey);
  if (entry && entry.expires <= Date.now()) cache.delete(sourceKey);
  const job = entry && entry.expires > Date.now() ? entry.jobs.get(input.jobRef) : undefined;
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
  catalogSchema: sourceSchema,
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      try {
        const parsed = sourceSchema.safeParse(entry);
        if (!parsed.success) return [];
        const url = careersUrl(parsed.data.careersUrl);
        return [
          {
            id: key(url.hostname, url.search),
            label: parsed.data.label,
            sourceType: "careers_site",
            careersUrl: url.href,
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
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
    const stopAt = Date.now() + 20_000;
    const timeout = AbortSignal.timeout(25_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    signal.throwIfAborted();
    const stored = await getSiteRecipe(host);
    signal.throwIfAborted();
    if (stored?.blockedReason) {
      clearHostCache(host);
      if (blockIsActive(stored)) throw blocked(host);
      // The block has expired: relearn once. A new block refreshes the timestamp.
      startLearning(host, url.href);
    }
    if (learning.has(host) || !stored?.recipe || stored.consecutiveFailures >= 3)
      startLearning(host, url.href);
    const recipe = stored.recipe;
    // Rendered details take 2–20 s/page. Keep their cap at 4 within the
    // 25 s hard budget; listing-only rendering gets 10, while plain/JSON-LD
    // recipes get 60.
    const limit =
      recipe.detail.kind === "selectors" && recipe.detail.render
        ? 4
        : recipe.listing.kind === "page" && recipe.listing.render
          ? 10
          : 60;
    cache.delete(sourceKey);
    let collected: CrawledJob[];
    try {
      collected = await crawl(recipe, host, {
        limit,
        signal,
        stopAt,
        ...(url.search ? { sourceUrl: url.href } : {}),
      });
      signal.throwIfAborted();
    } catch (error) {
      if (error instanceof SiteBlockedError) {
        await markSiteBlocked(host, error.reason);
        throw blocked(host);
      }
      input.signal?.throwIfAborted();
      // An unreachable browser says nothing about the recipe; do not count it toward relearning.
      if (error instanceof RemoteCareersSiteUnavailableError)
        throw serviceUnavailable(error.message);
      const failures = await recordSiteRecipeRun(host, false);
      if (failures >= 3) startLearning(host, url.href);
      throw upstreamError("Could not read jobs from this careers site. Try again later.");
    }
    // An empty filtered listing says nothing about the shared host recipe.
    if (collected.length > 0 || !url.search) {
      const failures = await recordSiteRecipeRun(host, collected.length > 0);
      if (failures >= 3) startLearning(host, url.href);
    }
    const jobs = collected.slice(0, limit);
    cache.set(sourceKey, {
      expires: Date.now() + 15 * 60_000,
      jobs: new Map(jobs.map((job) => [job.url, job])),
    });
    while (cache.size > 100) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
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
    const { job } = cachedJob(input);
    return {
      jobRef: input.jobRef,
      jobUrl: job.url,
      descriptionHtml: job.descriptionHtml || "",
    };
  },
  async prepareImportDraft(input) {
    const fallback = greenhouseFallback(input.source);
    if (fallback)
      return greenhouseWatchlistAdapter.prepareImportDraft({ ...input, source: fallback });
    const { host, sourceKey, job } = cachedJob(input);
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
        jobDescription: convert(job.descriptionHtml || "", { wordwrap: false }),
      },
    };
  },
};
