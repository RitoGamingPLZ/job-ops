import type { Page } from "playwright";

/**
 * Content markers that indicate a Cloudflare challenge page.
 * Gathered empirically from CF challenge/interstitial HTML — these will
 * need updating if Cloudflare changes their challenge page structure.
 */
const CF_CHALLENGE_MARKERS = [
  "cf-challenge-running",
  "cf-turnstile",
  "Checking your browser",
  "challenges.cloudflare.com",
  "Just a moment...",
  // Cloudflare's "managed challenge" / interstitial
  "cf-please-wait",
  "cf_chl_opt",
  // Vercel's security checkpoint (used by e.g. hiringcafe.com behind CF)
  "Vercel Security Checkpoint",
  "vercel-protection",
] as const;

/** A challenge solve can navigate between checking and reading page content. */
export async function readPageContentIfReady(page: Page): Promise<string | null> {
  try {
    return await page.content();
  } catch (error) {
    if (
      error instanceof Error &&
      /because the page is navigating and changing the content/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Checks whether a page is currently showing a Cloudflare challenge.
 * Works by inspecting page content — no network interception needed.
 */
export async function isChallengePage(page: Page): Promise<boolean> {
  try {
    const html = await page.content();
    return CF_CHALLENGE_MARKERS.some((marker) => html.includes(marker));
  } catch {
    // Page may have navigated or crashed — treat as not a challenge
    return false;
  }
}
