import { z } from "zod";

// Shared contract for the careers-site crawler (PLAN.md "Phase 6 interfaces").
// Owned by the lead: implementers must not change it without asking.

/** Where the crawler finds job links. */
const listingSchema = z.discriminatedUnion("kind", [
  // Tier 0: a sitemap on the company's own domain (no browser, no LLM).
  z.object({ kind: z.literal("sitemap"), url: z.string().url() }),
  // Tier 1: an HTML listing page, optionally rendered with Playwright.
  z.object({
    kind: z.literal("page"),
    url: z.string().url(),
    render: z.boolean(),
    // Optional: wait for this CSS selector before reading a rendered page.
    waitFor: z.string().max(300).optional(),
    pagination: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("none") }),
        z.object({
          kind: z.literal("query"),
          param: z.string().min(1).max(50),
          start: z.number().int().min(0),
          step: z.number().int().min(1),
        }),
      ])
      .default({ kind: "none" }),
    maxPages: z.number().int().min(1).max(5).default(1),
  }),
]);

/** How the crawler reads one job page. */
const detailSchema = z.discriminatedUnion("kind", [
  // schema.org JobPosting in <script type="application/ld+json"> (or microdata).
  z.object({ kind: z.literal("jsonld") }),
  // CSS selectors learned by the LLM. Text is read from the first match.
  z.object({
    kind: z.literal("selectors"),
    render: z.boolean(),
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(300),
    location: z.string().max(300).optional(),
    postedAt: z.string().max(300).optional(),
  }),
]);

export const recipeSchema = z.object({
  version: z.literal(1),
  // Regex source (no flags) matched against absolute job URLs on the same host.
  jobUrlPattern: z.string().min(1).max(500),
  // Optional regex with one capture group for the job id; default: the whole URL.
  jobIdPattern: z.string().max(500).optional(),
  listing: listingSchema,
  detail: detailSchema,
});

export type Recipe = z.infer<typeof recipeSchema>;

/** One row of the site_recipes table, as the repository returns it. */
export interface SiteRecipeRecord {
  host: string; // lowercased hostname, e.g. "www.okta.com"
  recipe: Recipe | null; // null when the host was marked blocked before any recipe was learned
  learnedAt: string; // ISO
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  blockedReason: string | null; // set when the site refuses plain access (403/406/challenge)
}

/** A job found by running a recipe. */
export interface CrawledJob {
  id: string;
  url: string;
  title: string;
  employer: string | null;
  location: string | null;
  postedAt: string | null; // ISO
  descriptionHtml: string | null;
}

export interface LoadedPage {
  url: string; // final URL
  status: number;
  html: string;
}

/** Thrown when a site blocks plain access; the crawler records it and stops. */
export class SiteBlockedError extends Error {
  constructor(
    readonly host: string,
    readonly reason: string,
  ) {
    super(`${host} blocks automated access (${reason})`);
    this.name = "SiteBlockedError";
  }
}
