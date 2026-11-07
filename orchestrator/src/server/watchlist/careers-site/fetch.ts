import type { LoadedPage } from "./types";

// Stub: PLAN.md step 26. Safe page loading for the crawler.

/** HTTPS-only GET to a public host (no private/loopback IPs), same-host redirects only, size-capped. Throws SiteBlockedError on 403/406/challenge pages. */
export async function fetchPublicText(
  _url: string,
  _options: { signal?: AbortSignal; maxBytes?: number; accept?: string },
): Promise<LoadedPage> {
  throw new Error("fetchPublicText is not implemented yet");
}

/** True when robots.txt allows User-agent * to fetch this URL. Caches robots.txt per host. */
export async function isAllowedByRobots(
  _url: string,
  _options: { signal?: AbortSignal },
): Promise<boolean> {
  throw new Error("isAllowedByRobots is not implemented yet");
}

/** Load a page: plain fetch, or rendered with the shared Playwright Chromium when render is true. Applies the same safety checks. */
export async function loadPage(
  _url: string,
  _options: { render: boolean; waitFor?: string; signal?: AbortSignal },
): Promise<LoadedPage> {
  throw new Error("loadPage is not implemented yet");
}
