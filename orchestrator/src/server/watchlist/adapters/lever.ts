import { parseCatalogSourcesLenient, resolveCustomLabel } from "./common";
import { createBudgetSignal, fetchWatchlist } from "./http";
import { hasPlainHttpsAuthority, parseWatchlistUrl } from "./url";
import { badRequest, upstreamError } from "@infra/errors";
import { escapeHtml } from "@infra/html";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const jobSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]+$/),
  text: z.string().min(1),
  categories: z
    .object({
      location: z.string().optional(),
      allLocations: z.array(z.string()).optional(),
      team: z.string().optional(),
      commitment: z.string().optional(),
    })
    .optional(),
  createdAt: z.number().finite().nonnegative().max(8.64e15).optional(),
  hostedUrl: z.string().optional(),
  applyUrl: z.string().optional(),
  description: z.string().optional(),
  descriptionPlain: z.string().optional(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(),
  additional: z.string().optional(),
  additionalPlain: z.string().optional(),
});
type Job = z.infer<typeof jobSchema>;

// Explicitly global public ATS data only. No tenant selections, labels or private
// state are cached. Board + posting ID prevent collisions across companies/regions.
// Each board is replaced on its list fetch and bounded to 60 public postings per normalized selection.
const listedJobs = new Map<string, Map<string, Job>>();

