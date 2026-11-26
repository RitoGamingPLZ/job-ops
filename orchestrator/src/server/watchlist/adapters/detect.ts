import { isBamboohrUrl } from "@career-boards/bamboohr";
import { isGreenhouseUrl } from "@career-boards/greenhouse";
import { isWorkdayUrl } from "@career-boards/workday";
import type { WatchedSourceType } from "@shared/types";

function parseSafeHttpsUrl(careersUrl: string): URL | null {
  const trimmed = careersUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const authority = trimmed.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (
    url.protocol !== "https:" ||
    !authority ||
    authority.includes(":") ||
    authority.includes("@") ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  return url;
}

/**
 * Infers the most specific custom watchlist adapter from a pasted HTTPS careers URL
 * without performing outbound network I/O. Unrecognized public URLs fall back to
 * the general LLM-learned `"careers_site"` crawler adapter.
 */
export function detectWatchlistSourceTypeForUrl(careersUrl: string): WatchedSourceType {
  const url = parseSafeHttpsUrl(careersUrl);
  if (!url) {
    return "careers_site";
  }

  const host = url.hostname.toLowerCase();

  if (isWorkdayUrl(url.href)) {
    return "workday";
  }

  if (isBamboohrUrl(url.href)) {
    return "bamboohr";
  }

  if (isGreenhouseUrl(url.href)) {
    return "greenhouse";
  }

  if (
    (host === "jobs.lever.co" || host === "jobs.eu.lever.co") &&
    /^\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9-]+)(?:\/apply)?)?\/?$/.test(url.pathname)
  ) {
    return "lever";
  }

  if (
    host === "jobs.ashbyhq.com" &&
    /^\/([a-zA-Z0-9][a-zA-Z0-9_-]*)(?:\/([a-zA-Z0-9-]+)(?:\/application)?)?\/?$/.test(url.pathname)
  ) {
    return "ashby";
  }

  if (
    host === "jobs.smartrecruiters.com" &&
    /^\/([a-z0-9][a-z0-9_-]{0,199})(?:\/\d+(?:-[^/]+)?(?:\/apply)?)?\/?$/i.test(url.pathname)
  ) {
    return "smartrecruiters";
  }

  if (
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+oraclecloud\.com$/.test(host) &&
    /^\/hcmUI\/CandidateExperience\/([a-zA-Z-]+)\/sites\/([a-zA-Z0-9_-]+)\/jobs\/?$/.test(
      url.pathname,
    )
  ) {
    return "oracle";
  }

  if (
    (host === "amazon.jobs" || host === "www.amazon.jobs") &&
    /^\/en\/search\/?$/.test(url.pathname)
  ) {
    return "amazon";
  }

  if (host === "jobs.apple.com" && /^\/en-us\/search\/?$/.test(url.pathname)) {
    return "apple";
  }

  if (
    host === "www.google.com" &&
    /^\/about\/careers\/applications\/jobs\/results\/?$/.test(url.pathname)
  ) {
    return "google";
  }

  if (
    (host === "apply.careers.microsoft.com" || host === "explore.jobs.netflix.net") &&
    /^\/careers(?:\/search)?\/?$/.test(url.pathname)
  ) {
    return "eightfold";
  }

  return "careers_site";
}

/**
 * Strips query parameters and hash fragments from a careers URL so the shared
 * board identity reflects the underlying careers board rather than user-specific filters.
 */
export function stripUrlQueryAndHash(careersUrl: string): string {
  const trimmed = careersUrl.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return trimmed;
  }
}

/**
 * Normalized lookup key for deduplicating shared career sources and matching
 * user-pasted URLs against stored board recipes and filter plans.
 */
export function getWatchlistBaseUrlKey(careersUrl: string): string {
  const trimmed = careersUrl.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin.toLowerCase()}${normalizedPath}`;
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}
