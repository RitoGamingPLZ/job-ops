import { createHash, randomUUID } from "node:crypto";
import { getBlobStore } from "@infra/blob-store";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getActiveTenantId } from "@server/tenancy/context";
import type { CreateJobInput } from "@shared/types";
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { buildScrapeKey } from "./scrape-coordinator";

const { scrapeTasks } = schema;

/** A finished scrape is reused while it is younger than this (rolling, not calendar-day). */
const SCRAPE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Stale cache rows and their blobs are removed once they are this old. */
const SCRAPE_CACHE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH_SIZE = 50;
const BLOB_PREFIX = "scrape-cache/";
const BLOB_VERSION = 1;

interface CachedScrape {
  jobs: CreateJobInput[];
  sourceErrors: string[];
  completedAt: string;
}

export function isScrapeCacheEnabled(): boolean {
  const flag = process.env.JOBOPS_SCRAPE_CACHE?.trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Identifies one extractor run: the manifest, the sources it covers, the search terms, the
 * location intent and the non-secret settings that shape its results. Two runs with the same
 * key would hit the same upstream search, so the second can reuse the first.
 *
 * Scoped to the tenant because extractors skip job pages the tenant already imported, so one
 * tenant's results are not a complete answer for another.
 */
export function buildSourceRunCacheKey(input: {
  manifestId: string;
  sources: string[];
  searchTerms: string[];
  locationIntent: unknown;
  settings: Record<string, string>;
  tenantId?: string;
}): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        sources: [...input.sources].sort(),
        location: input.locationIntent ?? null,
        settings: sortedRecord(input.settings),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return buildScrapeKey({
    source: `${input.tenantId ?? getActiveTenantId()}:${input.manifestId}`,
    target: fingerprint,
    title: [...input.searchTerms]
      .map((term) => term.trim().toLowerCase())
      .sort()
      .join("|"),
    location: "",
  });
}

function blobKeyFor(scrapeKey: string): string {
  return `${BLOB_PREFIX}${createHash("sha256").update(scrapeKey).digest("hex")}.json`;
}

/** Returns a still-fresh successful scrape for this key, or null (never throws). */
export async function readScrapeCache(
  scrapeKey: string,
  now: Date = new Date(),
): Promise<CachedScrape | null> {
  try {
    const cutoff = new Date(now.getTime() - SCRAPE_CACHE_TTL_MS).toISOString();
    const [row] = await db
      .select()
      .from(scrapeTasks)
      .where(and(eq(scrapeTasks.scrapeKey, scrapeKey), eq(scrapeTasks.status, "done")))
      .orderBy(desc(scrapeTasks.completedAt))
      .limit(1);
    if (!row?.completedAt || row.completedAt < cutoff || !row.resultKey) return null;

    const blob = await getBlobStore().get(row.resultKey);
    if (!blob) return null;
    const parsed = JSON.parse(new TextDecoder().decode(blob.body)) as {
      version?: number;
      jobs?: unknown;
      sourceErrors?: unknown;
    };
    if (parsed.version !== BLOB_VERSION || !Array.isArray(parsed.jobs) || parsed.jobs.length === 0) {
      return null;
    }
    return {
      jobs: parsed.jobs as CreateJobInput[],
      sourceErrors: Array.isArray(parsed.sourceErrors) ? (parsed.sourceErrors as string[]) : [],
      completedAt: row.completedAt,
    };
  } catch (error) {
    logger.warn("Scrape cache read failed; running the extractor", {
      error: sanitizeUnknown(error),
    });
    return null;
  }
}

/** Records a successful scrape for reuse. Failures are logged and never break the run. */
export async function writeScrapeCache(input: {
  scrapeKey: string;
  source: string;
  runtime?: "worker" | "browser" | "container";
  jobs: CreateJobInput[];
  sourceErrors: string[];
  now?: Date;
}): Promise<void> {
  if (input.jobs.length === 0) return;
  try {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const resultKey = blobKeyFor(input.scrapeKey);
    await getBlobStore().put(
      resultKey,
      JSON.stringify({
        version: BLOB_VERSION,
        completedAt: nowIso,
        jobs: input.jobs,
        sourceErrors: input.sourceErrors,
      }),
      { contentType: "application/json" },
    );

    const id = randomUUID();
    await db.insert(scrapeTasks).values({
      id,
      scrapeKey: input.scrapeKey,
      windowStart: nowIso,
      source: input.source,
      runtime: input.runtime ?? "container",
      target: "",
      titleNorm: "",
      location: "",
      status: "done",
      attempts: 1,
      completedAt: nowIso,
      resultKey,
      postingsFound: input.jobs.length,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    // One live row per key; the blob path is derived from the key so it is simply overwritten.
    await db
      .delete(scrapeTasks)
      .where(and(eq(scrapeTasks.scrapeKey, input.scrapeKey), ne(scrapeTasks.id, id)));
    await pruneStaleScrapeCache(now);
  } catch (error) {
    logger.warn("Scrape cache write failed", { error: sanitizeUnknown(error) });
  }
}

async function pruneStaleScrapeCache(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - SCRAPE_CACHE_RETENTION_MS).toISOString();
  const stale = await db
    .select({ id: scrapeTasks.id, resultKey: scrapeTasks.resultKey })
    .from(scrapeTasks)
    .where(and(eq(scrapeTasks.status, "done"), lt(scrapeTasks.completedAt, cutoff)))
    .limit(PRUNE_BATCH_SIZE);
  if (stale.length === 0) return;
  const blobStore = getBlobStore();
  for (const row of stale) {
    if (row.resultKey?.startsWith(BLOB_PREFIX)) {
      await blobStore.delete(row.resultKey).catch(() => undefined);
    }
  }
  await db.delete(scrapeTasks).where(
    inArray(
      scrapeTasks.id,
      stale.map((row) => row.id),
    ),
  );
}
