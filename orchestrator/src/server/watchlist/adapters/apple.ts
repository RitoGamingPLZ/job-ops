import { setTimeout as delay } from "node:timers/promises";
import { badRequest, upstreamError } from "@infra/errors";
import { escapeHtmlText } from "@infra/html";
import { convert } from "html-to-text";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const MAX_JOBS = 60;
const ORIGIN = "https://jobs.apple.com";
const sourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  careersUrl: z.string().trim().url().max(2000),
});
const locationSchema = z.object({
  city: z.string().nullish(),
  stateProvince: z.string().nullish(),
  countryName: z.string().nullish(),
  name: z.string().nullish(),
});
const jobSchema = z.object({
  positionId: z.string().regex(/^[\w-]+$/),
  postingTitle: z.string().min(1),
  transformedPostingTitle: z.string().min(1),
  locations: z.array(locationSchema),
  postDateInGMT: z.string().nullish(),
});
const searchSchema = z.object({
  searchResults: z.array(jobSchema),
  totalRecords: z.number().int().nonnegative(),
});
const detailSchema = jobSchema.extend({
  description: z.string().trim().min(1),
  jobSummary: z.string().nullish(),
  minimumQualifications: z.string().nullish(),
  preferredQualifications: z.string().nullish(),
  keyQualifications: z.string().nullish(),
  educationAndExperience: z.string().nullish(),
  additionalRequirements: z.string().nullish(),
});

function searchUrl(value: string): URL {
  const url = trustedUrl(value);
  if (!/^\/en-us\/search\/?$/.test(url.pathname)) {
    throw badRequest("Use an Apple careers search URL (jobs.apple.com/en-us/search).");
  }
  url.pathname = "/en-us/search";
  url.hash = "";
  url.searchParams.set("page", "1");
  url.searchParams.set("sort", "newest");
  url.searchParams.sort();
  return url;
}

function trustedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("Invalid Apple careers URL.");
  }
  if (url.origin !== ORIGIN || url.username || url.password) {
    throw badRequest("Use an HTTPS careers URL on jobs.apple.com.");
  }
  return url;
}

