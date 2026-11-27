// packages/sources/workday/src/get-jobs-from-cxs.ts
import { CAREER_BOARD_DEFAULT_USER_AGENT } from "../../../shared/src/career-board-http";
import { toOptionalString } from "../../../shared/src/utils/type-conversion";
import { fetchWorkdayCxsJson, requiredWorkdayString, WorkdayCxsFetchError } from "./http";

export { WorkdayCxsFetchError };

export interface WorkdayCxsFacetValue {
  descriptor?: string;
  id?: string;
  count?: number;
  [key: string]: unknown;
}

export interface WorkdayCxsFacet {
  facetParameter?: string;
  descriptor?: string;
  values?: WorkdayCxsFacetValue[] | WorkdayCxsFacet[];
  [key: string]: unknown;
}

export interface WorkdayCxsJobPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
  [key: string]: unknown;
}

export interface WorkdayCxsJobsResponse {
  total?: number;
  jobPostings?: WorkdayCxsJobPosting[];
  facets?: WorkdayCxsFacet[];
  userAuthenticated?: boolean;
  [key: string]: unknown;
}

export interface NormalizedWorkdayJob {
  source: "workday";
  externalId: string;
  title: string;
  company?: string;
  locationText?: string;
  postedOn?: string;
  jobUrl: string;
  externalPath: string;
  raw: WorkdayCxsJobPosting;
}

export interface FetchWorkdayCxsJobsOptions {
  /**
   * Full CXS jobs URL, e.g.
   * https://pg.wd5.myworkdayjobs.com/wday/cxs/pg/1000/jobs
   */
  cxsJobsUrl: string;

  /**
   * Public careers page URL used to build human-facing job URLs, e.g.
   * https://pg.wd5.myworkdayjobs.com/en-US/1000
   *
   * If omitted, this file falls back to https://host/{site}.
   */
  careersUrl?: string;

  company?: string;
  searchText?: string;
  appliedFacets?: Record<string, unknown>;
  limit?: number;
  maxJobs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
  acceptLanguage?: string;
  includeRawResponses?: boolean;
}

export interface FetchWorkdayCxsJobsResult {
  total: number;
  fetched: number;
  jobs: NormalizedWorkdayJob[];
  rawResponses?: WorkdayCxsJobsResponse[];
}

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_JOBS = 500;

/**
 * Fetches and paginates a Workday Candidate Experience jobs endpoint.
 *
 * This intentionally does not know anything about JobOps users, pipelines,
 * scoring, schedules, or database writes. It only talks to the Workday CXS
 * endpoint and returns normalized job records.
 */
