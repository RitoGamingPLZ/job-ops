import { isBamboohrUrl } from "@career-boards/bamboohr";
import { isGreenhouseUrl } from "@career-boards/greenhouse";
import { isWorkdayUrl } from "@career-boards/workday";
import type { WatchedSourceType } from "@shared/types";
import { parseAmazonUrl } from "./amazon";
import { parseAppleUrl } from "./apple";
import { parseAshbyUrl } from "./ashby";
import { parseEightfoldUrl } from "./eightfold";
import { searchUrl as parseGoogleUrl } from "./google";
import { parseLeverUrl } from "./lever";
import { parseOracleUrl } from "./oracle";
import { parseSmartRecruitersUrl } from "./smartrecruiters";
import { tryParseSafeHttpsUrl } from "./url";

function matchesParser(parser: (value: string) => unknown, value: string): boolean {
  try {
    parser(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Infers the most specific custom watchlist adapter from a pasted HTTPS careers URL
 * without performing outbound network I/O. Unrecognized public URLs fall back to
 * the general LLM-learned `"careers_site"` crawler adapter.
 */
export function detectWatchlistSourceTypeForUrl(careersUrl: string): WatchedSourceType {
  const trimmed = careersUrl.trim();
  const url = tryParseSafeHttpsUrl(trimmed);
  if (!url) {
    return "careers_site";
  }

  if (isWorkdayUrl(url.href)) {
    return "workday";
  }

  if (isBamboohrUrl(url.href)) {
    return "bamboohr";
  }

  if (isGreenhouseUrl(url.href)) {
    return "greenhouse";
  }

  const providers: ReadonlyArray<readonly [WatchedSourceType, (value: string) => unknown]> = [
    ["lever", parseLeverUrl],
    ["ashby", parseAshbyUrl],
    ["smartrecruiters", parseSmartRecruitersUrl],
    ["oracle", parseOracleUrl],
    ["amazon", parseAmazonUrl],
    ["apple", parseAppleUrl],
    ["google", parseGoogleUrl],
    ["eightfold", parseEightfoldUrl],
  ];
  for (const [sourceType, parser] of providers) {
    if (matchesParser(parser, trimmed)) return sourceType;
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
