import {
  getFreshMapEntry,
  parseCatalogSourcesLenient,
  resolveCustomLabel,
  setBoundedMapEntry,
} from "./common";
import { createBudgetSignal, fetchWatchlist } from "./http";
import { hasPlainHttpsAuthority, parseWatchlistUrl } from "./url";
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

export function parseSmartRecruitersUrl(value: string) {
  const url = parseWatchlistUrl(value, "Invalid SmartRecruiters URL.");
  const match = url.pathname.match(
    /^\/([a-z0-9][a-z0-9_-]{0,199})(?:\/\d+(?:-[^/]+)?(?:\/apply)?)?\/?$/i,
  );
  if (
    url.origin !== ORIGIN ||
    /\/(?:\.|%2e){1,2}(?:\/|[?#]|$)/i.test(value) ||
    !hasPlainHttpsAuthority(value) ||
    !match
  )
    throw badRequest(
      "Use an HTTPS jobs.smartrecruiters.com company or posting URL without a port or userinfo.",
    );
  return { company: match[1], careersUrl: `${ORIGIN}/${match[1]}` };
}
const board = parseSmartRecruitersUrl;
async function request(url: string, signal: AbortSignal): Promise<unknown> {
  return fetchWatchlist({
    url,
    signal,
    maxRetries: 3,
    failFastRetryAfterMs: 10_000,
    backoffScheduleMs: [1000, 3000, 8000],
    formatHttpError: ({ status }) => upstreamError(`SmartRecruiters returned HTTP ${status}.`),
    formatInvalidBodyError: () => upstreamError("SmartRecruiters returned invalid JSON."),
  });
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
  const signal = createBudgetSignal(input.signal);
  signal.throwIfAborted();
  const cacheKey = `${company.toLowerCase()}:${id}`;
  const cached = getFreshMapEntry(cache, cacheKey);
  let job = cached?.job;
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
  setBoundedMapEntry(cache, cacheKey, { job, expires: Date.now() + 15 * 60_000 }, 200);
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
  parseCatalogSources(entries) {
    return parseCatalogSourcesLenient(entries, sourceSchema, (parsed) => {
      const result = board(parsed.careersUrl);
      return {
        id: key(result.company),
        label: parsed.label,
        sourceType: "smartrecruiters",
        careersUrl: result.careersUrl,
        cxsJobsUrl: null,
      };
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
      await request(`${API}/${result.company}/postings?limit=1&offset=0`, createBudgetSignal()),
    );
    for (const job of list.content) checkCompany(job, result.company);
    return {
      careersUrl: `${ORIGIN}/${list.content[0]?.company.identifier || result.company}`,
      label: resolveCustomLabel(
        input.label,
        input.careersUrl,
        list.content[0]?.company.name || result.company,
      ),
    };
  },
  async fetchJobs(input) {
    const { company } = board(input.source.careersUrl);
    const signal = createBudgetSignal(input.signal);
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
