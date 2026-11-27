import { escapeHtmlMarkup } from "@infra/html";
import { asyncPool } from "@server/utils/async-pool";
import { parseCatalogSourcesLenient, setBoundedMapEntry } from "./common";
import { extractJsonLdObjects, findJsonLdJobPostings } from "./html";
import { parseWatchlistUrl, hasPlainHttpsAuthority } from "./url";
import { createBudgetSignal, createSoftDeadline, fetchWatchlist } from "./http";
import { badRequest, upstreamError } from "@infra/errors";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const ORIGIN = "https://www.metacareers.com";
const LIMIT = 60;
const USER_AGENT = "job-ops-crawler/1.0";
const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const postingSchema = z.object({
  "@type": z.literal("JobPosting"),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  responsibilities: z.string().optional(),
  qualifications: z.string().optional(),
  datePosted: z.string().optional(),
  department: z.string().optional(),
  occupationalCategory: z.string().optional(),
  jobLocation: z
    .union([z.array(z.object({ name: z.string() })), z.object({ name: z.string() })])
    .optional(),
});
type Job = {
  id: string;
  title: string;
  location: string | null;
  postedAt: string | null;
  descriptionHtml: string;
};
// Explicitly global public postings only, keyed by Meta's public job ID. No
// tenant selections, filters, credentials or import state. Replaced every list
// fetch, with at most LIMIT entries (including detail-cache misses).
let listedJobs = new Map<string, Job>();

