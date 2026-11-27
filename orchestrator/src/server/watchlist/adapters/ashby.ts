import { parseCatalogSourcesLenient, resolveCustomLabel } from "./common";
import { extractJsonLdObjects, findJsonLdJobPostings } from "./html";
import { createBudgetSignal, fetchWatchlist } from "./http";
import { hasPlainHttpsAuthority, parseWatchlistUrl } from "./url";
import { badRequest, upstreamError } from "@infra/errors";
import { escapeHtmlMarkup } from "@infra/html";
import type { WatchlistSelectedSource } from "@shared/types";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const MAX_JOBS = 60;
const ORIGIN = "https://jobs.ashbyhq.com";
const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  ashbyUrl: z.string().trim().url().max(2000),
});
const jobSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]+$/),
  title: z.string().trim().min(1),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string() })).optional(),
  employmentType: z.string().optional(),
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().optional(),
  publishedAt: z.string().optional(),
  jobUrl: z.string().url(),
  applyUrl: z.string().url(),
  descriptionHtml: z.string().optional(),
  descriptionPlain: z.string().optional(),
});
type Job = z.infer<typeof jobSchema>;
// Explicitly global public postings only, keyed by company AND posting ID.
// No tenant labels, selections, or workspace state; each company's fetch replaces
// only its own public postings so other selected boards remain cached for import.
const listedJobs = new Map<string, Map<string, Job>>();

export function parseAshbyUrl(value: string) {
  const url = parseWatchlistUrl(value, "Invalid Ashby careers URL.");
  const match = url.pathname.match(
    /^\/([a-zA-Z0-9][a-zA-Z0-9_-]*)(?:\/([a-zA-Z0-9-]+)(?:\/application)?)?\/?$/,
  );
  if (
    url.origin !== ORIGIN ||
    !hasPlainHttpsAuthority(value) ||
    url.username ||
    url.password ||
    !match
  )
    throw badRequest("Use an HTTPS jobs.ashbyhq.com company or posting URL.");
  return { company: match[1].toLowerCase(), id: match[2] };
}
const parseUrl = parseAshbyUrl;
function boardUrl(company: string) {
  return `${ORIGIN}/${company}`;
}
function postingUrl(company: string, id: string) {
  return `${boardUrl(company)}/${id}`;
}
async function request(url: string, signal: AbortSignal) {
  return fetchWatchlist({
    url,
    signal,
    maxRetries: 3,
    retryAfterMaxMs: 25_000,
    backoffScheduleMs: [1000, 3000, 8000],
    responseType: "response",
    formatHttpError: ({ status }) => upstreamError(`Ashby returned HTTP ${status}.`),
  });
}
function structureError() {
  return upstreamError(
    "Ashby posting data is invalid or missing; the response structure may have changed.",
  );
}
async function board(company: string, signal: AbortSignal) {
  const response = await request(
    `https://api.ashbyhq.com/posting-api/job-board/${company}`,
    signal,
  );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw structureError();
  }
  const parsed = z.object({ jobs: z.array(z.unknown()) }).safeParse(data);
  if (!parsed.success) throw structureError();
  const jobs = parsed.data.jobs.flatMap((row) => {
    const parsedJob = jobSchema.safeParse(row);
    if (!parsedJob.success) return [];
    const job = parsedJob.data;
    try {
      const link = parseUrl(job.jobUrl);
      const apply = parseUrl(job.applyUrl);
      if (
        link.company !== company ||
        link.id !== job.id ||
        apply.company !== company ||
        apply.id !== job.id
      )
        return [];
      return [job];
    } catch {
      return [];
    }
  });
  if (parsed.data.jobs.length && !jobs.length) throw structureError();
  return jobs.filter((job) => job.isListed === true);
}
function location(job: Job) {
  return (
    [
      ...new Set(
        [job.location, ...(job.secondaryLocations ?? []).map((item) => item.location)].filter(
          Boolean,
        ),
      ),
    ].join("; ") || (job.isRemote ? "Remote" : null)
  );
}
function description(job: Job) {
  if (job.descriptionHtml?.trim()) return job.descriptionHtml;
  return `<p>${escapeHtmlMarkup(job.descriptionPlain ?? "").replace(/\n/g, "<br>")}</p>`;
}
async function details(
  source: WatchlistSelectedSource,
  jobRef: string,
  signal?: AbortSignal,
): Promise<Job> {
  const { company } = parseUrl(source.careersUrl);
  const ref = parseUrl(jobRef);
  if (company !== ref.company || !ref.id)
    throw badRequest("Ashby posting must belong to the selected company.");
  signal?.throwIfAborted();
  const cached = listedJobs.get(company)?.get(ref.id);
  if (cached) return cached;
  // The public API has no single-posting endpoint. Fetch just this posting's
  // public page and read its observed JobPosting JSON-LD on a cache miss.
  const response = await request(postingUrl(company, ref.id), createBudgetSignal(signal));
  const html = await response.text();
  const placeSchema = z.object({
    address: z.object({
      addressLocality: z.string().optional(),
      addressRegion: z.string().optional(),
      addressCountry: z.string().optional(),
    }),
  });
  const schema = z.object({
    "@type": z.literal("JobPosting"),
    title: z.string().min(1),
    description: z.string().min(1),
    identifier: z.object({ value: z.literal(ref.id) }),
    datePosted: z.string().optional(),
    employmentType: z.string().optional(),
    jobLocationType: z.string().optional(),
    jobLocation: z.union([placeSchema, z.array(placeSchema)]).optional(),
  });
  for (const data of findJsonLdJobPostings(extractJsonLdObjects(html))) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) continue;
    const job = parsed.data;
    const places = Array.isArray(job.jobLocation)
      ? job.jobLocation
      : job.jobLocation
        ? [job.jobLocation]
        : [];
    return {
      id: ref.id,
      title: job.title,
      descriptionHtml: job.description,
      jobUrl: postingUrl(company, ref.id),
      applyUrl: `${postingUrl(company, ref.id)}/application`,
      publishedAt: job.datePosted,
      employmentType: job.employmentType,
      isRemote: job.jobLocationType === "TELECOMMUTE",
      location:
        places
          .map(({ address }) =>
            [address.addressLocality, address.addressRegion, address.addressCountry]
              .filter(Boolean)
              .join(", "),
          )
          .filter(Boolean)
          .join("; ") || undefined,
    };
  }
  throw structureError();
}

