/**
 * Cloudflare's SQLite (D1 and Durable Object storage) rejects any statement that binds more
 * than 100 parameters ("too many SQL variables"). Local SQLite allows far more, so tests on
 * better-sqlite3 never notice. Keep every bulk `IN (...)` list and multi-row INSERT under it.
 */
export const SQL_MAX_BOUND_PARAMETERS = 100;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

/** Chunk size for an `IN (...)` list when the statement also binds `otherParameters`. */
export function inListChunkSize(otherParameters = 0): number {
  return Math.max(1, SQL_MAX_BOUND_PARAMETERS - otherParameters);
}

/** Rows per multi-row INSERT for a table with `columnsPerRow` bound columns. */
export function insertRowsPerStatement(columnsPerRow: number): number {
  return Math.max(1, Math.floor(SQL_MAX_BOUND_PARAMETERS / columnsPerRow));
}
