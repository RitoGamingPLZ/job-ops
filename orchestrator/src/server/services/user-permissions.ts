/**
 * Per-user feature switches an admin controls. System admins always pass, and
 * so does work with no user identity (boot tasks, secret-authenticated webhooks).
 * Hosted mode has its own entitlement policy and is left alone.
 */
import { getUserId, isSystemAdmin } from "@infra/request-context";
import { getJobOpsAppStatus } from "@server/config/app-mode";
import { getUserPermissions } from "@server/repositories/users";
import { USER_PERMISSION_KEYS, type UserPermissionKey, type UserPermissions } from "@shared/types";
import { z } from "zod";

const PERMISSION_TTL_MS = 10_000;
const cache = new Map<string, { value: UserPermissions | null; expiresAt: number }>();

export function clearUserPermissionCache(): void {
  cache.clear();
}

async function loadPermissions(userId: string): Promise<UserPermissions | null> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await getUserPermissions(userId);
  cache.set(userId, { value, expiresAt: Date.now() + PERMISSION_TTL_MS });
  return value;
}

export async function currentUserHasPermission(key: UserPermissionKey): Promise<boolean> {
  if (getJobOpsAppStatus().appMode === "hosted") return true;
  if (isSystemAdmin()) return true;
  const userId = getUserId();
  if (!userId) return true;
  const permissions = await loadPermissions(userId);
  return permissions?.[key] === true;
}

/** Request-body shape for granting or revoking permissions. Unknown keys are rejected. */
export const permissionsInputSchema = z
  .object(
    Object.fromEntries(USER_PERMISSION_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
      UserPermissionKey,
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();
