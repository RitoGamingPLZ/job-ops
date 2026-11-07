import type { CrawledJob, Recipe } from "./types";

// Stub: PLAN.md step 27. Applies a stored recipe without any LLM call.

/** Collect job links from recipe.listing, newest first where known, at most `limit`, then read each job page per recipe.detail. */
export async function runRecipe(
  _recipe: Recipe,
  _options: { limit: number; signal?: AbortSignal },
): Promise<CrawledJob[]> {
  throw new Error("runRecipe is not implemented yet");
}

/** Parse one job page's HTML per recipe.detail. Returns null when the page has no job. */
export function extractJob(
  _html: string,
  _url: string,
  _recipe: Recipe,
): CrawledJob | null {
  throw new Error("extractJob is not implemented yet");
}
