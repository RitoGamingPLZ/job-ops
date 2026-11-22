import { normalizeCountryKey } from "@shared/location-support.js";
import {
  resolveSearchCities,
  shouldApplyStrictCityFilter,
} from "@shared/search-cities.js";
import type { CreateJobInput, JobLocationEvidence } from "@shared/types/jobs";
import {
  toNumberOrNull,
  toStringOrNull,
} from "@shared/utils/type-conversion.js";

const API_BASE = "https://api.adzuna.com/v1/api";
const DEFAULT_SEARCH_TERM = "web developer";

type AdzunaCompany = { display_name?: unknown };
type AdzunaLocation = { display_name?: unknown };
export type AdzunaRawJob = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  created?: unknown;
  redirect_url?: unknown;
  company?: AdzunaCompany;
  location?: AdzunaLocation;
  salary_min?: unknown;
  salary_max?: unknown;
  contract_time?: unknown;
  contract_type?: unknown;
};

export type AdzunaProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      pageNo: number;
      resultsOnPage: number;
      totalCollected: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunAdzunaOptions {
  searchTerms?: string[];
  country?: string;
  countryKey?: string;
  locations?: string[];
  maxJobsPerTerm?: number;
  resultsPerPage?: number;
  appId?: string;
  appKey?: string;
  fetchImpl?: typeof fetch;
  shouldCancel?: () => boolean;
  onProgress?: (event: AdzunaProgressEvent) => void;
}

export interface AdzunaResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function readEnvVar(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env[name]?.trim();
}

function formatSalary(job: AdzunaRawJob): string | undefined {
  const min = toNumberOrNull(job.salary_min);
  const max = toNumberOrNull(job.salary_max);

  if (min === null && max === null) return undefined;
  if (min !== null && max !== null) {
    return `${Math.round(min)}-${Math.round(max)}`;
  }
  if (min !== null) return `${Math.round(min)}+`;
  if (max !== null) return `${Math.round(max)}`;
  return undefined;
}

function mapAdzunaJob(raw: AdzunaRawJob): CreateJobInput | null {
  const jobUrl = toStringOrNull(raw.redirect_url);
  if (!jobUrl) return null;

  const id = toStringOrNull(raw.id);
  const title = toStringOrNull(raw.title) ?? "Unknown Title";
  const employer =
    toStringOrNull(raw.company?.display_name) ?? "Unknown Employer";
  const location = toStringOrNull(raw.location?.display_name);
  const locationEvidence = location
    ? ({
        location,
        source: "adzuna",
      } satisfies JobLocationEvidence)
    : undefined;

  const contractType = toStringOrNull(raw.contract_type);
  const contractTime = toStringOrNull(raw.contract_time);
  const jobType = [contractType, contractTime].filter(Boolean).join(" / ");

  return {
    source: "adzuna",
    sourceJobId: id ?? undefined,
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location: location ?? undefined,
    locationEvidence,
    salary: formatSalary(raw),
    datePosted: toStringOrNull(raw.created) ?? undefined,
    jobDescription: toStringOrNull(raw.description) ?? undefined,
    jobType: jobType || undefined,
  };
}

export async function fetchAdzunaJobsPage(args: {
  country: string;
  page: number;
  appId: string;
  appKey: string;
  what: string;
  where?: string;
  resultsPerPage: number;
  fetchImpl?: typeof fetch;
}): Promise<AdzunaRawJob[]> {
  const url = new URL(`${API_BASE}/jobs/${args.country}/search/${args.page}`);
  url.searchParams.set("app_id", args.appId);
  url.searchParams.set("app_key", args.appKey);
  if (args.what) {
    url.searchParams.set("what", args.what);
  }
  if (args.where) {
    url.searchParams.set("where", args.where);
  }
  url.searchParams.set("results_per_page", String(args.resultsPerPage));

  const fetchFn = args.fetchImpl ?? fetch;
  const response = await fetchFn(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Adzuna request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) return [];
  return body.results as AdzunaRawJob[];
}

/**
 * Worker-safe Adzuna extractor using direct fetch calls without child_process.
 */
export async function runAdzuna(
  options: RunAdzunaOptions = {},
): Promise<AdzunaResult> {
  const appId = options.appId?.trim() || readEnvVar("ADZUNA_APP_ID");
  const appKey = options.appKey?.trim() || readEnvVar("ADZUNA_APP_KEY");
  if (!appId || !appKey) {
    return {
      success: false,
      jobs: [],
      error: "Missing Adzuna credentials (ADZUNA_APP_ID / ADZUNA_APP_KEY)",
    };
  }

  const country = (options.country || "gb").trim().toLowerCase();
  const countryKey = normalizeCountryKey(options.countryKey ?? "");
  const maxJobsPerTerm = Math.max(1, options.maxJobsPerTerm ?? 50);
  const configuredResultsPerPage = options.resultsPerPage ?? 50;
  const resultsPerPage = Math.min(50, Math.max(1, configuredResultsPerPage));
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : [DEFAULT_SEARCH_TERM];
  const locations = resolveSearchCities({
    list: options.locations,
    env: readEnvVar("ADZUNA_LOCATION_QUERY"),
  });
  const runLocations = locations.length > 0 ? locations : [null];
  const termTotal = searchTerms.length * runLocations.length;

  try {
    const jobs: CreateJobInput[] = [];
    const seen = new Set<string>();

    for (let runIndex = 0; runIndex < runLocations.length; runIndex += 1) {
      const location = runLocations[runIndex];
      const strictLocationFilter =
        location !== null && shouldApplyStrictCityFilter(location, countryKey);
      const where = strictLocationFilter ? location : undefined;

      for (let i = 0; i < searchTerms.length; i += 1) {
        if (options.shouldCancel?.()) {
          return { success: true, jobs };
        }

        const searchTerm = searchTerms[i];
        const termIndex = runIndex * searchTerms.length + i + 1;

        options.onProgress?.({
          type: "term_start",
          termIndex,
          termTotal,
          searchTerm,
        });

        let page = 1;
        let termCount = 0;
        while (termCount < maxJobsPerTerm) {
          if (options.shouldCancel?.()) {
            return { success: true, jobs };
          }

          const remaining = maxJobsPerTerm - termCount;
          const take = Math.min(resultsPerPage, remaining);
          const pageResults = await fetchAdzunaJobsPage({
            country,
            page,
            appId,
            appKey,
            what: searchTerm,
            where,
            resultsPerPage: take,
            fetchImpl: options.fetchImpl,
          });

          let mappedOnPage = 0;
          for (const raw of pageResults) {
            if (termCount >= maxJobsPerTerm) break;
            const mapped = mapAdzunaJob(raw);
            if (!mapped) continue;

            termCount += 1;
            mappedOnPage += 1;

            const key = mapped.sourceJobId || mapped.jobUrl;
            if (!seen.has(key)) {
              seen.add(key);
              jobs.push(mapped);
            }
          }

          options.onProgress?.({
            type: "page_fetched",
            termIndex,
            termTotal,
            searchTerm,
            pageNo: page,
            resultsOnPage: mappedOnPage,
            totalCollected: termCount,
          });

          if (pageResults.length < take) break;
          page += 1;
          if (page > 100) break;
        }

        options.onProgress?.({
          type: "term_complete",
          termIndex,
          termTotal,
          searchTerm,
          jobsFoundTerm: termCount,
        });
      }
    }

    return { success: true, jobs };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, jobs: [], error: message };
  }
}
