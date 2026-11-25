import { logger } from "@infra/logger";
import { getRequestContext } from "@infra/request-context";
import { getActiveTenantId } from "@server/tenancy/context";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import type { ResumeProfile } from "@shared/types";
import { designResumeToProfile, isLegacyDesignResumeError } from "./design-resume";

type TenantProfileCache = {
  localProfile: ResumeProfile | null;
  lastAccessedAt: number;
};

const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;
const PROFILE_CACHE_MAX_TENANTS = 100;
const profileCacheByScope = new Map<string, TenantProfileCache>();

function pruneProfileCache(now = Date.now()): void {
  for (const [tenantId, cache] of profileCacheByScope.entries()) {
    if (now - cache.lastAccessedAt > PROFILE_CACHE_TTL_MS) {
      profileCacheByScope.delete(tenantId);
    }
  }

  while (profileCacheByScope.size >= PROFILE_CACHE_MAX_TENANTS) {
    let oldestTenantId: string | null = null;
    let oldestAccessedAt = Number.POSITIVE_INFINITY;
    for (const [tenantId, cache] of profileCacheByScope.entries()) {
      if (cache.lastAccessedAt < oldestAccessedAt) {
        oldestTenantId = tenantId;
        oldestAccessedAt = cache.lastAccessedAt;
      }
    }
    if (!oldestTenantId) return;
    profileCacheByScope.delete(oldestTenantId);
  }
}

function getTenantProfileCache(): TenantProfileCache {
  const now = Date.now();
  pruneProfileCache(now);
  const scopeKey = getPrivateDataScope().scopeKey;
  let cache = profileCacheByScope.get(scopeKey);
  if (!cache) {
    cache = {
      localProfile: null,
      lastAccessedAt: now,
    };
    profileCacheByScope.set(scopeKey, cache);
  }
  cache.lastAccessedAt = now;
  return cache;
}

/**
 * Get the base resume profile from the local Design Resume.
 *
 * Results are cached until clearProfileCache() is called.
 *
 * @param forceRefresh Reload from the stored document instead of the cache.
 * @throws Error if no base resume has been imported yet.
 */
export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  const cache = getTenantProfileCache();

  if (cache.localProfile && !forceRefresh) {
    return cache.localProfile;
  }

  try {
    const localProfile = await designResumeToProfile();
    if (localProfile) {
      cache.localProfile = localProfile;
      return localProfile;
    }
  } catch (error) {
    if (!isLegacyDesignResumeError(error)) {
      throw error;
    }
    logger.warn("Ignoring legacy local Design Resume while loading profile", {
      error,
    });
  }

  throw new Error("Base resume not configured. Import your resume in Settings first.");
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  if (!getRequestContext()) {
    profileCacheByScope.clear();
    return;
  }

  try {
    profileCacheByScope.delete(getPrivateDataScope().scopeKey);
  } catch {
    profileCacheByScope.delete(getActiveTenantId());
  }
}

export function __getProfileCacheSizeForTests(): number {
  return profileCacheByScope.size;
}