function detailUrl(value: string): URL {
  const url = trustedUrl(value);
  if (!/^\/en-us\/details\/[\w-]+\/[^/]+\/?$/.test(url.pathname)) {
    throw badRequest("Invalid Apple job detail URL.");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function callSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(25_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function hydration(url: URL, signal: AbortSignal) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const response = await fetch(url.toString(), { signal, redirect: "error" });
    if (response.status === 429 && attempt < 3) {
      await response.body?.cancel();
      await delay(250 * 2 ** attempt, undefined, { signal });
      continue;
    }
    if (!response.ok) {
      throw upstreamError(`Apple careers returned HTTP ${response.status}.`);
    }
    const html = await response.text();
    // Capture a JSON string literal, never execute Apple's JavaScript.
    const match = html.match(
      /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(\s*("(?:\\[\s\S]|[^"\\])*")\s*\)/,
    );
    if (!match) {
      throw upstreamError(
        "Apple careers hydration data is missing; the page structure may have changed.",
      );
    }
    try {
      const data = JSON.parse(JSON.parse(match[1]));
      return z.object({ loaderData: z.record(z.unknown()) }).parse(data).loaderData;
    } catch {
      throw upstreamError(
        "Apple careers hydration data is invalid; the page structure may have changed.",
      );
    }
  }
  throw upstreamError("Apple careers retry limit exceeded.");
}

function jobUrl(job: z.infer<typeof jobSchema>): string {
  return `${ORIGIN}/en-us/details/${job.positionId}/${encodeURIComponent(job.transformedPostingTitle)}`;
}

function locationText(locations: z.infer<typeof locationSchema>[]): string | null {
  const values = locations
    .map((location) => {
      const parts = [location.city, location.stateProvince, location.countryName].filter(Boolean);
      return [...new Set(parts)].join(", ") || location.name || "";
    })
    .filter(Boolean);
  return [...new Set(values)].join("; ") || null;
}

async function details(jobRef: string, signal?: AbortSignal) {
  const url = detailUrl(jobRef);
  const data = await hydration(url, callSignal(signal));
  const parsed = z.object({ jobsData: detailSchema }).safeParse(data.jobDetails);
  if (!parsed.success) {
    throw upstreamError(
      "Apple careers loaderData.jobDetails.jobsData is invalid; the detail structure may have changed.",
    );
  }
  const job = parsed.data.jobsData;
  if (job.positionId !== url.pathname.split("/")[3]) {
    throw upstreamError("Apple careers returned a different job than requested.");
  }
  // Apple supplies plain text; escape it before exposing it as descriptionHtml.
  const sections = [
    ["Summary", job.jobSummary],
    ["Description", job.description],
    ["Minimum Qualifications", job.minimumQualifications],
    ["Preferred Qualifications", job.preferredQualifications],
    ["Key Qualifications", job.keyQualifications],
    ["Education & Experience", job.educationAndExperience],
    ["Additional Requirements", job.additionalRequirements],
  ];
  const descriptionHtml = sections
    .filter(([, text]) => text?.trim())
    .map(
      ([title, text]) =>
        `<h3>${escapeHtmlText(title ?? "")}</h3><p>${escapeHtmlText(text ?? "").replace(/\r?\n/g, "<br>")}</p>`,
    )
    .join("\n");
  return { job, jobUrl: url.toString(), descriptionHtml };
}

export const appleWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "apple",
  descriptor: {
    sourceType: "apple",
    label: "Apple",
    catalogLabel: "Apple careers",
    customSourceOptionLabel: "Custom Apple search URL",
    customSourceSearchText: "custom apple url",
    customSourceInputLabel: "Apple careers search URL",
    customSourcePlaceholder: "https://jobs.apple.com/en-us/search?search=engineer",
    customSourceHelpText:
      "Paste a filtered Apple search URL. Location filters use Apple's location slugs. Fetches up to 60 newest jobs.",
    emptyCatalogText: "No Apple sources found.",
    fetchingLabel: "Fetching from Apple...",
    invalidUrlMessage: "That is not a supported Apple careers search URL.",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: sourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(sourceSchema)
      .parse(entries)
      .map((entry) => ({
        id: "apple:apple",
        label: entry.label,
        sourceType: "apple",
        careersUrl: searchUrl(entry.careersUrl).toString(),
        cxsJobsUrl: null,
      }));
  },
  hydrateSelectedSource(source) {
    return {
      ...source,
      label: source.label.trim() && source.label !== source.careersUrl ? source.label : "Apple",
      careersUrl: searchUrl(source.careersUrl).toString(),
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    return {
      label:
        input.label?.trim() && input.label.trim() !== input.careersUrl.trim()
          ? input.label.trim()
          : "Apple",
      careersUrl: searchUrl(input.careersUrl).toString(),
    };
  },
  async fetchJobs(input) {
    const url = searchUrl(input.source.careersUrl);
    const stopAt = Date.now() + 20_000;
    const signal = AbortSignal.any([callSignal(input.signal), AbortSignal.timeout(20_000)]);
    const collected: z.infer<typeof jobSchema>[] = [];
    let total = 0;
    for (let page = 1; page <= Math.ceil(MAX_JOBS / 20) && Date.now() < stopAt; page += 1) {
      url.searchParams.set("page", String(page));
      let data: Awaited<ReturnType<typeof hydration>>;
      try {
        data = await hydration(url, signal);
      } catch (error) {
        input.signal?.throwIfAborted();
        if (signal.aborted && collected.length) break;
        throw error;
      }
      const parsed = searchSchema.safeParse(data.search);
      if (!parsed.success || (parsed.data.totalRecords > 0 && !parsed.data.searchResults.length)) {
        throw upstreamError(
          "Apple careers loaderData.search.searchResults is invalid; the search structure may have changed.",
        );
      }
      total = parsed.data.totalRecords;
      const previousSize = new Set(collected.map((job) => job.positionId)).size;
      collected.push(...parsed.data.searchResults);
      if (
        collected.length >= Math.min(total, MAX_JOBS) ||
        parsed.data.searchResults.length < 20 ||
        new Set(collected.map((job) => job.positionId)).size === previousSize
      )
        break;
    }
    const unique = [...new Map(collected.map((job) => [job.positionId, job])).values()];
    unique.sort(
      (a, b) => (Date.parse(b.postDateInGMT ?? "") || 0) - (Date.parse(a.postDateInGMT ?? "") || 0),
    );
    input.signal?.throwIfAborted();
    const jobs = unique.slice(0, MAX_JOBS).map((job) => ({
      jobRef: jobUrl(job),
      source: "apple",
      sourceJobId: job.positionId,
      sourceType: "apple",
      title: job.postingTitle,
      employer: "Apple",
      jobUrl: jobUrl(job),
      applicationLink: jobUrl(job),
      location: locationText(job.locations),
      postedAt: job.postDateInGMT ?? null,
    }));
    return { total, fetched: jobs.length, jobs };
  },
  async fetchJobDetails(input) {
    searchUrl(input.source.careersUrl);
    const result = await details(input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: result.jobUrl,
      descriptionHtml: result.descriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    searchUrl(input.source.careersUrl);
    const result = await details(input.jobRef, input.signal);
    return {
      source: "apple",
      sourceHost: "jobs.apple.com",
      draft: {
        source: "apple",
        sourceJobId: result.job.positionId,
        title: result.job.postingTitle,
        employer: "Apple",
        jobUrl: result.jobUrl,
        applicationLink: result.jobUrl,
        location: locationText(result.job.locations) ?? undefined,
        jobDescription: convert(result.descriptionHtml, { wordwrap: false }),
      },
    };
  },
};