function trustedUrl(value: string): URL {
  const url = parseWatchlistUrl(value, "Invalid Meta careers URL.");
  if (url.origin !== ORIGIN || !hasPlainHttpsAuthority(value))
    throw badRequest("Use an HTTPS URL on www.metacareers.com without a port or userinfo.");
  return url;
}
function searchUrl(value: string): string {
  const url = trustedUrl(value);
  if (!/^\/jobs\/?$/.test(url.pathname)) throw badRequest("Use the Meta careers /jobs URL.");
  // One unfiltered catalog source; keyword filtering belongs to the pipeline.
  return `${ORIGIN}/jobs`;
}
function requestedId(value: string): string {
  const url = trustedUrl(value);
  const match = url.pathname.match(/^\/profile\/job_details\/(\d+)\/?$/);
  if (!match || url.search || url.hash) throw badRequest("Invalid Meta job detail URL.");
  return match[1];
}
function jobUrl(id: string): string {
  return `${ORIGIN}/profile/job_details/${id}/`;
}
function structureError(part: string): Error {
  return upstreamError(`Meta careers ${part} structure may have changed.`);
}
async function pageHtml(url: string, signal: AbortSignal): Promise<string> {
  trustedUrl(url);
  // metacareers.com redirects requests without a User-Agent to /unsupportedbrowser, and
  // workerd's fetch does not guarantee one, so always identify ourselves.
  return fetchWatchlist({
    url,
    signal,
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" },
    maxRetries: 3,
    retryDelayMs: ({ attempt }) => 250 * 2 ** attempt,
    responseType: "text",
    formatHttpError: ({ status, response }) => {
      const location = response.headers.get("location");
      return upstreamError(
        `Meta careers returned HTTP ${status}${location ? ` (redirect to ${new URL(location, ORIGIN).pathname})` : ""}.`,
      );
    },
  });
}
function parseSitemap(xml: string) {
  if (!/<urlset\b/.test(xml) || !/<\/urlset\s*>/.test(xml)) throw structureError("sitemap");
  const rows = [...xml.matchAll(/<url\s*>([\s\S]*?)<\/url\s*>/g)];
  const jobs = rows.flatMap((row) => {
    const loc = row[1].match(/<loc\s*>([^<]+)<\/loc\s*>/)?.[1];
    const lastmod = row[1].match(/<lastmod\s*>([^<]+)<\/lastmod\s*>/)?.[1];
    if (!loc || !lastmod || !Number.isFinite(Date.parse(lastmod))) return [];
    try {
      return [{ id: requestedId(loc.trim()), modified: Date.parse(lastmod) }];
    } catch {
      return [];
    }
  });
  if (!jobs.length) throw structureError("sitemap (no job URLs)");
  return [...new Map(jobs.map((job) => [job.id, job])).values()].sort(
    (a, b) => b.modified - a.modified,
  );
}
function parseDetail(html: string, id: string): Job {
  // Stable public SEO payload observed live, without inspecting private Relay
  // payloads or tokens. Never evaluate embedded JavaScript.
  for (const data of findJsonLdJobPostings(extractJsonLdObjects(html))) {
    const parsed = postingSchema.safeParse(data);
    if (!parsed.success) continue;
    const posting = parsed.data;
    const locations = Array.isArray(posting.jobLocation)
      ? posting.jobLocation
      : posting.jobLocation
        ? [posting.jobLocation]
        : [];
    const team = posting.department || posting.occupationalCategory;
    const descriptionHtml = [
      team ? `<h3>Team</h3><p>${escapeHtmlMarkup(team)}</p>` : "",
      posting.description,
      posting.responsibilities ? `<h3>Responsibilities</h3>${posting.responsibilities}` : "",
      posting.qualifications ? `<h3>Qualifications</h3>${posting.qualifications}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .replace(/&nbsp;/g, "<br>");
    return {
      id,
      title: posting.title,
      location: [...new Set(locations.map((item) => item.name))].join("; ") || null,
      postedAt:
        posting.datePosted && Number.isFinite(Date.parse(posting.datePosted))
          ? new Date(posting.datePosted).toISOString()
          : null,
      descriptionHtml,
    };
  }
  throw structureError("JobPosting detail");
}
async function details(jobRef: string, signal?: AbortSignal): Promise<Job> {
  const id = requestedId(jobRef);
  signal?.throwIfAborted();
  const cached = listedJobs.get(id);
  if (cached) return cached;
  const job = parseDetail(await pageHtml(jobUrl(id), createBudgetSignal(signal, 24_000)), id);
  setBoundedMapEntry(listedJobs, id, job, LIMIT);
  return job;
}

export const metaWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "meta",
  descriptor: {
    sourceType: "meta",
    label: "Meta",
    catalogLabel: "Meta careers",
    customSourceOptionLabel: "Meta careers",
    customSourceSearchText: "meta careers",
    customSourceInputLabel: "Meta careers URL",
    customSourcePlaceholder: `${ORIGIN}/jobs`,
    customSourceHelpText:
      "Fetches up to 60 recently updated public postings within 20 seconds (partial results on slow responses). Search terms are filtered afterwards.",
    emptyCatalogText: "No Meta sources found.",
    fetchingLabel: "Fetching from Meta...",
    invalidUrlMessage: "That is not a supported Meta careers URL.",
    supportsCustomSource: false,
    supportsBranding: false,
  },
  parseCatalogSources(entries) {
    return parseCatalogSourcesLenient(entries, sourceSchema, (parsed) => ({
      id: "meta:meta",
      label: parsed.label,
      sourceType: "meta",
      careersUrl: searchUrl(parsed.careersUrl),
      cxsJobsUrl: null,
    }));
  },
  hydrateSelectedSource(source) {
    return {
      ...source,
      label: source.label.trim() || "Meta",
      careersUrl: searchUrl(source.careersUrl),
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    return {
      label: input.label?.trim() || "Meta",
      careersUrl: searchUrl(input.careersUrl),
    };
  },
  async fetchJobs(input) {
    listedJobs = new Map();
    searchUrl(input.source.careersUrl);
    const deadline = createSoftDeadline(input.signal, { hardMs: 24_000, softMs: 20_000 });
    const signal = deadline.signal;
    const entries = parseSitemap(await pageHtml(`${ORIGIN}/jobsearch/sitemap.xml`, signal));
    const selected = entries.slice(0, LIMIT);
    const collected = new Map<string, Job>();
    await asyncPool({
      items: selected,
      concurrency: 2,
      shouldStop: () => signal.aborted || !deadline.hasTimeLeft(),
      task: async (entry) => {
        try {
          const requestSignal = createBudgetSignal(
            signal,
            Math.max(1, Math.min(5_000, deadline.remainingMs())),
          );
          const job = parseDetail(await pageHtml(jobUrl(entry.id), requestSignal), entry.id);
          collected.set(entry.id, job);
        } catch {
          // A removed/failed posting must not discard other successful details.
          input.signal?.throwIfAborted();
        }
      },
    });
    input.signal?.throwIfAborted();
    if (!collected.size)
      throw upstreamError(
        "Meta careers: all selected job details failed or the operation deadline was reached.",
      );
    const ordered = selected.flatMap(({ id }) => {
      const job = collected.get(id);
      return job ? [job] : [];
    });
    listedJobs = new Map(ordered.map((job) => [job.id, job]));
    const jobs = ordered.map((job) => ({
      jobRef: jobUrl(job.id),
      source: "meta",
      sourceJobId: job.id,
      sourceType: "meta",
      title: job.title,
      employer: "Meta",
      jobUrl: jobUrl(job.id),
      applicationLink: jobUrl(job.id),
      location: job.location,
      postedAt: job.postedAt,
    }));
    return { total: entries.length, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    searchUrl(input.source.careersUrl);
    const job = await details(input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: jobUrl(job.id),
      descriptionHtml: job.descriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    searchUrl(input.source.careersUrl);
    const job = await details(input.jobRef, input.signal);
    return {
      source: "meta",
      sourceHost: "www.metacareers.com",
      draft: {
        source: "meta",
        sourceJobId: job.id,
        title: job.title,
        employer: "Meta",
        jobUrl: jobUrl(job.id),
        applicationLink: jobUrl(job.id),
        location: job.location ?? undefined,
        jobDescription: convert(job.descriptionHtml, { wordwrap: false }),
      },
    };
  },
};
