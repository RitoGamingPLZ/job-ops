import { WATCHLIST_CONTROL_ROLES } from "@shared/types";
import { z } from "zod";

// Shared contract for the careers-site crawler (PLAN.md "Phase 6 interfaces").
// Owned by the lead: implementers must not change it without asking.

const paginationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("query"),
    param: z.string().min(1).max(50),
    start: z.number().int().min(0),
    step: z.number().int().min(1),
  }),
]);

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
    pagination: paginationSchema.default({ kind: "none" }),
    maxPages: z.number().int().min(1).max(5).default(1),
  }),
]);

/**
 * One public search control of the listing, verified at learn time. Values the user types or picks
 * are never stored here; they live in the user's own source URL.
 */
const searchParamSchema = z
  .object({
    key: z.string().min(1).max(60),
    // What the control means on any board (keyword, location, ...). Optional: older recipes lack it.
    role: z.enum(WATCHLIST_CONTROL_ROLES).optional(),
    label: z.string().max(80).optional(),
    input: z.discriminatedUnion("kind", [
      // `multiple`: several free-text values (for example locations), written per `encoding`.
      z.object({ kind: z.literal("text"), multiple: z.boolean().optional() }),
      z.object({
        kind: z.literal("choice"),
        // `value` is what the site expects in the URL; `label` is only for display.
        options: z
          .array(
            z.object({
              value: z.string().min(1).max(120),
              label: z.string().max(120).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    ]),
    // How several values are written: one key once, the key repeated, or one comma-joined value.
    encoding: z.enum(["single", "repeat", "comma"]).default("single"),
  })
  .superRefine((param, context) => {
    // Several values need a way to be written, and a comma join cannot carry a value with a comma
    // (Lever locations such as "San Francisco, CA"): it would be read back as two values.
    if (param.input.kind === "text" && param.input.multiple && param.encoding === "single")
      context.addIssue({
        code: "custom",
        message: "Multiple text values need repeat or comma encoding.",
      });
    if (
      param.encoding === "comma" &&
      param.input.kind === "choice" &&
      param.input.options.some((option) => option.value.includes(","))
    )
      context.addIssue({
        code: "custom",
        message: "Comma encoding cannot carry values with commas.",
      });
  });

/** A GET listing whose query string carries the filters, verified by the learner. */
const searchSchema = z.object({
  url: z.string().url(),
  params: z.array(searchParamSchema).min(1).max(12),
  pagination: paginationSchema.default({ kind: "none" }),
  maxPages: z.number().int().min(1).max(10).default(1),
  render: z.boolean(),
  waitFor: z.string().max(300).optional(),
});

/** Optional job fields beyond the title/description/location/date every recipe extracts. */
export const EXTRA_FIELD_NAMES = ["salary", "deadline", "jobType", "jobLevel"] as const;
export type ExtraFieldName = (typeof EXTRA_FIELD_NAMES)[number];

const fieldRuleSchema = z.discriminatedUnion("kind", [
  // Text (or an attribute) of the first element matching a CSS selector.
  z.object({
    kind: z.literal("selector"),
    selector: z.string().min(1).max(300),
    attribute: z
      .string()
      .regex(/^[a-z][a-z0-9_:-]*$/i)
      .max(50)
      .optional(),
  }),
  // The value that follows a visible label such as "Salary" inside a container.
  z.object({
    kind: z.literal("label"),
    container: z.string().min(1).max(300),
    label: z.string().min(1).max(80),
  }),
  // A schema.org JobPosting property (JSON-LD or microdata).
  z.object({
    kind: z.literal("jobPosting"),
    property: z.enum(["baseSalary", "validThrough", "employmentType"]),
  }),
]);
const fieldsSchema = z.object({
  salary: fieldRuleSchema.optional(),
  deadline: fieldRuleSchema.optional(),
  jobType: fieldRuleSchema.optional(),
  jobLevel: fieldRuleSchema.optional(),
});

/** How the crawler reads one job page. */
const detailSchema = z.discriminatedUnion("kind", [
  // schema.org JobPosting in <script type="application/ld+json"> (or microdata).
  z.object({
    kind: z.literal("jsonld"),
    // Optional: the JobPosting is only present after client-side rendering.
    render: z.boolean().optional(),
    waitFor: z.string().max(300).optional(),
    fields: fieldsSchema.optional(),
  }),
  // CSS selectors learned by the LLM. Text is read from the first match.
  z.object({
    kind: z.literal("selectors"),
    render: z.boolean(),
    waitFor: z.string().max(300).optional(),
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(300),
    location: z.string().max(300).optional(),
    postedAt: z.string().max(300).optional(),
    fields: fieldsSchema.optional(),
  }),
]);

export const recipeSchema = z.object({
  // Version 2 adds `search` and `detail.fields`; recipes without them stay version 1 so an older
  // reader (a container that has not been redeployed yet) can still parse them.
  version: z.union([z.literal(1), z.literal(2)]),
  // Regex source (no flags) matched against absolute job URLs on the same host.
  jobUrlPattern: z.string().min(1).max(500),
  // Optional regex with one capture group for the job id; default: the whole URL.
  jobIdPattern: z.string().max(500).optional(),
  listing: listingSchema,
  // Searchable form of the listing, used when the user's source URL carries filters.
  search: searchSchema.optional(),
  detail: detailSchema,
});

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeSearch = NonNullable<Recipe["search"]>;
export type SearchParam = RecipeSearch["params"][number];
export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type DetailFields = z.infer<typeof fieldsSchema>;

/** Whether job pages must be rendered in a browser before they are read. */
export function detailRenders(recipe: Recipe): boolean {
  return recipe.detail.render === true;
}

/** One row of the site_recipes table, as the repository returns it. */
export interface SiteRecipeRecord {
  host: string; // lowercased hostname, e.g. "www.okta.com"
  recipe: Recipe | null; // null when the host was marked blocked before any recipe was learned
  learnedAt: string; // ISO
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  blockedReason: string | null; // set when the site refuses plain access (403/406/challenge)
  updatedAt: string; // ISO; while blockedReason is set this is when the block was recorded
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
  // Optional: absent from jobs read by v1 recipes and from older cached results.
  salary?: string | null;
  deadline?: string | null;
  jobType?: string | null;
  jobLevel?: string | null;
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
