import { htmlToText } from "../../../shared/src/career-board-html";
import { CAREER_BOARD_DEFAULT_USER_AGENT } from "../../../shared/src/career-board-http";
import { toOptionalString } from "../../../shared/src/utils/type-conversion";
import { fetchWorkdayCxsJson, requiredWorkdayString, WorkdayCxsFetchError } from "./http";
import { parseWorkdayJobUrl } from "./workday-url-to-cxs";

export interface WorkdayCxsJobPostingInfo {
  id?: string;
  title?: string;
  jobDescription?: string;
  location?: string;
  additionalLocations?: string[];
  postedOn?: string;
  startDate?: string;
  timeType?: string;
  jobReqId?: string;
  jobPostingId?: string;
  jobPostingSiteId?: string;
  country?: string;
  canApply?: boolean;
  posted?: boolean;
  externalUrl?: string;
  timeLeftToApply?: string;
  endDate?: string;
  jobPostingEndDateAsText?: string;
  [key: string]: unknown;
}

export interface WorkdayCxsHiringOrganization {
  name?: string;
  url?: string;
  [key: string]: unknown;
}

export interface WorkdayCxsJobDetailResponse {
  jobPostingInfo?: WorkdayCxsJobPostingInfo;
  hiringOrganization?: WorkdayCxsHiringOrganization;
  similarJobs?: unknown[];
  userAuthenticated?: boolean;
  [key: string]: unknown;
}

export interface NormalizedWorkdayJobDetails {
  source: "workday";
  externalId: string;
  title: string;
  company?: string;
  locationText?: string;
  additionalLocations?: string[];
  postedOn?: string;
  timeType?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
  jobUrl: string;
  cxsJobUrl: string;
  externalPath: string;
  raw: WorkdayCxsJobDetailResponse;
}

export interface FetchWorkdayCxsJobDetailsOptions {
  /**
   * Public Workday job URL, e.g.
   * https://pg.wd5.myworkdayjobs.com/en-US/1000/job/Foo_R123
   */
  jobUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
  acceptLanguage?: string;
  includeRawResponse?: boolean;
}

export interface FetchWorkdayCxsJobDetailsResult {
  job: NormalizedWorkdayJobDetails;
  rawResponse?: WorkdayCxsJobDetailResponse;
}

/**
 * Fetches a Workday Candidate Experience job detail endpoint and normalizes the
 * HTML job description alongside the core posting metadata.
 */
export async function getJobDetailsFromCxs(
  options: FetchWorkdayCxsJobDetailsOptions,
): Promise<FetchWorkdayCxsJobDetailsResult> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;

  if (!fetchFn) {
    throw new WorkdayCxsFetchError({
      url: options.jobUrl,
      message: "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    });
  }

  const parsed = parseWorkdayJobUrl(options.jobUrl);
  const response = await fetchWorkdayCxsJson<WorkdayCxsJobDetailResponse>(fetchFn, {
    url: parsed.cxsJobUrl,
    method: "GET",
    signal: options.signal,
    headers: {
      accept: "application/json",
      "accept-language": options.acceptLanguage ?? "en-US",
      referer: parsed.canonicalJobUrl,
      "user-agent": options.userAgent ?? CAREER_BOARD_DEFAULT_USER_AGENT,
      ...options.headers,
    },
    errorContext: "Workday CXS job detail request",
  });

  const job = normalizeWorkdayCxsJobDetails(response, {
    cxsJobUrl: parsed.cxsJobUrl,
    externalPath: parsed.externalPath,
    jobUrl: parsed.canonicalJobUrl,
  });

  return {
    job,
    ...(options.includeRawResponse ? { rawResponse: response } : {}),
  };
}

function normalizeWorkdayCxsJobDetails(
  response: WorkdayCxsJobDetailResponse,
  args: { cxsJobUrl: string; externalPath: string; jobUrl: string },
): NormalizedWorkdayJobDetails {
  const posting = response.jobPostingInfo;

  if (!posting) {
    throw new WorkdayCxsFetchError({
      url: args.cxsJobUrl,
      message: "Workday job detail response is missing jobPostingInfo.",
    });
  }

  const title = requiredWorkdayString(posting.title, "title", {
    url: args.cxsJobUrl,
    contextLabel: "Workday job detail",
  });
  const jobDescriptionHtml = requiredWorkdayString(posting.jobDescription, "jobDescription", {
    url: args.cxsJobUrl,
    contextLabel: "Workday job detail",
  });

  return {
    source: "workday",
    externalId: toOptionalString(posting.jobReqId) ?? args.externalPath,
    title,
    company: toOptionalString(response.hiringOrganization?.name),
    locationText: toOptionalString(posting.location),
    additionalLocations: Array.isArray(posting.additionalLocations)
      ? posting.additionalLocations.filter(
          (location): location is string =>
            typeof location === "string" && location.trim().length > 0,
        )
      : undefined,
    postedOn: toOptionalString(posting.postedOn),
    timeType: toOptionalString(posting.timeType),
    jobDescriptionHtml,
    jobDescriptionText: htmlToText(jobDescriptionHtml, false),
    jobUrl: args.jobUrl,
    cxsJobUrl: args.cxsJobUrl,
    externalPath: args.externalPath,
    raw: response,
  };
}
