import { setTimeout as delay } from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
import { escapeHtml } from "@infra/html";
import type { WatchlistSelectedSource } from "@shared/types";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const MAX_JOBS = 60;
const ORIGIN = "https://jobs.smartrecruiters.com";
const API = "https://api.smartrecruiters.com/v1/companies";
const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const jobSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  releasedDate: z.string().datetime().optional(),
  company: z.object({ identifier: z.string(), name: z.string() }),
  location: z
    .object({
      fullLocation: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      remote: z.boolean().optional(),
      hybrid: z.boolean().optional(),
    })
    .optional(),
});
const listSchema = z.object({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  totalFound: z.number().int().nonnegative(),
  content: z.array(z.unknown()),
});
const detailSchema = jobSchema.extend({
  jobAd: z.object({
    sections: z.record(
      z.string(),
      z.object({
        title: z.string().optional(),
        text: z.string().optional(),
      }),
    ),
  }),
});
type Job = z.infer<typeof jobSchema>;
type Detail = z.infer<typeof detailSchema>;

// Explicitly global public ATS data only; no tenant selections or workspace data.
// Company + posting ID prevents collisions across companies and tenants.
const cache = new Map<string, { job: Detail; expires: number }>();

function board(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid SmartRecruiters URL.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  const match = url.pathname.match(
    /^\/([a-z0-9][a-z0-9_-]{0,199})(?:\/\d+(?:-[^/]+)?(?:\/apply)?)?\/?$/i,
  );
  if (
    url.origin !== ORIGIN ||
    /\/(?:\.|%2e){1,2}(?:\/|[?#]|$)/i.test(value) ||
    !authority ||
    /[:@]/.test(authority) ||
    !match
  )
    throw badRequest(
      "Use an HTTPS jobs.smartrecruiters.com company or posting URL without a port or userinfo.",
    );
  return { company: match[1], careersUrl: `${ORIGIN}/${match[1]}` };
}
function signalFor(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function request(url: string, signal: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "manual" });
    if (response.status === 429 && attempt < 3) {
      const retry = response.headers.get("retry-after");
      const seconds = retry === null ? NaN : Number(retry);
      const date = retry === null ? NaN : Date.parse(retry);
      const wait = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Number.isFinite(date)
          ? Math.max(0, date - Date.now())
          : [1000, 3000, 8000][attempt];
      await response.body?.cancel();
      if (wait > 10_000) throw upstreamError("SmartRecruiters returned HTTP 429.");
      await delay(wait, undefined, { signal });
      continue;
    }
    if (!response.ok) throw upstreamError(`SmartRecruiters returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw upstreamError("SmartRecruiters returned invalid JSON.");
    }
  }
  throw upstreamError("SmartRecruiters retry limit exceeded.");
}
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw upstreamError("SmartRecruiters response structure may have changed.");
  return result.data;
}
function parseList(data: unknown) {
  const page = parse(listSchema, data);
  const content = page.content.flatMap((row) => {
    const result = jobSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });
  if (page.content.length && !content.length)
    throw upstreamError("SmartRecruiters response structure may have changed.");
  return { ...page, content };
}
function key(company: string) {
  return `smartrecruiters:${company.toLowerCase()}`;
}
function jobUrl(company: string, job: Job) {
  return `${ORIGIN}/${company}/${job.id}`;
}
function location(job: Job) {
  const loc = job.location;
  const text =
    loc?.fullLocation || [loc?.city, loc?.region, loc?.country].filter(Boolean).join(", ");
  return (
    [text, loc?.remote ? "Remote" : loc?.hybrid ? "Hybrid" : null].filter(Boolean).join("; ") ||
    null
  );
}
function checkCompany(job: Job, company: string) {
  if (job.company.identifier.toLowerCase() !== company.toLowerCase())
    throw upstreamError("SmartRecruiters returned a different company than requested.");
}
async function details(input: {
  source: WatchlistSelectedSource;
  jobRef: string;
  signal?: AbortSignal;
}) {
  const { company } = board(input.source.careersUrl);
  const ref = board(input.jobRef);
  const id = new URL(input.jobRef).pathname.split("/")[2]?.match(/^(\d+)(?:-|$)/)?.[1];
  if (ref.company.toLowerCase() !== company.toLowerCase() || !id)
    throw badRequest("The SmartRecruiters posting must belong to the selected company.");
  const signal = signalFor(input.signal);
  signal.throwIfAborted();
  const cacheKey = `${company.toLowerCase()}:${id}`;
  const cached = cache.get(cacheKey);
  let job = cached && cached.expires > Date.now() ? cached.job : undefined;
  if (!job) {
    job = parse(detailSchema, await request(`${API}/${company}/postings/${id}`, signal));
    checkCompany(job, company);
    if (job.id !== id)
      throw upstreamError("SmartRecruiters returned a different posting than requested.");
  }
  const descriptionHtml = Object.values(job.jobAd.sections)
    .filter((section) => section.text?.trim())
    .map(
      (section) => `${section.title ? `<h3>${escapeHtml(section.title)}</h3>` : ""}${section.text}`,
    )
    .join("\n");
  if (!descriptionHtml) throw upstreamError("SmartRecruiters posting description is missing.");
  cache.delete(cacheKey);
  cache.set(cacheKey, { job, expires: Date.now() + 15 * 60_000 });
  while (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return { job, company, descriptionHtml };
}

export const smartrecruitersWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "smartrecruiters",
  descriptor: {
    sourceType: "smartrecruiters",
    label: "SmartRecruiters",
    catalogLabel: "SmartRecruiters company",
    customSourceOptionLabel: "Choose your own SmartRecruiters company",
    customSourceSearchText: "custom smartrecruiters url",
    customSourceInputLabel: "SmartRecruiters company or posting URL",
    customSourcePlaceholder: `${ORIGIN}/ServiceNow`,
    customSourceHelpText:
      "Paste a SmartRecruiters company, job or apply link. Fetches the newest 60 postings.",
    emptyCatalogText: "No SmartRecruiters companies found.",
    fetchingLabel: "Fetching from SmartRecruiters...",
    invalidUrlMessage: "That is not a supported SmartRecruiters company URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: sourceSchema,
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      const parsed = sourceSchema.safeParse(entry);
      if (!parsed.success) return [];
      try {
        const result = board(parsed.data.careersUrl);
        return [
          {
            id: key(result.company),
            label: parsed.data.label,
            sourceType: "smartrecruiters",
            careersUrl: result.careersUrl,
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
    });
  },
  hydrateSelectedSource(source) {
    const result = board(source.careersUrl);
    return {
      ...source,
      careersUrl: result.careersUrl,
      label: source.label.trim() || result.company,
      cxsJobsUrl: null,
    };
  },
  async normalizeCustomSelection(input) {
    const result = board(input.careersUrl);
    const list = parseList(
      await request(`${API}/${result.company}/postings?limit=1&offset=0`, signalFor()),
    );
    for (const job of list.content) checkCompany(job, result.company);
    return {
      careersUrl: `${ORIGIN}/${list.content[0]?.company.identifier || result.company}`,
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : list.content[0]?.company.name || result.company,
    };
  },
  async fetchJobs(input) {
    const { company } = board(input.source.careersUrl);
    const signal = signalFor(input.signal);
    const collected = new Map<string, Job>();
    let offset = 0;
    let total = 0;
    let pages = 0;
    // ponytail: newest 60 of the first 500; bound sequential list requests.
    do {
      const page = parseList(
        await request(`${API}/${company}/postings?limit=100&offset=${offset}`, signal),
      );
      total = page.totalFound;
      if (page.offset !== offset || (!page.content.length && offset < total))
        throw upstreamError("SmartRecruiters pagination did not advance.");
      for (const job of page.content) {
        checkCompany(job, company);
        collected.set(job.id, job);
      }
      offset += page.limit;
      pages++;
    } while (offset < total && pages < 5);
    const selected = [...collected.values()]
      .sort((a, b) => (b.releasedDate || "").localeCompare(a.releasedDate || ""))
      .slice(0, MAX_JOBS);
    const jobs = selected.map((job) => ({
      jobRef: jobUrl(company, job),
      source: key(company),
      sourceJobId: job.id,
      sourceType: "smartrecruiters",
      title: job.name,
      employer: job.company.name,
      jobUrl: jobUrl(company, job),
      applicationLink: jobUrl(company, job),
      location: location(job),
      postedAt: job.releasedDate ?? null,
    }));
    return { total, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    const { job, company, descriptionHtml } = await details(input);
    return {
      jobRef: input.jobRef,
      jobUrl: jobUrl(company, job),
      descriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const { job, company, descriptionHtml } = await details(input);
    return {
      source: key(company),
      sourceHost: "jobs.smartrecruiters.com",
      draft: {
        source: key(company),
        sourceJobId: job.id,
        title: job.name,
        employer: job.company.name,
        jobUrl: jobUrl(company, job),
        applicationLink: jobUrl(company, job),
        location: location(job) ?? undefined,
        jobDescription: convert(descriptionHtml, { wordwrap: false }),
      },
    };
  },
};
