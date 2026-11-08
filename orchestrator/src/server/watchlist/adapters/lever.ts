import { setTimeout as delay } from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
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
  lists: z
    .array(z.object({ text: z.string(), content: z.string() }))
    .optional(),
  additional: z.string().optional(),
  additionalPlain: z.string().optional(),
});
type Job = z.infer<typeof jobSchema>;

// Explicitly global public ATS data only. No tenant selections, labels or private
// state are cached. Board + posting ID prevent collisions across companies/regions.
// Each board is replaced on its list fetch and bounded to 60 public postings per normalized selection.
const listedJobs = new Map<string, Map<string, Job>>();
// Public host-level crawl pacing, independent of tenants and company selections.
// At most two keys: the pinned global and EU API hosts.
const nextRequestAt = new Map<string, number>();

function board(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid Lever careers URL.");
  }
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  const match = url.pathname.match(
    /^\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9-]+)(?:\/apply)?)?\/?$/,
  );
  if (
    !authority ||
    authority.includes(":") ||
    authority.includes("@") ||
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
  for (const key of [
    "commitment",
    "department",
    "location",
    "team",
    "workplaceType",
  ]) {
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
type Board = ReturnType<typeof board>;
function budget(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function request(url: string, signal: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    const host = new URL(url).hostname;
    const now = Date.now();
    const start = Math.max(now, nextRequestAt.get(host) ?? 0);
    nextRequestAt.set(host, start + 1000);
    if (start > now) await delay(start - now, undefined, { signal });
    signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect: "error" });
    if (response.status === 429 && attempt < 3) {
      const header = response.headers.get("retry-after");
      const seconds = header === null ? NaN : Number(header);
      const retryMs = Number.isFinite(seconds)
        ? seconds * 1000
        : header
          ? Date.parse(header) - Date.now()
          : NaN;
      await response.body?.cancel();
      await delay(
        Number.isFinite(retryMs)
          ? Math.min(25_000, Math.max(0, retryMs))
          : [1000, 3000, 8000][attempt],
        undefined,
        { signal },
      );
      continue;
    }
    if (!response.ok)
      throw upstreamError(`Lever returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      signal.throwIfAborted();
      throw upstreamError("Lever returned invalid JSON.");
    }
  }
  throw upstreamError("Lever retry limit exceeded.");
}
function postingUrl(b: Board, job: Job, apply = false): string {
  const fallback = `${b.baseUrl}/${job.id}${apply ? "/apply" : ""}`;
  const value = apply ? job.applyUrl : job.hostedUrl;
  if (!value) return fallback;
  try {
    const parsed = board(value);
    if (parsed.baseUrl === b.baseUrl && parsed.postingId === job.id)
      return value;
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
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function description(job: Job) {
  return [
    job.description ||
      (job.descriptionPlain
        ? `<p>${escapeHtml(job.descriptionPlain)}</p>`
        : ""),
    ...(job.lists ?? []).map(
      (section) => `<h3>${escapeHtml(section.text)}</h3>${section.content}`,
    ),
    job.additional ||
      (job.additionalPlain ? `<p>${escapeHtml(job.additionalPlain)}</p>` : ""),
  ]
    .filter(Boolean)
    .join("\n");
}
async function details(
  careersUrl: string,
  jobRef: string,
  signal?: AbortSignal,
) {
  const b = board(careersUrl);
  const ref = board(jobRef);
  if (ref.baseUrl !== b.baseUrl || !ref.postingId)
    throw badRequest("Lever posting must belong to the selected company.");
  signal?.throwIfAborted();
  let job = listedJobs.get(b.careersUrl)?.get(ref.postingId);
  if (!job) {
    const parsed = jobSchema.safeParse(
      await request(`${b.apiUrl}/${ref.postingId}?mode=json`, budget(signal)),
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
  catalogSchema: sourceSchema,
  parseCatalogSources(entries) {
    return entries.flatMap((entry) => {
      const parsed = sourceSchema.safeParse(entry);
      if (!parsed.success) return [];
      try {
        const b = board(parsed.data.careersUrl);
        return [
          {
            id: `lever:${b.company}${b.query}`,
            label: parsed.data.label,
            careersUrl: b.careersUrl,
            sourceType: "lever",
            cxsJobsUrl: null,
          },
        ];
      } catch {
        return [];
      }
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
          budget(),
        ),
      );
    if (!parsed.success)
      throw upstreamError("Lever returned invalid board data.");
    return {
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : b.company,
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
          budget(input.signal),
        ),
      );
    if (!parsed.success)
      throw upstreamError("Lever returned invalid board data.");
    const all = [...new Map(parsed.data.map((job) => [job.id, job])).values()];
    const selected = all
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 60);
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
      postedAt:
        job.createdAt === undefined
          ? null
          : new Date(job.createdAt).toISOString(),
    }));
    return { total: all.length, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    const { b, job } = await details(
      input.source.careersUrl,
      input.jobRef,
      input.signal,
    );
    return {
      jobRef: input.jobRef,
      jobUrl: postingUrl(b, job),
      descriptionHtml: description(job),
    };
  },
  async prepareImportDraft(input) {
    const { b, job } = await details(
      input.source.careersUrl,
      input.jobRef,
      input.signal,
    );
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
