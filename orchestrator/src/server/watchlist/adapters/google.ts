import { setTimeout as delay } from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const ORIGIN = "https://www.google.com";
const PATH = "/about/careers/applications/jobs/results/";
const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const htmlSchema = z.tuple([z.null(), z.string()]);
const jobSchema = z
  .tuple([
    z.string().regex(/^\d+$/),
    z.string().min(1),
    z.string(),
    htmlSchema,
    htmlSchema,
    z.unknown(),
    z.unknown(),
    z.string().min(1),
    z.unknown(),
    z.array(z.tuple([z.string().min(1)]).rest(z.unknown())),
    htmlSchema,
  ])
  .rest(z.unknown());
type Job = z.infer<typeof jobSchema>;

// Explicitly global: these are public Google postings keyed by Google's stable ID,
// never tenant selections, filters, profile data, or import/workspace state.
// Replaced per search and bounded to the same 60 rows returned to the caller.
let listedJobs = new Map<string, Job>();

function hasDescription(job: Job): boolean {
  return [job[3][1], job[4][1], job[10][1]].some((text) => text.trim());
}

function trustedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid Google careers URL.");
  }
  // URL normalizes :443 away, so also reject explicit ports in the authority.
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    !authority ||
    authority.includes(":") ||
    authority.includes("@")
  ) {
    throw badRequest("Use an HTTPS careers URL on www.google.com without userinfo or a port.");
  }
  return url;
}

export function searchUrl(value: string): URL {
  const input = trustedUrl(value);
  if (input.pathname !== PATH && input.pathname !== PATH.slice(0, -1)) {
    throw badRequest("Use a Google careers jobs/results/ search URL.");
  }
  const url = new URL(PATH, ORIGIN);
  for (const key of ["q", "location", "target_level", "employment_type", "degree"]) {
    for (const value of input.searchParams.getAll(key)) url.searchParams.append(key, value);
  }
  url.searchParams.set("sort_by", "date");
  url.searchParams.sort();
  return url;
}

function requestedId(value: string): string {
  const url = trustedUrl(value);
  const match = url.pathname.match(
    /^\/about\/careers\/applications\/jobs\/results\/(\d+)(?:-[a-z0-9-]+)?\/?$/,
  );
  if (!match) throw badRequest("Invalid Google job detail URL.");
  return match[1];
}

function callSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function pageHtml(url: URL, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const response = await fetch(url.toString(), { signal, redirect: "manual" });
    if (response.status === 429 && attempt < 3) {
      await response.body?.cancel();
      await delay(250 * 2 ** attempt, undefined, { signal });
      continue;
    }
    if (!response.ok) throw upstreamError(`Google careers returned HTTP ${response.status}.`);
    return response.text();
  }
  throw upstreamError("Google careers retry limit exceeded.");
}

function structureError(key: string): Error {
  return upstreamError(
    `Google careers ${key} data is invalid or missing; the page structure may have changed.`,
  );
}