export function parseLeverUrl(value: string) {
  const url = parseWatchlistUrl(value, "Invalid Lever careers URL.");
  const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9-]+)(?:\/apply)?)?\/?$/);
  if (
    !hasPlainHttpsAuthority(value) ||
    url.protocol !== "https:" ||
    !["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname) ||
    url.username ||
    url.password ||
    !match
  ) {
    throw badRequest("Use an HTTPS jobs.lever.co company or posting URL.");
  }
  const company = match[1];
  const filters = new URLSearchParams();
  for (const key of ["commitment", "department", "location", "team", "workplaceType"]) {
    for (const value of [
      ...new Set(
        url.searchParams
          .getAll(key)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].sort())
      filters.append(key, value);
  }
  const query = filters.size ? `?${filters}` : "";
  const baseUrl = `https://${url.hostname}/${company}`;
  return {
    company,
    baseUrl,
    query,
    careersUrl: `${baseUrl}${query}`,
    apiUrl: `https://${url.hostname === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${company}`,
    host: url.hostname,
    postingId: match[2],
  };
}
const board = parseLeverUrl;
type Board = ReturnType<typeof board>;
async function request(url: string, signal: AbortSignal): Promise<unknown> {
  return fetchWatchlist({
    url,
    signal,
    paceMs: 1_000,
    maxRetries: 3,
    retryAfterMaxMs: 25_000,
    backoffScheduleMs: [1000, 3000, 8000],
    formatHttpError: ({ status }) => upstreamError(`Lever returned HTTP ${status}.`),
    formatInvalidBodyError: () => upstreamError("Lever returned invalid JSON."),
  });
}
function postingUrl(b: Board, job: Job, apply = false): string {
  const fallback = `${b.baseUrl}/${job.id}${apply ? "/apply" : ""}`;
  const value = apply ? job.applyUrl : job.hostedUrl;
  if (!value) return fallback;
  try {
    const parsed = board(value);
    if (parsed.baseUrl === b.baseUrl && parsed.postingId === job.id) return value;
  } catch {
    /* Fall back to the pinned company posting URL. */
  }
  return fallback;
}
function location(job: Job) {
  return (
    [
      ...new Set(
        job.categories?.allLocations?.length
          ? job.categories.allLocations
          : [job.categories?.location].filter((x): x is string => !!x),
      ),
    ].join("; ") || null
  );
}
function description(job: Job) {
  return [
    job.description || (job.descriptionPlain ? `<p>${escapeHtml(job.descriptionPlain)}</p>` : ""),
    ...(job.lists ?? []).map((section) => `<h3>${escapeHtml(section.text)}</h3>${section.content}`),
    job.additional || (job.additionalPlain ? `<p>${escapeHtml(job.additionalPlain)}</p>` : ""),
  ]
    .filter(Boolean)
    .join("\n");
}
async function details(careersUrl: string, jobRef: string, signal?: AbortSignal) {
  const b = board(careersUrl);
  const ref = board(jobRef);
  if (ref.baseUrl !== b.baseUrl || !ref.postingId)
    throw badRequest("Lever posting must belong to the selected company.");
  signal?.throwIfAborted();
  let job = listedJobs.get(b.careersUrl)?.get(ref.postingId);
  if (!job) {
    const parsed = jobSchema.safeParse(
      await request(`${b.apiUrl}/${ref.postingId}?mode=json`, createBudgetSignal(signal)),
    );
    if (!parsed.success || parsed.data.id !== ref.postingId)
      throw upstreamError("Lever returned invalid posting data.");
    job = parsed.data;
  }
  return { b, job };
}

export const leverWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "lever",
  descriptor: {
    sourceType: "lever",
    label: "Lever",
    catalogLabel: "Lever company",
    customSourceOptionLabel: "Choose your own Lever company",
    customSourceSearchText: "custom lever url",
    customSourceInputLabel: "Lever company careers URL",
    customSourcePlaceholder: "https://jobs.lever.co/spotify",
    customSourceHelpText:
      "Paste a Lever company board or posting URL. Supports location, team, department, commitment and workplaceType filters (repeat a filter for OR). Fetches up to 60 jobs, newest first.",
    emptyCatalogText: "No Lever companies found.",
    fetchingLabel: "Fetching from Lever...",
    invalidUrlMessage: "That is not a supported Lever careers URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  parseCatalogSources(entries) {
    return parseCatalogSourcesLenient(entries, sourceSchema, (parsed) => {
      const b = board(parsed.careersUrl);
      return {
        id: `lever:${b.company}${b.query}`,
        label: parsed.label,
        careersUrl: b.careersUrl,
        sourceType: "lever",
        cxsJobsUrl: null,
      };
    });
  },
  hydrateSelectedSource(source) {
    const b = board(source.careersUrl);
    return {
      ...source,
      label: source.label.trim() || b.company,
      careersUrl: b.careersUrl,
      cxsJobsUrl: null,
    };
  },
  async normalizeCustomSelection(input) {
    const b = board(input.careersUrl);
    const parsed = z
      .array(jobSchema)
      .safeParse(
        await request(
          `${b.apiUrl}?mode=json&${b.query.slice(1)}${b.query ? "&" : ""}limit=1`,
          createBudgetSignal(),
        ),
      );
    if (!parsed.success) throw upstreamError("Lever returned invalid board data.");
    return {
      label: resolveCustomLabel(input.label, input.careersUrl, b.company),
      careersUrl: b.careersUrl,
    };
  },
  async fetchJobs(input) {
    const b = board(input.source.careersUrl);
    // No limit parameter: Lever's default ordering is alphabetical. Retrieve the
    // public board once, then sort by creation time before applying the cap.
    const parsed = z
      .array(jobSchema)
      .safeParse(
        await request(
          `${b.apiUrl}?mode=json${b.query ? `&${b.query.slice(1)}` : ""}`,
          createBudgetSignal(input.signal),
        ),
      );
    if (!parsed.success) throw upstreamError("Lever returned invalid board data.");
    const all = [...new Map(parsed.data.map((job) => [job.id, job])).values()];
    const selected = all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 60);
    listedJobs.set(b.careersUrl, new Map(selected.map((job) => [job.id, job])));
    const jobs = selected.map((job) => ({
      jobRef: `${b.baseUrl}/${job.id}`,
      source: `lever:${b.company}`,
      sourceJobId: job.id,
      sourceType: "lever",
      title: job.text,
      employer: input.source.label,
      jobUrl: postingUrl(b, job),
      applicationLink: postingUrl(b, job, true),
      location: location(job),
      postedAt: job.createdAt === undefined ? null : new Date(job.createdAt).toISOString(),
    }));
    return { total: all.length, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    const { b, job } = await details(input.source.careersUrl, input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: postingUrl(b, job),
      descriptionHtml: description(job),
    };
  },
  async prepareImportDraft(input) {
    const { b, job } = await details(input.source.careersUrl, input.jobRef, input.signal);
    const source = `lever:${b.company}`;
    return {
      source,
      sourceHost: b.host,
      draft: {
        source,
        sourceJobId: job.id,
        title: job.text,
        employer: input.source.label,
        jobUrl: postingUrl(b, job),
        applicationLink: postingUrl(b, job, true),
        location: location(job) ?? undefined,
        jobDescription: convert(description(job), { wordwrap: false }),
        jobType: job.categories?.commitment,
      },
    };
  },
};
