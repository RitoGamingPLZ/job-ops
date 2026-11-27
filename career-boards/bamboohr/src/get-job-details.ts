import { htmlToText } from "../../../shared/src/career-board-html";
import { CAREER_BOARD_DEFAULT_USER_AGENT } from "../../../shared/src/career-board-http";
import { fetchBamboohrJson, optionalString, requiredString } from "./http";
import {
  type BamboohrSourceConfig,
  bamboohrUrlToJobUrl,
  parseBamboohrJobUrl,
} from "./bamboohr-url";

export interface BamboohrJobOpeningLocation {
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  addressCountry?: string | null;
}

export interface BamboohrJobOpening {
  jobOpeningShareUrl?: string;
  jobOpeningName?: string;
  employmentStatusLabel?: string | null;
  location?: BamboohrJobOpeningLocation | null;
  atsLocation?: {
    country?: string | null;
    state?: string | null;
    city?: string | null;
  } | null;
  description?: string;
  datePosted?: string | null;
  minimumExperience?: string | null;
  locationType?: string | null;
  [key: string]: unknown;
}

export interface BamboohrDetailResponse {
  meta?: Record<string, unknown>;
  result?: {
    jobOpening?: BamboohrJobOpening;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NormalizedBamboohrJobDetails {
  source: "bamboohr";
  externalId: string;
  title: string;
  jobUrl: string;
  locationText?: string;
  postedOn?: string;
  employmentStatus?: string;
  minimumExperience?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
  raw: BamboohrDetailResponse;
}

export interface FetchBamboohrJobDetailsOptions {
  jobUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export async function getJobDetails(
  options: FetchBamboohrJobDetailsOptions,
): Promise<{ job: NormalizedBamboohrJobDetails }> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error("No fetch implementation available. Pass fetchImpl or use Node 18+.");
  }

  const parsed = parseBamboohrJobUrl(options.jobUrl);
  const response = await fetchBamboohrJson<BamboohrDetailResponse>(fetchFn, {
    url: parsed.detailUrl,
    signal: options.signal,
    headers: {
      accept: "application/json",
      referer: parsed.canonicalJobUrl,
      "user-agent": options.userAgent ?? CAREER_BOARD_DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });

  return {
    job: normalizeBamboohrJobDetails(response, parsed),
  };
}

export function normalizeBamboohrJobDetails(
  response: BamboohrDetailResponse,
  source: BamboohrSourceConfig & { jobId: string; canonicalJobUrl: string },
): NormalizedBamboohrJobDetails {
  const jobOpening = response.result?.jobOpening;
  if (!jobOpening) {
    throw new Error(
      `BambooHR job detail response is missing result.jobOpening for ${source.canonicalJobUrl}.`,
    );
  }

  const title = requiredString(jobOpening.jobOpeningName, "jobOpeningName", source.canonicalJobUrl);
  const descriptionHtml = requiredString(
    jobOpening.description,
    "description",
    source.canonicalJobUrl,
  );
  const shareUrl =
    optionalString(jobOpening.jobOpeningShareUrl) ??
    bamboohrUrlToJobUrl(source.canonicalCareersUrl, source.jobId);

  return {
    source: "bamboohr",
    externalId: source.jobId,
    title,
    jobUrl: shareUrl,
    locationText: buildLocationText(jobOpening),
    postedOn: optionalString(jobOpening.datePosted),
    employmentStatus: optionalString(jobOpening.employmentStatusLabel),
    minimumExperience: optionalString(jobOpening.minimumExperience),
    jobDescriptionHtml: descriptionHtml,
    jobDescriptionText: htmlToText(descriptionHtml),
    raw: response,
  };
}

function buildLocationText(jobOpening: BamboohrJobOpening): string | undefined {
  const parts = [
    optionalString(jobOpening.location?.city),
    optionalString(jobOpening.location?.state),
    optionalString(jobOpening.location?.addressCountry),
    optionalString(jobOpening.atsLocation?.city),
    optionalString(jobOpening.atsLocation?.state),
    optionalString(jobOpening.atsLocation?.country),
  ].filter((value, index, values): value is string => {
    if (!value) return false;
    return values.indexOf(value) === index;
  });

  return parts.length > 0 ? parts.join(", ") : undefined;
}
