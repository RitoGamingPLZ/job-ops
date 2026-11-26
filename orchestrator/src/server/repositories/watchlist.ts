import { randomUUID } from "node:crypto";
import type {
  UpdateWatchlistSelectionsInput,
  WatchlistCheckInput,
  WatchlistCheckResponse,
  WatchlistJobState,
  WatchlistSelectedSource,
} from "@shared/types";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getRequiredUserScope, requiredUserScopeFilter } from "../tenancy/private-scope";
import { chunk, inListChunkSize, insertRowsPerStatement } from "../utils/sql-chunks";

const {
  watchlistChecks,
  watchlistJobStates,
  watchlistSeenJobs,
  watchlistSelectedSources,
  watchlistSourceResults,
} = schema;

const WATCHLIST_USER_CONTEXT_ERROR = "User context is required for watchlist source selections";

function mapRowToWatchlistJobState(row: typeof watchlistJobStates.$inferSelect): WatchlistJobState {
  return {
    source: row.source,
    sourceJobId: row.sourceJobId,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRowToWatchlistSelectedSource(
  row: typeof watchlistSelectedSources.$inferSelect,
): WatchlistSelectedSource {
  return {
    id: row.id,
    catalogSourceId: row.catalogSourceId,
    label: row.label,
    careersUrl: row.careersUrl,
    cxsJobsUrl: row.cxsJobsUrl,
    description: row.description ?? "",
    sourceType: row.sourceType,
    isCustom: row.isCustom,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function watchlistScopeFilter(table: Parameters<typeof requiredUserScopeFilter>[0]) {
  return requiredUserScopeFilter(table, WATCHLIST_USER_CONTEXT_ERROR);
}

export async function listWatchlistSelectedSources(): Promise<WatchlistSelectedSource[]> {
  const rows = await db
    .select()
    .from(watchlistSelectedSources)
    .where(watchlistScopeFilter(watchlistSelectedSources))
    .orderBy(asc(watchlistSelectedSources.sortOrder));

  return rows.map(mapRowToWatchlistSelectedSource);
}

export async function replaceWatchlistSelectedSources(
  input: UpdateWatchlistSelectionsInput,
): Promise<WatchlistSelectedSource[]> {
  const { tenantId, userId } = getRequiredUserScope(WATCHLIST_USER_CONTEXT_ERROR);
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.delete(watchlistSelectedSources)
      .where(
        and(
          eq(watchlistSelectedSources.tenantId, tenantId),
          eq(watchlistSelectedSources.userId, userId),
        ),
      )
      .run();

    // Cached results belong to a watched source; drop those whose source is no longer watched.
    const keptSourceKeys = input.selections.map(
      (selection) => `${selection.sourceType}|${selection.careersUrl}`,
    );
    tx.delete(watchlistSourceResults)
      .where(
        and(
          eq(watchlistSourceResults.tenantId, tenantId),
          eq(watchlistSourceResults.userId, userId),
          ...(keptSourceKeys.length > 0
            ? [notInArray(watchlistSourceResults.sourceKey, keptSourceKeys)]
            : []),
        ),
      )
      .run();

    if (input.selections.length === 0) {
      return;
    }

    const rows = input.selections.map((selection, index) => ({
      id: randomUUID(),
      tenantId,
      userId,
      catalogSourceId: selection.catalogSourceId ?? null,
      label: selection.label?.trim() || selection.careersUrl,
      careersUrl: selection.careersUrl,
      cxsJobsUrl: null,
      description: selection.description?.trim() ?? "",
      sourceType: selection.sourceType,
      isCustom: !selection.catalogSourceId,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    }));

    // Cloudflare's SQLite rejects statements binding more than 100 parameters, and adding a
    // source group saves dozens of rows at once, so insert in batches.
    const rowsPerStatement = insertRowsPerStatement(Object.keys(rows[0] ?? {}).length);
    for (const batch of chunk(rows, rowsPerStatement)) {
      tx.insert(watchlistSelectedSources).values(batch).run();
    }
  });

  return listWatchlistSelectedSources();
}

export async function listWatchlistJobStates(): Promise<WatchlistJobState[]> {
  const rows = await db
    .select()
    .from(watchlistJobStates)
    .where(watchlistScopeFilter(watchlistJobStates));

  return rows.map(mapRowToWatchlistJobState);
}

export async function setWatchlistJobState(input: {
  source: string;
  sourceJobId: string;
  state: WatchlistJobState["state"];
}): Promise<WatchlistJobState> {
  const { tenantId, userId } = getRequiredUserScope(WATCHLIST_USER_CONTEXT_ERROR);
  const stateScope = and(
    eq(watchlistJobStates.tenantId, tenantId),
    eq(watchlistJobStates.userId, userId),
  );
  const now = new Date().toISOString();

  const [existing] = await db
    .select({ id: watchlistJobStates.id })
    .from(watchlistJobStates)
    .where(
      and(
        stateScope,
        eq(watchlistJobStates.source, input.source),
        eq(watchlistJobStates.sourceJobId, input.sourceJobId),
      ),
    );

  if (existing) {
    await db
      .update(watchlistJobStates)
      .set({ state: input.state, updatedAt: now })
      .where(and(stateScope, eq(watchlistJobStates.id, existing.id)));
  } else {
    await db.insert(watchlistJobStates).values({
      id: randomUUID(),
      tenantId,
      userId,
      source: input.source,
      sourceJobId: input.sourceJobId,
      state: input.state,
      createdAt: now,
      updatedAt: now,
    });
  }

  const [row] = await db
    .select()
    .from(watchlistJobStates)
    .where(
      and(
        stateScope,
        eq(watchlistJobStates.source, input.source),
        eq(watchlistJobStates.sourceJobId, input.sourceJobId),
      ),
    );

  if (!row) {
    throw new Error("Failed to retrieve watchlist job state");
  }
  return mapRowToWatchlistJobState(row);
}

export async function clearWatchlistJobState(input: {
  source: string;
  sourceJobId: string;
}): Promise<number> {
  const result = await db
    .delete(watchlistJobStates)
    .where(
      and(
        watchlistScopeFilter(watchlistJobStates),
        eq(watchlistJobStates.source, input.source),
        eq(watchlistJobStates.sourceJobId, input.sourceJobId),
      ),
    );

  return result.changes;
}

export async function recordWatchlistCheck(
  input: WatchlistCheckInput,
): Promise<WatchlistCheckResponse> {
  const { tenantId, userId } = getRequiredUserScope(WATCHLIST_USER_CONTEXT_ERROR);
  const now = new Date().toISOString();

  const normalizedChecks = input.checks
    .map((check) => ({
      source: String(check.source),
      sourceJobIds: Array.from(
        new Set(check.sourceJobIds.map((sourceJobId) => sourceJobId.trim()).filter(Boolean)),
      ),
    }))
    .filter((check) => check.sourceJobIds.length > 0);

  return db.transaction((tx) => {
    const existingCheckpoint = tx
      .select()
      .from(watchlistChecks)
      .where(and(eq(watchlistChecks.tenantId, tenantId), eq(watchlistChecks.userId, userId)))
      .get();

    const previousLastCheckedAt = existingCheckpoint?.lastCheckedAt ?? null;
    const existingSeenRows = normalizedChecks.map((check) =>
      // A check can carry up to 200 job ids; keep each IN (...) under the bound-parameter cap.
      chunk(check.sourceJobIds, inListChunkSize(5)).flatMap((sourceJobIds) =>
        tx
          .select()
          .from(watchlistSeenJobs)
          .where(
            and(
              eq(watchlistSeenJobs.tenantId, tenantId),
              eq(watchlistSeenJobs.userId, userId),
              eq(watchlistSeenJobs.source, check.source),
              inArray(watchlistSeenJobs.sourceJobId, sourceJobIds),
            ),
          )
          .all(),
      ),
    );

    const existingSeenByKey = new Map<string, (typeof existingSeenRows)[number][number]>(
      existingSeenRows.flat().map((row) => [`${row.source}:${row.sourceJobId}`, row] as const),
    );

    for (const check of normalizedChecks) {
      for (const sourceJobId of check.sourceJobIds) {
        const key = `${check.source}:${sourceJobId}`;
        const existing = existingSeenByKey.get(key);

        tx.insert(watchlistSeenJobs)
          .values({
            id: existing?.id ?? randomUUID(),
            tenantId,
            userId,
            source: check.source,
            sourceJobId,
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              watchlistSeenJobs.tenantId,
              watchlistSeenJobs.userId,
              watchlistSeenJobs.source,
              watchlistSeenJobs.sourceJobId,
            ],
            set: {
              lastSeenAt: now,
              updatedAt: now,
            },
          })
          .run();
      }
    }

    tx.insert(watchlistChecks)
      .values({
        id: existingCheckpoint?.id ?? randomUUID(),
        tenantId,
        userId,
        lastCheckedAt: now,
        createdAt: existingCheckpoint?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [watchlistChecks.tenantId, watchlistChecks.userId],
        set: {
          lastCheckedAt: now,
          updatedAt: now,
        },
      })
      .run();

    const jobs = normalizedChecks.flatMap((check) =>
      check.sourceJobIds.map((sourceJobId) => {
        const existing = existingSeenByKey.get(`${check.source}:${sourceJobId}`);
        const firstSeenAt = existing?.firstSeenAt ?? now;
        return {
          source: check.source,
          sourceJobId,
          isNewSinceLastCheck: previousLastCheckedAt !== null && existing === undefined,
          firstSeenAt,
          lastSeenAt: now,
        };
      }),
    );

    return {
      previousLastCheckedAt,
      checkedAt: now,
      jobs,
    };
  });
}

export interface StoredWatchlistSourceResult {
  sourceKey: string;
  status: "success" | "error";
  resultJson: string;
  checkedAt: string;
  previousCheckedAt: string | null;
}

export async function listWatchlistSourceResults(): Promise<StoredWatchlistSourceResult[]> {
  const rows = await db
    .select()
    .from(watchlistSourceResults)
    .where(watchlistScopeFilter(watchlistSourceResults));

  return rows.map((row) => ({
    sourceKey: row.sourceKey,
    status: row.status,
    resultJson: row.resultJson,
    checkedAt: row.checkedAt,
    previousCheckedAt: row.previousCheckedAt,
  }));
}

export async function saveWatchlistSourceResults(
  entries: StoredWatchlistSourceResult[],
): Promise<void> {
  if (entries.length === 0) return;
  const { tenantId, userId } = getRequiredUserScope(WATCHLIST_USER_CONTEXT_ERROR);
  const now = new Date().toISOString();

  db.transaction((tx) => {
    for (const entry of entries) {
      tx.insert(watchlistSourceResults)
        .values({
          id: randomUUID(),
          tenantId,
          userId,
          sourceKey: entry.sourceKey,
          status: entry.status,
          resultJson: entry.resultJson,
          checkedAt: entry.checkedAt,
          previousCheckedAt: entry.previousCheckedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            watchlistSourceResults.tenantId,
            watchlistSourceResults.userId,
            watchlistSourceResults.sourceKey,
          ],
          set: {
            status: entry.status,
            resultJson: entry.resultJson,
            checkedAt: entry.checkedAt,
            previousCheckedAt: entry.previousCheckedAt,
            updatedAt: now,
          },
        })
        .run();
    }
  });
}
