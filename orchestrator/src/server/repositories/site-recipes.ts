import type {
  Recipe,
  SiteRecipeRecord,
} from "@server/watchlist/careers-site/types";

// Stub: PLAN.md step 25. Global (not tenant-scoped) store of learned crawler recipes, keyed by host.

export async function getSiteRecipe(
  _host: string,
): Promise<SiteRecipeRecord | null> {
  throw new Error("getSiteRecipe is not implemented yet");
}

/** Upsert a freshly learned recipe: sets learnedAt=now, consecutiveFailures=0, blockedReason=null. */
export async function saveSiteRecipe(
  _host: string,
  _recipe: Recipe,
): Promise<void> {
  throw new Error("saveSiteRecipe is not implemented yet");
}

/** Record one run: ok resets failures and sets lastSuccessAt; not ok increments. Returns the new consecutiveFailures. */
export async function recordSiteRecipeRun(
  _host: string,
  _ok: boolean,
): Promise<number> {
  throw new Error("recordSiteRecipeRun is not implemented yet");
}

/** Mark a host as blocked (keeps any recipe). */
export async function markSiteBlocked(
  _host: string,
  _reason: string,
): Promise<void> {
  throw new Error("markSiteBlocked is not implemented yet");
}
