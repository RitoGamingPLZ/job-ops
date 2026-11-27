import { CAREER_BOARD_DEFAULT_USER_AGENT } from "../../../shared/src/career-board-http";
import { fetchBamboohrJson, optionalString, requiredString } from "./http";
import { parseBamboohrUrl } from "./bamboohr-url";

export interface BamboohrCompanyInfoResponse {
  meta?: unknown;
  result?: {
    name?: string;
    logoUrl?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NormalizedBamboohrCompanyInfo {
  name: string;
  logoUrl?: string;
  raw: BamboohrCompanyInfoResponse;
}

export interface FetchBamboohrCompanyInfoOptions {
  careersUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export async function getCompanyInfo(
  options: FetchBamboohrCompanyInfoOptions,
): Promise<{ company: NormalizedBamboohrCompanyInfo }> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error("No fetch implementation available. Pass fetchImpl or use Node 18+.");
  }

  const parsed = parseBamboohrUrl(options.careersUrl);
  const response = await fetchBamboohrJson<BamboohrCompanyInfoResponse>(fetchFn, {
    url: parsed.companyInfoUrl,
    signal: options.signal,
    headers: {
      accept: "application/json",
      referer: parsed.canonicalCareersUrl,
      "user-agent": options.userAgent ?? CAREER_BOARD_DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });

  return {
    company: normalizeBamboohrCompanyInfo(response, parsed.companyInfoUrl),
  };
}

export function normalizeBamboohrCompanyInfo(
  response: BamboohrCompanyInfoResponse,
  url: string,
): NormalizedBamboohrCompanyInfo {
  const result = response.result;
  if (!result) {
    throw new Error(`BambooHR company info response is missing result for ${url}.`);
  }

  const name = requiredString(result.name, "name", url);
  return {
    name,
    logoUrl: optionalString(result.logoUrl),
    raw: response,
  };
}