// The observed array literal is valid JSON. Scan balanced brackets while respecting
// JSON strings/escapes; never execute JavaScript or repair untrusted expressions.
export function callbackData(html: string, key: "ds:0" | "ds:1"): unknown {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const content = script[1];
    const header = content.match(
      /^\s*AF_initDataCallback\(\{\s*key:\s*['"](ds:\d+)['"][\s\S]*?\bdata:\s*/,
    );
    if (!header || header[1] !== key) continue;
    const start = header[0].length;
    if (content[start] !== "[") throw structureError(key);
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < content.length; i += 1) {
      const char = content[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "[") depth += 1;
      else if (char === "]" && --depth === 0) {
        try {
          return JSON.parse(content.slice(start, i + 1));
        } catch {
          throw structureError(key);
        }
      }
    }
    throw structureError(key);
  }
  throw structureError(key);
}

function jobUrl(job: Job): string {
  // Google's links lowercase titles, remove punctuation and join words with '-'.
  const slug = job[1]
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
  return `${ORIGIN}${PATH}${job[0]}${slug ? `-${slug}` : ""}`;
}

function location(job: Job): string | null {
  return [...new Set(job[9].map((item) => item[0]))].join("; ") || null;
}

async function details(jobRef: string, signal?: AbortSignal) {
  const id = requestedId(jobRef);
  signal?.throwIfAborted();
  let job = listedJobs.get(id);
  if (!job || !hasDescription(job)) {
    const html = await pageHtml(new URL(`${PATH}${id}`, ORIGIN), callSignal(signal));
    // Only the observed primary-job envelope is supported; ds:1 is related jobs.
    const data = callbackData(html, "ds:0");
    const parsed = jobSchema.safeParse(Array.isArray(data) ? data[0] : null);
    if (!parsed.success || parsed.data[0] !== id)
      throw upstreamError(
        "Google careers detail structure may have changed or returned a different job than requested.",
      );
    job = parsed.data;
  }
  const descriptionHtml = `<h3>About the job</h3>${job[10][1]}\n<h3>Qualifications</h3>${job[4][1]}\n<h3>Responsibilities</h3>${job[3][1]}`;
  if (!hasDescription(job)) throw structureError("detail description");
  return { job, descriptionHtml };
}

export const googleWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "google",
  descriptor: {
    sourceType: "google",
    label: "Google",
    catalogLabel: "Google careers",
    customSourceOptionLabel: "Custom Google search URL",
    customSourceSearchText: "custom google url",
    customSourceInputLabel: "Google careers search URL",
    customSourcePlaceholder: `${ORIGIN}${PATH}?q=software+engineer`,
    customSourceHelpText:
      "Paste a filtered Google careers search URL. Fetches up to 60 jobs, sorted newest first.",
    emptyCatalogText: "No Google sources found.",
    fetchingLabel: "Fetching from Google...",
    invalidUrlMessage: "That is not a supported Google careers search URL.",
    supportsCustomSource: true,
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
            id: "google:google",
            label: parsed.data.label,
            sourceType: "google",
            careersUrl: searchUrl(parsed.data.careersUrl).toString(),
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
      label: source.label.trim() || "Google",
      careersUrl: searchUrl(source.careersUrl).toString(),
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    return {
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : "Google",
      careersUrl: searchUrl(input.careersUrl).toString(),
    };
  },
  async fetchJobs(input) {
    listedJobs = new Map();
    const url = searchUrl(input.source.careersUrl);
    const signal = callSignal(input.signal);
    const collected = new Map<string, Job>();
    let total = 0;
    // ponytail/decision: Google robots.txt disallows ?page= on results; overridden by the owner for low-volume personal use (<=3 requests per run). Remove paging to restore compliance.
    for (let page = 1; page <= 3; page += 1) {
      url.searchParams.set("page", String(page));
      const data = callbackData(await pageHtml(url, signal), "ds:1");
      const parsed = z
        .tuple([z.array(jobSchema).nullable(), z.unknown(), z.number().int().nonnegative()])
        .rest(z.unknown())
        .safeParse(data);
      if (
        !parsed.success ||
        (page === 1 && parsed.data[2] > 0 && !parsed.data[0]?.length) ||
        (parsed.data[2] === 0 && parsed.data[0]?.length)
      )
        throw structureError("ds:1 search");
      if (page === 1) total = parsed.data[2];
      const rows = parsed.data[0] ?? [];
      for (const job of rows.slice(0, 20)) collected.set(job[0], job);
      if (collected.size >= 60 || page * 20 >= total || rows.length < 20) break;
    }
    const selected = [...collected.values()].slice(0, 60);
    listedJobs = new Map(selected.map((job) => [job[0], job]));
    const jobs = selected.map((job) => ({
      jobRef: jobUrl(job),
      source: "google",
      sourceJobId: job[0],
      sourceType: "google",
      title: job[1],
      employer: job[7],
      jobUrl: jobUrl(job),
      applicationLink: jobUrl(job),
      location: location(job),
      // Indices 12–14 contain timestamps, but their posted/updated semantics are
      // undocumented and no datePosted metadata is present. Preserve server order.
      postedAt: null,
    }));
    return { total, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    searchUrl(input.source.careersUrl);
    const result = await details(input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: jobUrl(result.job),
      descriptionHtml: result.descriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    searchUrl(input.source.careersUrl);
    const { job, descriptionHtml } = await details(input.jobRef, input.signal);
    return {
      source: "google",
      sourceHost: "www.google.com",
      draft: {
        source: "google",
        sourceJobId: job[0],
        title: job[1],
        employer: job[7],
        jobUrl: jobUrl(job),
        applicationLink: jobUrl(job),
        location: location(job) ?? undefined,
        jobDescription: convert(descriptionHtml, { wordwrap: false }),
      },
    };
  },
};
