/**
 * Who may spend the operator's server-level credentials (LLM key, scraper
 * tokens, Reactive Resume account, webhook secret, ...).
 *
 * Local mode gives every invited user a private workspace, but the process
 * environment belongs to the operator. Only the operator's own workspace (and
 * system-level work with no tenant identity, such as the webhook trigger) may
 * fall back to it; everyone else must bring their own keys in Settings.
 *
 * Hosted mode has its own entitlement policy and is deliberately unchanged.
 */
import { getUserId, getTenantId, isSystemAdmin } from "@infra/request-context";
import { getJobOpsAppStatus } from "@server/config/app-mode";
import { tenantHasSystemAdmin } from "@server/repositories/users";

const ADMIN_TENANT_TTL_MS = 30_000;
const adminTenantCache = new Map<string, { value: boolean; expiresAt: number }>();

export function clearServerCredentialCache(): void {
  adminTenantCache.clear();
}

export async function canUseServerCredentials(): Promise<boolean> {
  if (getJobOpsAppStatus().appMode === "hosted") return true;
  if (isSystemAdmin()) return true;

  const tenantId = getTenantId();
  // No tenant identity: boot tasks and secret-authenticated webhooks, which
  // already run with the operator's authority.
  if (!tenantId && !getUserId()) return true;
  if (!tenantId) return false;

  const cached = adminTenantCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await tenantHasSystemAdmin(tenantId);
  adminTenantCache.set(tenantId, { value, expiresAt: Date.now() + ADMIN_TENANT_TTL_MS });
  return value;
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