export const ashbyWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "ashby",
  descriptor: {
    sourceType: "ashby",
    label: "Ashby",
    catalogLabel: "Ashby company",
    customSourceOptionLabel: "Choose your own Ashby company",
    customSourceSearchText: "custom ashby url",
    customSourceInputLabel: "Ashby company or posting URL",
    customSourcePlaceholder: `${ORIGIN}/linear`,
    customSourceHelpText:
      "Paste an Ashby company board or job posting URL. Fetches up to 60 jobs, newest first.",
    emptyCatalogText: "No Ashby companies found.",
    fetchingLabel: "Fetching from Ashby...",
    invalidUrlMessage: "That is not a supported Ashby careers URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  parseCatalogSources(entries) {
    return parseCatalogSourcesLenient(entries, sourceSchema, (parsed) => {
      const { company } = parseUrl(parsed.ashbyUrl);
      return {
        id: `ashby:${company}`,
        label: parsed.label,
        sourceType: "ashby",
        careersUrl: boardUrl(company),
        cxsJobsUrl: null,
      };
    });
  },
  hydrateSelectedSource(source) {
    const { company } = parseUrl(source.careersUrl);
    return {
      ...source,
      label:
        source.label.trim() && source.label.trim() !== source.careersUrl.trim()
          ? source.label
          : company,
      careersUrl: boardUrl(company),
      cxsJobsUrl: null,
    };
  },
  async normalizeCustomSelection(input) {
    const { company } = parseUrl(input.careersUrl);
    await board(company, createBudgetSignal());
    return {
      label: resolveCustomLabel(input.label, input.careersUrl, company),
      careersUrl: boardUrl(company),
    };
  },
  async fetchJobs({ source, signal }) {
    const { company } = parseUrl(source.careersUrl);
    const all = await board(company, createBudgetSignal(signal));
    const jobs = [...new Map(all.map((job) => [job.id, job])).values()]
      .sort(
        (a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0),
      )
      .slice(0, MAX_JOBS);
    listedJobs.set(company, new Map(jobs.map((job) => [job.id, job])));
    return {
      total: all.length,
      fetched: jobs.length,
      jobs: jobs.map((job) => ({
        jobRef: postingUrl(company, job.id),
        source: `ashby:${company}`,
        sourceJobId: job.id,
        sourceType: "ashby",
        title: job.title,
        employer: source.label,
        jobUrl: postingUrl(company, job.id),
        applicationLink: `${postingUrl(company, job.id)}/application`,
        location: location(job),
        postedAt:
          job.publishedAt && Number.isFinite(Date.parse(job.publishedAt)) ? job.publishedAt : null,
      })),
    };
  },
  async fetchJobDetails(input) {
    const job = await details(input.source, input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: job.jobUrl,
      descriptionHtml: description(job),
    };
  },
  async prepareImportDraft(input) {
    const { company } = parseUrl(input.source.careersUrl);
    const job = await details(input.source, input.jobRef, input.signal);
    const source = `ashby:${company}`;
    return {
      source,
      sourceHost: "jobs.ashbyhq.com",
      draft: {
        source,
        sourceJobId: job.id,
        title: job.title,
        employer: input.source.label,
        jobUrl: job.jobUrl,
        applicationLink: job.applyUrl,
        location: location(job) ?? undefined,
        jobDescription:
          job.descriptionPlain?.trim() || convert(description(job), { wordwrap: false }),
        jobType: job.employmentType,
      },
    };
  },
};
