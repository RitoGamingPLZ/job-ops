import { createHash, randomUUID } from "node:crypto";
import type { FilterIntent, FilterParam } from "@server/watchlist/autofilter/types";
import type { WatchedSourceType, WatchlistSuggestedFilterPlan } from "@shared/types";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index";

// Explicitly global: both tables store public career-board metadata and public/hashed filter plans
// shared across workspaces so multiple users adding the same career board reuse prior scans.
const { watchlistFilterPlans, watchlistSharedSources } = schema;

const facetValueSchema = z.object({
  value: z.string(),
  count: z.number().optional(),
});

const facetParamSchema = z.object({
  key: z.string(),
  multi: z.boolean(),
  values: z.array(facetValueSchema).optional(),
  freeText: z.literal(true).optional(),
});

const storedFacetsSchema = z.object({
  unfilteredTotal: z.number().int().nonnegative(),
  params: z.array(facetParamSchema),
});

const filterPlanSchema = z.object({
  suggestedUrl: z.string().url(),
  params: z.array(
    z.object({
      key: z.string(),
      values: z.array(z.string()),
    }),
  ),
  rationale: z.string(),
  totals: z.object({
    filtered: z.number().int().nonnegative(),
    unfiltered: z.number().int().nonnegative(),
  }),
  sampleTitles: z.array(z.string()),
});

export type StoredWatchlistFacets = z.infer<typeof storedFacetsSchema>;

