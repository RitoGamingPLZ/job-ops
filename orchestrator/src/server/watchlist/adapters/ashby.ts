import timers from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
import type { WatchlistSelectedSource } from "@shared/types";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

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

function parseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid Ashby careers URL.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  const match = url.pathname.match(
    /^\/([a-zA-Z0-9][a-zA-Z0-9_-]*)(?:\/([a-zA-Z0-9-]+)(?:\/application)?)?\/?$/,
  );
  if (
    url.origin !== ORIGIN ||
    !authority ||
    /[:@]/.test(authority) ||
    url.username ||
    url.password ||
    !match
  )
    throw badRequest("Use an HTTPS jobs.ashbyhq.com company or posting URL.");
  return { company: match[1].toLowerCase(), id: match[2] };
}
function boardUrl(company: string) {
  return `${ORIGIN}/${company}`;
}
function postingUrl(company: string, id: string) {
  return `${boardUrl(company)}/${id}`;
}
function callSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function request(url: string, signal: AbortSignal) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "error" });
    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter?.trim() ? Number(retryAfter) : Number.NaN;
      const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
      const wait = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Number.isFinite(date)
          ? Math.max(0, date - Date.now())
          : [1000, 3000, 8000][attempt];
      await response.body?.cancel();
      await timers.setTimeout(Math.min(wait, 25_000), undefined, { signal });
      continue;
    }
    if (!response.ok)
      throw upstreamError(`Ashby returned HTTP ${response.status}.`);
    return response;
  }
  throw upstreamError("Ashby retry limit exceeded.");
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
        [
          job.location,
          ...(job.secondaryLocations ?? []).map((item) => item.location),
        ].filter(Boolean),
      ),
    ].join("; ") || (job.isRemote ? "Remote" : null)
  );
}
function description(job: Job) {
  if (job.descriptionHtml?.trim()) return job.descriptionHtml;
  return `<p>${(job.descriptionPlain ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`;
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
  const response = await request(
    postingUrl(company, ref.id),
    callSignal(signal),
  );
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
  for (const script of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(script[1]);
    } catch {
      continue;
    }
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
            [
              address.addressLocality,
              address.addressRegion,
              address.addressCountry,
            ]
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
      "Paste an Ashby company board or job posting URL. Fetches up to 40 jobs, newest first.",
    emptyCatalogText: "No Ashby companies found.",
    fetchingLabel: "Fetching from Ashby...",
    invalidUrlMessage: "That is not a supported Ashby careers URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: sourceSchema,
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      const parsed = sourceSchema.safeParse(entry);
      if (!parsed.success) return [];
      try {
        const { company } = parseUrl(parsed.data.ashbyUrl);
        return [
          {
            id: `ashby:${company}`,
            label: parsed.data.label,
            sourceType: "ashby",
            careersUrl: boardUrl(company),
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
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
    await board(company, callSignal());
    return {
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : company,
      careersUrl: boardUrl(company),
    };
  },
  async fetchJobs({ source, signal }) {
    const { company } = parseUrl(source.careersUrl);
    const all = await board(company, callSignal(signal));
    const jobs = [...new Map(all.map((job) => [job.id, job])).values()]
      .sort(
        (a, b) =>
          (Date.parse(b.publishedAt ?? "") || 0) -
          (Date.parse(a.publishedAt ?? "") || 0),
      )
      .slice(0, 40);
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
          job.publishedAt && Number.isFinite(Date.parse(job.publishedAt))
            ? job.publishedAt
            : null,
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
          job.descriptionPlain?.trim() ||
          convert(description(job), { wordwrap: false }),
        jobType: job.employmentType,
      },
    };
  },
};
