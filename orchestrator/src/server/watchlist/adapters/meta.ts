import { setTimeout as delay } from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const ORIGIN = "https://www.metacareers.com";
const LIMIT = 40;
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
    .union([
      z.array(z.object({ name: z.string() })),
      z.object({ name: z.string() }),
    ])
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
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid Meta careers URL.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (
    url.origin !== ORIGIN ||
    !authority ||
    authority.includes(":") ||
    authority.includes("@")
  )
    throw badRequest(
      "Use an HTTPS URL on www.metacareers.com without a port or userinfo.",
    );
  return url;
}
function searchUrl(value: string): string {
  const url = trustedUrl(value);
  if (!/^\/jobs\/?$/.test(url.pathname))
    throw badRequest("Use the Meta careers /jobs URL.");
  // One unfiltered catalog source; keyword filtering belongs to the pipeline.
  return `${ORIGIN}/jobs`;
}
function requestedId(value: string): string {
  const url = trustedUrl(value);
  const match = url.pathname.match(/^\/profile\/job_details\/(\d+)\/?$/);
  if (!match || url.search || url.hash)
    throw badRequest("Invalid Meta job detail URL.");
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
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "error" });
    if (response.status === 429 && attempt < 3) {
      await response.body?.cancel();
      await delay(250 * 2 ** attempt, undefined, { signal });
      continue;
    }
    if (!response.ok)
      throw upstreamError(`Meta careers returned HTTP ${response.status}.`);
    return response.text();
  }
  throw upstreamError("Meta careers retry limit exceeded.");
}
function parseSitemap(xml: string) {
  if (!/<urlset\b/.test(xml) || !/<\/urlset\s*>/.test(xml))
    throw structureError("sitemap");
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
  for (const script of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1]))
      continue;
    let data: unknown;
    try {
      data = JSON.parse(script[2]);
    } catch {
      continue;
    }
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
      team ? `<h3>Team</h3><p>${escapeHtml(team)}</p>` : "",
      posting.description,
      posting.responsibilities
        ? `<h3>Responsibilities</h3>${posting.responsibilities}`
        : "",
      posting.qualifications
        ? `<h3>Qualifications</h3>${posting.qualifications}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
      .replace(/&nbsp;/g, "<br>");
    return {
      id,
      title: posting.title,
      location:
        [...new Set(locations.map((item) => item.name))].join("; ") || null,
      postedAt:
        posting.datePosted && Number.isFinite(Date.parse(posting.datePosted))
          ? new Date(posting.datePosted).toISOString()
          : null,
      descriptionHtml,
    };
  }
  throw structureError("JobPosting detail");
}
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function operationSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(24_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function details(jobRef: string, signal?: AbortSignal): Promise<Job> {
  const id = requestedId(jobRef);
  signal?.throwIfAborted();
  const cached = listedJobs.get(id);
  if (cached) return cached;
  const job = parseDetail(
    await pageHtml(jobUrl(id), operationSignal(signal)),
    id,
  );
  if (listedJobs.size >= LIMIT) {
    const oldest = listedJobs.keys().next().value;
    if (oldest) listedJobs.delete(oldest);
  }
  listedJobs.set(id, job);
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
      "Fetches up to 40 recently updated public postings within 24 seconds. Search terms are filtered afterwards.",
    emptyCatalogText: "No Meta sources found.",
    fetchingLabel: "Fetching from Meta...",
    invalidUrlMessage: "That is not a supported Meta careers URL.",
    supportsCustomSource: false,
    supportsBranding: false,
  },
  catalogSchema: sourceSchema,
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      const parsed = sourceSchema.safeParse(entry);
      if (!parsed.success) return [];
      try {
        return [
          {
            id: "meta:meta",
            label: parsed.data.label,
            sourceType: "meta",
            careersUrl: searchUrl(parsed.data.careersUrl),
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
    });
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
    const signal = operationSignal(input.signal);
    const entries = parseSitemap(
      await pageHtml(`${ORIGIN}/jobsearch/sitemap.xml`, signal),
    );
    const selected = entries.slice(0, LIMIT);
    const collected = new Map<string, Job>();
    let index = 0;
    async function worker() {
      while (index < selected.length && !signal.aborted) {
        const entry = selected[index++];
        try {
          const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(5_000),
          ]);
          const job = parseDetail(
            await pageHtml(jobUrl(entry.id), requestSignal),
            entry.id,
          );
          collected.set(entry.id, job);
        } catch {
          // A removed/failed posting must not discard other successful details.
          input.signal?.throwIfAborted();
        }
      }
    }
    await Promise.all([worker(), worker()]);
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
