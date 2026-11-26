import type { CrawledJob, Recipe } from "./types";

/**
 * The Cloudflare Durable Object bundle stubs out Playwright and jsdom, so careers sites cannot be
 * crawled in-process there. The deployment registers a runner that executes the crawl inside the
 * scraper container (which has both) and returns the result.
 *
 * Runtime capability only: nothing tenant-specific is retained here. Recipes, learning state and
 * credentials stay with the caller; the container is stateless.
 */

/** LLM connection the container uses to learn a recipe; resolved by the caller for its own tenant. */
export interface RemoteCareersSiteLlm {
  provider: string | null;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
}

/** `unavailable`: the container could not be reached or did not answer, so nothing is known about the site. */
export type RemoteCareersSiteRunResult =
  | { kind: "jobs"; jobs: CrawledJob[] }
  | { kind: "blocked"; reason: string }
  | { kind: "failed" }
  | { kind: "unavailable"; message?: string };

export type RemoteCareersSiteLearnResult =
  | { kind: "recipe"; recipe: Recipe }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; message: string }
  | { kind: "unavailable"; message?: string };

export interface RemoteCareersSiteRunner {
  run(input: {
    recipe: Recipe;
    /** A filtered listing URL that overrides the host recipe's listing for this run only. */
    sourceUrl?: string;
    limit: number;
    /** Milliseconds the crawl may keep loading new pages. */
    budgetMs: number;
    signal?: AbortSignal;
  }): Promise<RemoteCareersSiteRunResult>;
  learn(input: {
    careersUrl: string;
    llm: RemoteCareersSiteLlm;
    signal?: AbortSignal;
  }): Promise<RemoteCareersSiteLearnResult>;
}

/** The container could not be reached or did not start; says nothing about the site or its recipe. */
export class RemoteCareersSiteUnavailableError extends Error {
  constructor(message = "The browser for careers sites is starting. Check again in a minute.") {
    super(message);
    this.name = "RemoteCareersSiteUnavailableError";
  }
}

let remoteRunner: RemoteCareersSiteRunner | null = null;

export function setRemoteCareersSiteRunner(runner: RemoteCareersSiteRunner | null): void {
  remoteRunner = runner;
}

export function getRemoteCareersSiteRunner(): RemoteCareersSiteRunner | null {
  return remoteRunner;
}
