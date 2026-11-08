import { badRequest, serviceUnavailable, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import {
  getSiteRecipe,
  markSiteBlocked,
  recordSiteRecipeRun,
  saveSiteRecipe,
} from "@server/repositories/site-recipes";
import {
  learnRecipe,
  RecipeLearningError,
} from "@server/watchlist/careers-site/learn";
import { runRecipe } from "@server/watchlist/careers-site/run-recipe";
import {
  type CrawledJob,
  SiteBlockedError,
} from "@server/watchlist/careers-site/types";
import type { WatchlistSelectedSource } from "@shared/types";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const LEARNING = "Learning this careers site, check again in a minute";
// Explicitly global: only public recipes and postings, keyed by host. No tenant
// settings, credentials, selections or import state are retained here.
const learning = new Map<string, Promise<void>>();
const failedLearns = new Map<string, number>();
const FAILED_LEARN_COOLDOWN_MS = 30 * 60_000;
const cache = new Map<
  string,
  { expires: number; jobs: Map<string, CrawledJob> }
>();

function careersUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Use an HTTPS careers URL without credentials or a port.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (
    url.protocol !== "https:" ||
    !authority ||
    authority.includes("@") ||
    authority.includes(":")
  )
    throw badRequest("Use an HTTPS careers URL without credentials or a port.");
  url.hash = "";
  return url;
}
function key(host: string) {
  return `careers_site:${host}`;
}
function blocked(host: string) {
  return upstreamError(
    `Careers site ${host} blocks automated access. It remains blocked until a new recipe is saved.`,
  );
}
function startLearning(host: string, url: string): never {
  cache.delete(host);
  const failedAt = failedLearns.get(host);
  if (
    failedAt !== undefined &&
    Date.now() - failedAt < FAILED_LEARN_COOLDOWN_MS
  )
    throw serviceUnavailable(
      "Could not learn this careers site. Try again later.",
    );
  if (!learning.has(host)) {
    const p = (async () => {
      try {
        const recipe = await learnRecipe(url, {
          signal: AbortSignal.timeout(180_000),
        });
        await saveSiteRecipe(host, recipe);
        failedLearns.delete(host);
      } catch (error) {
        if (error instanceof SiteBlockedError)
          await markSiteBlocked(host, error.reason);
        else {
          const now = Date.now();
          for (const [failedHost, failedAt] of failedLearns) {
            if (now - failedAt >= FAILED_LEARN_COOLDOWN_MS)
              failedLearns.delete(failedHost);
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
          error instanceof RecipeLearningError
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
  const host = careersUrl(input.source.careersUrl).hostname;
  const entry = cache.get(host);
  if (entry && entry.expires <= Date.now()) cache.delete(host);
  const job =
    entry && entry.expires > Date.now()
      ? entry.jobs.get(input.jobRef)
      : undefined;
  if (!job)
    throw badRequest(
      "Refresh this careers site before importing or opening this posting.",
    );
  return { host, job };
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
      "Paste an HTTPS careers URL. First visits learn the site in the background; check again in a minute. Fetches up to 40 postings, 10 when only the listing renders, or 4 when details render.",
    emptyCatalogText: "No careers site sources found.",
    fetchingLabel: "Fetching from careers site...",
    invalidUrlMessage:
      "Use an HTTPS careers URL without credentials or a port.",
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
            id: key(url.hostname),
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
    const timeout = AbortSignal.timeout(25_000);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeout])
      : timeout;
    signal.throwIfAborted();
    const stored = await getSiteRecipe(host);
    signal.throwIfAborted();
    if (stored?.blockedReason) {
      cache.delete(host);
      throw blocked(host);
    }
    if (
      learning.has(host) ||
      !stored?.recipe ||
      stored.consecutiveFailures >= 3
    )
      startLearning(host, url.href);
    const recipe = stored.recipe;
    // ponytail: rendered details take 2–20 s/page at concurrency 2. Limit to
    // 4 allows two detail rounds within the 25 s budget; listing-only rendering
    // gets 10, while plain/JSON-LD recipes get 40.
    const limit =
      recipe.detail.kind === "selectors" && recipe.detail.render
        ? 4
        : recipe.listing.kind === "page" && recipe.listing.render
          ? 10
          : 40;
    cache.delete(host);
    let collected: CrawledJob[];
    try {
      collected = await runRecipe(recipe, { limit, signal });
      signal.throwIfAborted();
    } catch (error) {
      if (error instanceof SiteBlockedError) {
        await markSiteBlocked(host, error.reason);
        throw blocked(host);
      }
      input.signal?.throwIfAborted();
      const failures = await recordSiteRecipeRun(host, false);
      if (failures >= 3) startLearning(host, url.href);
      throw upstreamError(
        "Could not read jobs from this careers site. Try again later.",
      );
    }
    const failures = await recordSiteRecipeRun(host, collected.length > 0);
    if (failures >= 3) startLearning(host, url.href);
    const jobs = collected.slice(0, limit);
    cache.set(host, {
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
        source: key(host),
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
    const { job } = cachedJob(input);
    return {
      jobRef: input.jobRef,
      jobUrl: job.url,
      descriptionHtml: job.descriptionHtml || "",
    };
  },
  async prepareImportDraft(input) {
    const { host, job } = cachedJob(input);
    return {
      source: key(host),
      sourceHost: host,
      draft: {
        source: key(host),
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
