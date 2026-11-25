/**
 * Who may spend the operator's server-level credentials (default AI model,
 * scraper tokens, operator webhooks, ...).
 *
 * Local mode gives every invited user a private workspace, but the process
 * environment belongs to the operator. Only workspaces with an admin or an
 * explicit grant (and system-level work with no tenant identity) may fall back
 * to it; everyone else must bring their own keys in Settings.
 *
 * Hosted mode has its own entitlement policy and is deliberately unchanged.
 */
import { unprocessableEntity } from "@infra/errors";
import { getUserId, getTenantId, isSystemAdmin } from "@infra/request-context";
import { getJobOpsAppStatus } from "@server/config/app-mode";
import { isDemoMode } from "@server/config/demo";
import * as settingsRepo from "@server/repositories/settings";
import {
  tenantHasDefaultModelAccess,
  tenantHasServerCredentialAccess,
  tenantHasSystemAdmin,
} from "@server/repositories/users";
import { currentUserHasPermission } from "@server/services/user-permissions";

const ADMIN_TENANT_TTL_MS = 30_000;
type TenantCache = Map<string, { value: boolean; expiresAt: number }>;

const adminTenantCache: TenantCache = new Map();
const defaultModelTenantCache: TenantCache = new Map();
const operatorTenantCache: TenantCache = new Map();

export function clearServerCredentialCache(): void {
  adminTenantCache.clear();
  defaultModelTenantCache.clear();
  operatorTenantCache.clear();
}

async function getCachedTenantFlag(
  cache: TenantCache,
  tenantId: string,
  loader: (tenantId: string) => Promise<boolean>,
): Promise<boolean> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await loader(tenantId);
  cache.set(tenantId, { value, expiresAt: Date.now() + ADMIN_TENANT_TTL_MS });
  return value;
}

export async function canUseServerCredentials(): Promise<boolean> {
  if (getJobOpsAppStatus().appMode === "hosted") return true;
  if (isSystemAdmin()) return true;

  const tenantId = getTenantId();
  // No tenant identity: boot tasks and secret-authenticated webhooks, which
  // already run with the operator's authority.
  if (!tenantId && !getUserId()) return true;
  if (!tenantId) return false;

  return getCachedTenantFlag(adminTenantCache, tenantId, tenantHasServerCredentialAccess);
}

/** True when this caller or workspace may run on the operator's default AI model. */
export async function canUseDefaultModel(): Promise<boolean> {
  if (getJobOpsAppStatus().appMode === "hosted") return false;
  if (isSystemAdmin()) return true;

  const tenantId = getTenantId();
  const userId = getUserId();
  if (!tenantId && !userId) return true;
  if (userId) return currentUserHasPermission("defaultModel");
  if (!tenantId) return false;

  return getCachedTenantFlag(defaultModelTenantCache, tenantId, tenantHasDefaultModelAccess);
}

/** True only for system admins, operator boot/webhook jobs, or background work in an admin workspace. */
export async function isOperatorContext(): Promise<boolean> {
  if (getJobOpsAppStatus().appMode === "hosted") return false;
  if (isSystemAdmin()) return true;

  const tenantId = getTenantId();
  const userId = getUserId();
  if (!tenantId && !userId) return true;
  if (userId) return false;
  if (!tenantId) return false;

  return getCachedTenantFlag(operatorTenantCache, tenantId, tenantHasSystemAdmin);
}

export async function hasOwnLlmApiKey(): Promise<boolean> {
  return Boolean((await settingsRepo.getSetting("llmApiKey"))?.trim());
}

/** Blocks non-admin local users from using the product until they have default model access or their own API key. */
export async function ensureUserHasLlmAccess(): Promise<void> {
  if (isDemoMode()) return;
  if (getJobOpsAppStatus().appMode === "hosted") return;
  if (isSystemAdmin()) return;
  if (!getUserId() && !getTenantId()) return;
  if ((await canUseDefaultModel()) || (await hasOwnLlmApiKey())) return;

  throw unprocessableEntity(
    "Add your own AI provider API key before using Job Ops, or ask an admin for access to the default model.",
  );
}

/** True when an extractor needs no operator credentials, or runs on the user's own saved ones. */
export function hasOwnExtractorCredentials(
  manifest: { id: string; requiredEnvVars?: readonly string[] },
  settings: Record<string, string | undefined>,
): boolean {
  if (!manifest.requiredEnvVars || manifest.requiredEnvVars.length === 0) return true;
  // UKVisaJobs is the only extractor that takes credentials from saved settings.
  if (manifest.id === "ukvisajobs") {
    return Boolean(settings.ukvisajobsEmail?.trim() && settings.ukvisajobsPassword?.trim());
  }
  return false;
}