export interface WatchlistSharedSourceRecord {
  id: string;
  urlKey: string;
  sourceType: WatchedSourceType;
  name: string;
  careersUrl: string;
  description: string;
  discoveredFacets: StoredWatchlistFacets | null;
  facetsScannedAt: string | null;
  defaultFilterPlan: WatchlistSuggestedFilterPlan | null;
  filterPlanUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseJsonSafe<T>(raw: string | null, parser: z.ZodType<T>): T | null {
  if (!raw) return null;
  try {
    const parsed = parser.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function mapSharedSourceRow(
  row: typeof watchlistSharedSources.$inferSelect,
): WatchlistSharedSourceRecord {
  const defaultFilterPlan = parseJsonSafe(row.defaultFilterPlanJson, filterPlanSchema);
  return {
    id: row.id,
    urlKey: row.urlKey,
    sourceType: row.sourceType,
    name: row.name,
    careersUrl: row.careersUrl,
    description: row.description,
    discoveredFacets: parseJsonSafe(row.discoveredFacetsJson, storedFacetsSchema),
    facetsScannedAt: row.facetsScannedAt,
    defaultFilterPlan: defaultFilterPlan as WatchlistSuggestedFilterPlan | null,
    filterPlanUpdatedAt: row.filterPlanUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUrlOrHostnameFallback(label: string, careersUrl: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  try {
    const host = new URL(careersUrl).hostname.toLowerCase();
    return trimmed.toLowerCase() === host;
  } catch {
    return false;
  }
}

function normalizeSortTerms(values: readonly string[] | null | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)),
  ].sort();
}

export function listSharedWatchlistSources(): WatchlistSharedSourceRecord[] {
  const rows = db
    .select()
    .from(watchlistSharedSources)
    .orderBy(asc(watchlistSharedSources.name))
    .all();

  return rows.map(mapSharedSourceRow);
}

export function getSharedWatchlistSourceByUrlKey(
  urlKey: string,
): WatchlistSharedSourceRecord | null {
  const normalizedKey = urlKey.trim().toLowerCase();
  if (!normalizedKey) return null;

  const row = db
    .select()
    .from(watchlistSharedSources)
    .where(eq(watchlistSharedSources.urlKey, normalizedKey))
    .get();

  return row ? mapSharedSourceRow(row) : null;
}

export function getSharedWatchlistSourceById(id: string): WatchlistSharedSourceRecord | null {
  const trimmedId = id.trim();
  if (!trimmedId) return null;

  const row = db
    .select()
    .from(watchlistSharedSources)
    .where(eq(watchlistSharedSources.id, trimmedId))
    .get();

  return row ? mapSharedSourceRow(row) : null;
}

export function upsertSharedWatchlistSource(input: {
  urlKey: string;
  sourceType: WatchedSourceType;
  name: string;
  careersUrl: string;
  description?: string | null;
  discoveredFacets?: StoredWatchlistFacets | null;
  defaultFilterPlan?: WatchlistSuggestedFilterPlan | null;
  forceUpdatePlan?: boolean;
}): { record: WatchlistSharedSourceRecord; created: boolean } {
  const urlKey = input.urlKey.trim().toLowerCase();
  const careersUrl = input.careersUrl.trim();
  const nextName = input.name.trim() || careersUrl;
  const nextDescription = input.description?.trim() ?? "";
  const now = new Date().toISOString();

  return db.transaction((tx) => {
    const existingRow = tx
      .select()
      .from(watchlistSharedSources)
      .where(eq(watchlistSharedSources.urlKey, urlKey))
      .get();

    const validatedFacets = input.discoveredFacets
      ? storedFacetsSchema.parse(input.discoveredFacets)
      : null;
    const validatedPlan = input.defaultFilterPlan
      ? filterPlanSchema.parse(input.defaultFilterPlan)
      : null;

    if (!existingRow) {
      const id = `shared:${randomUUID()}`;
      tx.insert(watchlistSharedSources)
        .values({
          id,
          urlKey,
          sourceType: input.sourceType,
          name: nextName,
          careersUrl,
          description: nextDescription,
          discoveredFacetsJson: validatedFacets ? JSON.stringify(validatedFacets) : null,
          facetsScannedAt: validatedFacets ? now : null,
          defaultFilterPlanJson: validatedPlan ? JSON.stringify(validatedPlan) : null,
          filterPlanUpdatedAt: validatedPlan ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const inserted = tx
        .select()
        .from(watchlistSharedSources)
        .where(eq(watchlistSharedSources.id, id))
        .get();
      if (!inserted) {
        throw new Error("Failed to read inserted shared watchlist source");
      }
      return { record: mapSharedSourceRow(inserted), created: true };
    }

    const existing = mapSharedSourceRow(existingRow);
    const shouldUpgradeName =
      isUrlOrHostnameFallback(existing.name, existing.careersUrl) &&
      !isUrlOrHostnameFallback(nextName, careersUrl);
    const mergedName = shouldUpgradeName ? nextName : existing.name;
    const mergedDescription = existing.description.trim() ? existing.description : nextDescription;
    const shouldReplaceFacets = Boolean(
      validatedFacets && (input.forceUpdatePlan || !existing.discoveredFacets),
    );
    const shouldReplacePlan = Boolean(
      validatedPlan && (input.forceUpdatePlan || !existing.defaultFilterPlan),
    );

    tx.update(watchlistSharedSources)
      .set({
        sourceType: existing.sourceType === "careers_site" ? input.sourceType : existing.sourceType,
        name: mergedName,
        careersUrl: existing.careersUrl || careersUrl,
        description: mergedDescription,
        ...(shouldReplaceFacets && validatedFacets
          ? {
              discoveredFacetsJson: JSON.stringify(validatedFacets),
              facetsScannedAt: now,
            }
          : {}),
        ...(shouldReplacePlan && validatedPlan
          ? {
              defaultFilterPlanJson: JSON.stringify(validatedPlan),
              filterPlanUpdatedAt: now,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(watchlistSharedSources.id, existing.id))
      .run();

    const updated = tx
      .select()
      .from(watchlistSharedSources)
      .where(eq(watchlistSharedSources.id, existing.id))
      .get();
    if (!updated) {
      throw new Error("Failed to read updated shared watchlist source");
    }

    return { record: mapSharedSourceRow(updated), created: false };
  });
}

export function computeFilterIntentHash(input: {
  intent?: FilterIntent | null;
  description?: string | null;
  name?: string | null;
}): string {
  const payload = {
    name: input.name?.trim().toLowerCase() ?? "",
    description: input.description?.trim().toLowerCase() ?? "",
    titles: normalizeSortTerms(input.intent?.titles),
    country: input.intent?.country.trim().toLowerCase() ?? "",
    cities: normalizeSortTerms(input.intent?.cities),
    workplaceTypes: normalizeSortTerms(input.intent?.workplaceTypes),
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getCachedFilterPlan(
  urlKey: string,
  intentHash: string,
): WatchlistSuggestedFilterPlan | null {
  const normalizedKey = urlKey.trim().toLowerCase();
  if (!normalizedKey || !intentHash) return null;

  const row = db
    .select()
    .from(watchlistFilterPlans)
    .where(
      and(
        eq(watchlistFilterPlans.urlKey, normalizedKey),
        eq(watchlistFilterPlans.intentHash, intentHash),
      ),
    )
    .get();

  if (!row) return null;
  const parsed = parseJsonSafe(row.planJson, filterPlanSchema);
  return parsed ? (parsed as WatchlistSuggestedFilterPlan) : null;
}

export function saveCachedFilterPlan(input: {
  urlKey: string;
  sourceType: WatchedSourceType;
  intentHash: string;
  plan: {
    suggestedUrl: string;
    params: FilterParam[];
    rationale: string;
    totals: { filtered: number; unfiltered: number };
    sampleTitles: string[];
  };
}): void {
  const urlKey = input.urlKey.trim().toLowerCase();
  const validated = filterPlanSchema.parse({
    suggestedUrl: input.plan.suggestedUrl,
    params: input.plan.params,
    rationale: input.plan.rationale,
    totals: input.plan.totals,
    sampleTitles: input.plan.sampleTitles,
  });
  const now = new Date().toISOString();

  db.insert(watchlistFilterPlans)
    .values({
      id: randomUUID(),
      urlKey,
      sourceType: input.sourceType,
      intentHash: input.intentHash,
      planJson: JSON.stringify(validated),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [watchlistFilterPlans.urlKey, watchlistFilterPlans.intentHash],
      set: {
        sourceType: input.sourceType,
        planJson: JSON.stringify(validated),
        updatedAt: now,
      },
    })
    .run();
}
