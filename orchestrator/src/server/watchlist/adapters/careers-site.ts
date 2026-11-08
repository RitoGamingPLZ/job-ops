import { createHash } from "node:crypto";
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
// Explicitly global: public recipes/learning use host keys; public posting
// caches include the normalized source query. No tenant settings, credentials,
// selections or import state are retained here.
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
  for (const name of [...url.searchParams.keys()]) {
    if (
      /^(?:utm_.*|gclid|dclid|fbclid|msclkid|gbraid|wbraid|mc_cid|mc_eid|_ga|_gl)$/i.test(
        name,
      )
    )
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
    if (sourceKey === plain || sourceKey.startsWith(`${filteredPrefix}?`))
      cache.delete(sourceKey);
  }
}
function blocked(host: string) {
  return upstreamError(
    `Careers site ${host} blocks automated access. It remains blocked until a new recipe is saved.`,
  );
}
function startLearning(host: string, url: string): never {
  const plainUrl = new URL(url);
  plainUrl.search = "";
  plainUrl.hash = "";
  clearHostCache(host);
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
        const recipe = await learnRecipe(plainUrl.href, {
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
  const url = careersUrl(input.source.careersUrl);
  const host = url.hostname;
  const sourceKey = key(host, url.search);
  const entry = cache.get(sourceKey);
  if (entry && entry.expires <= Date.now()) cache.delete(sourceKey);
  const job =
    entry && entry.expires > Date.now()
      ? entry.jobs.get(input.jobRef)
      : undefined;
  if (!job)
    throw badRequest(
      "Refresh this careers site before importing or opening this posting.",
    );
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
    const sourceKey = key(host, url.search);
    const stopAt = Date.now() + 20_000;
    const timeout = AbortSignal.timeout(25_000);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeout])
      : timeout;
    signal.throwIfAborted();
    const stored = await getSiteRecipe(host);
    signal.throwIfAborted();
    if (stored?.blockedReason) {
      clearHostCache(host);
      throw blocked(host);
    }
    if (
      learning.has(host) ||
      !stored?.recipe ||
      stored.consecutiveFailures >= 3
    )
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
      collected = await runRecipe(recipe, {
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
      const failures = await recordSiteRecipeRun(host, false);
      if (failures >= 3) startLearning(host, url.href);
      throw upstreamError(
        "Could not read jobs from this careers site. Try again later.",
      );
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
    const { job } = cachedJob(input);
    return {
      jobRef: input.jobRef,
      jobUrl: job.url,
      descriptionHtml: job.descriptionHtml || "",
    };
  },
  async prepareImportDraft(input) {
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