export async function getJobsFromCxs(
  options: FetchWorkdayCxsJobsOptions,
): Promise<FetchWorkdayCxsJobsResult> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;

  if (!fetchFn) {
    throw new WorkdayCxsFetchError({
      url: options.cxsJobsUrl,
      message: "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    });
  }

  const cxsUrl = new URL(options.cxsJobsUrl);
  const { tenant, site } = parseCxsJobsUrl(cxsUrl);
  const limit = clampPositiveInteger(options.limit ?? DEFAULT_LIMIT, 1, 100);
  const maxJobs = clampPositiveInteger(options.maxJobs ?? DEFAULT_MAX_JOBS, 1, 10_000);
  const careersBaseUrl = normalizeCareersBaseUrl(options.careersUrl ?? `${cxsUrl.origin}/${site}`);

  const jobs: NormalizedWorkdayJob[] = [];
  const rawResponses: WorkdayCxsJobsResponse[] = [];

  let total = Number.POSITIVE_INFINITY;
  let offset = 0;

  while (offset < total && jobs.length < maxJobs) {
    const pageLimit = Math.min(limit, maxJobs - jobs.length);
    const response = await fetchCxsPage(fetchFn, {
      url: cxsUrl,
      tenant,
      site,
      careersBaseUrl,
      offset,
      limit: pageLimit,
      searchText: options.searchText ?? "",
      appliedFacets: options.appliedFacets ?? {},
      signal: options.signal,
      headers: options.headers,
      userAgent: options.userAgent ?? CAREER_BOARD_DEFAULT_USER_AGENT,
      acceptLanguage: options.acceptLanguage ?? "en-US",
    });

    if (options.includeRawResponses) rawResponses.push(response);

    total = typeof response.total === "number" ? response.total : jobs.length;

    const postings = Array.isArray(response.jobPostings) ? response.jobPostings : [];
    if (postings.length === 0) break;

    for (const posting of postings) {
      jobs.push(
        normalizeWorkdayCxsPosting(posting, {
          company: options.company,
          careersBaseUrl,
        }),
      );
    }

    offset += postings.length;
  }

  return {
    total: Number.isFinite(total) ? total : jobs.length,
    fetched: jobs.length,
    jobs,
    ...(options.includeRawResponses ? { rawResponses } : {}),
  };
}

async function fetchCxsPage(
  fetchFn: typeof fetch,
  args: {
    url: URL;
    tenant: string;
    site: string;
    careersBaseUrl: string;
    offset: number;
    limit: number;
    searchText: string;
    appliedFacets: Record<string, unknown>;
    signal?: AbortSignal;
    headers?: HeadersInit;
    userAgent: string;
    acceptLanguage: string;
  },
): Promise<WorkdayCxsJobsResponse> {
  const body = {
    appliedFacets: args.appliedFacets,
    limit: args.limit,
    offset: args.offset,
    searchText: args.searchText,
  };

  return fetchWorkdayCxsJson<WorkdayCxsJobsResponse>(fetchFn, {
    url: args.url,
    method: "POST",
    signal: args.signal,
    headers: {
      accept: "application/json",
      "accept-language": args.acceptLanguage,
      "content-type": "application/json",
      origin: args.url.origin,
      referer: args.careersBaseUrl,
      "user-agent": args.userAgent,
      ...args.headers,
    },
    body: JSON.stringify(body),
    errorContext: "Workday CXS request",
  });
}

function normalizeWorkdayCxsPosting(
  posting: WorkdayCxsJobPosting,
  args: { careersBaseUrl: string; company?: string },
): NormalizedWorkdayJob {
  const externalPath = requiredWorkdayString(posting.externalPath, "externalPath", {
    url: "unknown",
    contextLabel: "Workday job posting",
  });
  const title = requiredWorkdayString(posting.title, "title", {
    url: "unknown",
    contextLabel: "Workday job posting",
  });

  return {
    source: "workday",
    externalId: extractExternalId(posting, externalPath),
    title,
    company: args.company,
    locationText: toOptionalString(posting.locationsText),
    postedOn: toOptionalString(posting.postedOn),
    externalPath,
    jobUrl: buildJobUrl(args.careersBaseUrl, externalPath),
    raw: posting,
  };
}

function parseCxsJobsUrl(url: URL): { tenant: string; site: string } {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const wdayIndex = segments.findIndex((segment) => segment.toLowerCase() === "wday");

  if (wdayIndex === -1) {
    throw new WorkdayCxsFetchError({
      url: url.toString(),
      message: "CXS jobs URL must include /wday/cxs/{tenant}/{site}/jobs.",
    });
  }

  const cxs = segments[wdayIndex + 1];
  const tenant = segments[wdayIndex + 2];
  const site = segments[wdayIndex + 3];
  const jobs = segments[wdayIndex + 4];

  if (cxs?.toLowerCase() !== "cxs" || !tenant || !site || jobs?.toLowerCase() !== "jobs") {
    throw new WorkdayCxsFetchError({
      url: url.toString(),
      message: "CXS jobs URL must look like /wday/cxs/{tenant}/{site}/jobs.",
    });
  }

  return { tenant, site };
}

function buildJobUrl(careersBaseUrl: string, externalPath: string): string {
  const base = normalizeCareersBaseUrl(careersBaseUrl);
  const path = externalPath.startsWith("/") ? externalPath : `/${externalPath}`;
  return `${base}${path}`;
}

function normalizeCareersBaseUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function extractExternalId(posting: WorkdayCxsJobPosting, externalPath: string): string {
  const bulletId = Array.isArray(posting.bulletFields)
    ? posting.bulletFields.find((field) => typeof field === "string" && field.trim())
    : undefined;

  if (bulletId) return bulletId.trim();

  const pathMatch = externalPath.match(/_([^/_]+(?:-\d+)?)$/);
  if (pathMatch?.[1]) return pathMatch[1];

  return externalPath;
}

function clampPositiveInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
