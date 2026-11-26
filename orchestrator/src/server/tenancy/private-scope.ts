import { createHash } from "node:crypto";
import { join } from "node:path";
import { unauthorized } from "@infra/errors";
import { getUserId } from "@infra/request-context";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import { getDataDir } from "@server/config/dataDir";
import { and, eq, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getActiveTenantId } from "./context";

type PrivateDataScope = {
  tenantId: string;
  userId: string | null;
  enforceUserIsolation: boolean;
  scopeKey: string;
};

type UserScopedTable = {
  tenantId: AnySQLiteColumn;
  userId: AnySQLiteColumn;
};

export function isHostedUserIsolationEnabled(): boolean {
  return getJobOpsAppConfig().appMode === "hosted";
}

export function getPrivateDataScope(): PrivateDataScope {
  const tenantId = getActiveTenantId();
  const userId = getUserId() ?? null;
  const enforceUserIsolation = isHostedUserIsolationEnabled();

  if (enforceUserIsolation && !userId) {
    throw unauthorized("Authentication required");
  }

  return {
    tenantId,
    userId,
    enforceUserIsolation,
    scopeKey: enforceUserIsolation && userId ? `${tenantId}:${userId}` : tenantId,
  };
}

export function getPrivateCloudflareCookieStorageDir(): string {
  const scopeHash = createHash("sha256").update(getPrivateDataScope().scopeKey).digest("hex");
  return join(getDataDir(), "cloudflare-cookies", scopeHash);
}

export function privateDataScopeFilter(table: UserScopedTable): SQL {
  const scope = getPrivateDataScope();
  const filters = [eq(table.tenantId, scope.tenantId)];
  if (scope.enforceUserIsolation && scope.userId) {
    filters.push(eq(table.userId, scope.userId));
  }
  return and(...filters) as SQL;
}

/**
 * Returns the active tenant and non-null user id for strictly user-owned tables
 * (e.g., watchlist selections and saved searches), failing loudly if user context is absent.
 */
export function getRequiredUserScope(contextMessage = "User context is required"): {
  tenantId: string;
  userId: string;
} {
  const userId = getUserId();
  if (!userId) {
    throw new Error(contextMessage);
  }
  return {
    tenantId: getActiveTenantId(),
    userId,
  };
}

/**
 * Builds a strict tenant + user filter for tables that never permit null `userId` rows.
 */
export function requiredUserScopeFilter(table: UserScopedTable, contextMessage?: string): SQL {
  const { tenantId, userId } = getRequiredUserScope(contextMessage);
  return and(eq(table.tenantId, tenantId), eq(table.userId, userId)) as SQL;
}
