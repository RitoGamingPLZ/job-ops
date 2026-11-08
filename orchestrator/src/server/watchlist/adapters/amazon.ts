import { setTimeout as delay } from "node:timers/promises";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const ORIGIN = "https://www.amazon.jobs";
const MAX_JOBS = 60;
const catalogSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().url().max(2000),
});
const jobSchema = z.object({
  id_icims: z.union([z.string(), z.number()]).transform(String),
  title: z.string().trim().min(1),
  job_path: z.string(),
  company_name: z.string().nullish(),
  location: z.string().nullish(),
  normalized_location: z.string().nullish(),
  posted_date: z.string().nullish(),
  description: z.string().nullish(),
  basic_qualifications: z.string().nullish(),
  preferred_qualifications: z.string().nullish(),
});
type AmazonJob = z.infer<typeof jobSchema>;
const responseSchema = z.object({
  error: z.unknown().optional(),
  hits: z.number().nonnegative(),
  jobs: z.array(z.unknown()),
});

function normalizeSearch(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["amazon.jobs", "www.amazon.jobs"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/en\/search\/?$/.test(url.pathname)
  ) {
    throw new Error("Expected an https://www.amazon.jobs/en/search URL.");
  }
  url.hostname = "www.amazon.jobs";
  url.pathname = "/en/search";
  url.hash = "";
  url.searchParams.delete("offset");
  url.searchParams.delete("result_limit");
  url.searchParams.set("sort", "recent");
  url.searchParams.sort();
  return url;
}

async function search(url: URL, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(25_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    combined.throwIfAborted();
    const response = await fetch(url, { signal: combined, redirect: "error" });
    if (response.status === 429 && attempt < 2) {
      await response.body?.cancel();
      await delay(250 * 2 ** attempt, undefined, { signal: combined });
      continue;
    }
    if (!response.ok) {
      throw new Error(`Amazon search failed (HTTP ${response.status}).`);
    }
    const result = responseSchema.parse(await response.json());
    if (result.error) throw new Error("Amazon search returned an error.");
    return result;
  }
  throw new Error("Amazon search retry limit reached.");
}

function searchEndpoint(careersUrl: string): URL {
  const url = normalizeSearch(careersUrl);
  url.pathname = "/en/search.json";
  url.searchParams.set("offset", "0");
  url.searchParams.set("result_limit", String(MAX_JOBS));
  return url;
}

function jobUrl(job: AmazonJob): string {
  if (!/^\d+$/.test(job.id_icims)) throw new Error("Invalid Amazon job ID.");
  const url = new URL(job.job_path, ORIGIN);
  if (
    url.origin !== ORIGIN ||
    !url.pathname.startsWith(`/en/jobs/${job.id_icims}/`)
  ) {
    throw new Error("Invalid Amazon job URL.");
  }
  return url.href;
}

function validJobs(entries: unknown[]): AmazonJob[] {
  return entries.flatMap((entry) => {
    const parsed = jobSchema.safeParse(entry);
    if (!parsed.success) return [];
    try {
      jobUrl(parsed.data);
      return [parsed.data];
    } catch {
      return [];
    }
  });
}

async function getJob(jobRef: string, signal?: AbortSignal) {
  if (!/^\d+$/.test(jobRef)) throw new Error("Invalid Amazon job reference.");
  const url = searchEndpoint(`${ORIGIN}/en/search`);
  url.searchParams.set("base_query", jobRef);
  const result = await search(url, signal);
  const job = validJobs(result.jobs).find((entry) => entry.id_icims === jobRef);
  if (!job) throw new Error("Amazon job was not found.");
  return job;
}

function descriptionHtml(job: AmazonJob): string {
  return [
    job.description,
    job.basic_qualifications &&
      `<h2>Basic qualifications</h2>${job.basic_qualifications}`,
    job.preferred_qualifications &&
      `<h2>Preferred qualifications</h2>${job.preferred_qualifications}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function postedAt(job: AmazonJob): string | null {
  const timestamp = Date.parse(`${job.posted_date} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export const amazonWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "amazon",
  descriptor: {
    sourceType: "amazon",
    label: "Amazon",
    catalogLabel: "Amazon careers",
    customSourceOptionLabel: "Custom Amazon search URL",
    customSourceSearchText: "custom amazon url",
    customSourceInputLabel: "Amazon careers search URL",
    customSourcePlaceholder: `${ORIGIN}/en/search?base_query=software&loc_query=Seattle`,
    customSourceHelpText:
      "Paste an Amazon search URL with your keyword and location filters. Fetches up to 60 jobs, newest first.",
    emptyCatalogText: "No Amazon sources found.",
    fetchingLabel: "Fetching from Amazon...",
    invalidUrlMessage: "That is not a supported Amazon careers search URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema,
  parseCatalogSources(entries) {
    return z
      .array(catalogSchema)
      .parse(entries)
      .map((entry) => ({
        id: `amazon:${entry.key}`,
        label: entry.label,
        careersUrl: normalizeSearch(entry.careersUrl).href,
        cxsJobsUrl: null,
        sourceType: "amazon",
      }));
  },
  hydrateSelectedSource(source) {
    return {
      ...source,
      careersUrl: normalizeSearch(source.careersUrl).href,
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    return {
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : "Amazon",
      careersUrl: normalizeSearch(input.careersUrl).href,
    };
  },
  async fetchJobs(input) {
    const stopAt = Date.now() + 20_000;
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000);
    const url = searchEndpoint(input.source.careersUrl);
    const collected = new Map<string, AmazonJob>();
    let total = 0;
    let offset = 0;
    // Some searches return fewer rows than result_limit. Follow their offsets,
    // with a request bound and a shared deadline across all pages and retries.
    for (let page = 0; page < MAX_JOBS && Date.now() < stopAt; page++) {
      url.searchParams.set("offset", String(offset));
      let result: Awaited<ReturnType<typeof search>>;
      try {
        result = await search(url, signal);
      } catch (error) {
        input.signal?.throwIfAborted();
        if (signal.aborted && collected.size) break;
        throw error;
      }
      total = result.hits;
      const previousSize = collected.size;
      for (const job of validJobs(result.jobs))
        collected.set(job.id_icims, job);
      offset += result.jobs.length;
      if (
        collected.size >= MAX_JOBS ||
        offset >= total ||
        collected.size === previousSize
      )
        break;
    }
    input.signal?.throwIfAborted();
    const jobs = [...collected.values()]
      .map((job) => ({
        jobRef: job.id_icims,
        source: "amazon",
        sourceJobId: job.id_icims,
        sourceType: "amazon",
        title: job.title,
        employer: job.company_name || "Amazon",
        jobUrl: jobUrl(job),
        applicationLink: jobUrl(job),
        location: job.normalized_location || job.location || null,
        postedAt: postedAt(job),
      }))
      .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
      .slice(0, MAX_JOBS);
    return { total, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    const job = await getJob(input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: jobUrl(job),
      descriptionHtml: descriptionHtml(job),
    };
  },
  async prepareImportDraft(input) {
    const job = await getJob(input.jobRef, input.signal);
    return {
      source: "amazon",
      sourceHost: "www.amazon.jobs",
      draft: {
        source: "amazon",
        sourceJobId: job.id_icims,
        title: job.title,
        employer: job.company_name || "Amazon",
        jobUrl: jobUrl(job),
        applicationLink: jobUrl(job),
        location: job.normalized_location || job.location || undefined,
        jobDescription: convert(descriptionHtml(job), { wordwrap: false }),
      },
    };
  },
};
