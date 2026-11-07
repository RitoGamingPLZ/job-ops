import type { Recipe } from "./types";

// Stub: PLAN.md step 28. Learns a recipe for a careers site.

/** Tier 0 first (own-domain job sitemap + JobPosting JSON-LD), then Playwright render + LLM. The result is validated by runRecipe returning >= 1 job. */
export async function learnRecipe(
  _careersUrl: string,
  _options: { signal?: AbortSignal },
): Promise<Recipe> {
  throw new Error("learnRecipe is not implemented yet");
}
