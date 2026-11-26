/**
 * Process-wide flag that marks a database restore as in progress. While set, the HTTP layer
 * rejects every request that could write to the database (see `restoreWriteBlockMiddleware`).
 */

let restoreInProgress = false;

export function isRestoreInProgress(): boolean {
  return restoreInProgress;
}

/** Returns false when a restore is already running, so callers can refuse a second one. */
export function tryBeginRestore(): boolean {
  if (restoreInProgress) return false;
  restoreInProgress = true;
  return true;
}

export function endRestore(): void {
  restoreInProgress = false;
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isWriteMethod(method: string): boolean {
  return !READ_ONLY_METHODS.has(method.toUpperCase());
}
