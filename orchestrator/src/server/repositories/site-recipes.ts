import { parseJsonWithSchema } from "@server/utils/json";
import { randomUUID } from "node:crypto";
import {
  type Recipe,
  recipeSchema,
  type SiteRecipeRecord,
} from "@server/watchlist/careers-site/types";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index";

// Explicitly global: these are public extraction instructions shared across tenants.
const { siteRecipes } = schema;
const normalizeHost = (host: string): string => host.trim().toLowerCase();

export async function getSiteRecipe(host: string): Promise<SiteRecipeRecord | null> {
  const row = db
    .select()
    .from(siteRecipes)
    .where(eq(siteRecipes.host, normalizeHost(host)))
    .get();
  if (!row) return null;

  const recipe = parseJsonWithSchema(row.recipe, recipeSchema);

  return {
    host: row.host,
    recipe,
    learnedAt: row.learnedAt,
    lastSuccessAt: row.lastSuccessAt,
    consecutiveFailures: row.consecutiveFailures,
    blockedReason: row.blockedReason,
    updatedAt: row.updatedAt,
  };
}

/** Upsert a freshly learned recipe: sets learnedAt=now, consecutiveFailures=0, blockedReason=null. */
export async function saveSiteRecipe(host: string, recipe: Recipe): Promise<void> {
  const validated = recipeSchema.parse(recipe);
  const now = new Date().toISOString();
  const values = {
    host: normalizeHost(host),
    tier: validated.listing.kind === "sitemap" ? 0 : 1,
    recipe: JSON.stringify(validated),
    version: validated.version,
    learnedAt: now,
    consecutiveFailures: 0,
    blockedReason: null,
    updatedAt: now,
  };
  db.insert(siteRecipes)
    .values({ id: randomUUID(), ...values, createdAt: now })
    .onConflictDoUpdate({ target: siteRecipes.host, set: values })
    .run();
}

/** Record one run: ok resets failures and sets lastSuccessAt; not ok increments. Returns the new consecutiveFailures. */
export async function recordSiteRecipeRun(host: string, ok: boolean): Promise<number> {
  const now = new Date().toISOString();
  const row = db
    .update(siteRecipes)
    .set({
      consecutiveFailures: ok ? 0 : sql`${siteRecipes.consecutiveFailures} + 1`,
      ...(ok ? { lastSuccessAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(siteRecipes.host, normalizeHost(host)))
    .returning({ consecutiveFailures: siteRecipes.consecutiveFailures })
    .get();
  return row?.consecutiveFailures ?? 0;
}

/** Mark a host as blocked, preserving an existing recipe or inserting a null recipe. */
export async function markSiteBlocked(host: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  db.insert(siteRecipes)
    .values({
      id: randomUUID(),
      host: normalizeHost(host),
      tier: 0,
      recipe: null,
      learnedAt: now,
      blockedReason: reason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: siteRecipes.host,
      set: { blockedReason: reason, updatedAt: now },
    })
    .run();
}
