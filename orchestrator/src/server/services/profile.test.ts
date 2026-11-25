import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __getProfileCacheSizeForTests, clearProfileCache, getProfile } from "./profile";

// Mock the dependencies
vi.mock("./design-resume", () => ({
  designResumeToProfile: vi.fn(),
  isLegacyDesignResumeError: vi.fn(),
}));

vi.mock("@server/tenancy/context", () => ({
  getActiveTenantId: vi.fn(() => "tenant_default"),
}));

import { getActiveTenantId } from "@server/tenancy/context";
import { designResumeToProfile, isLegacyDesignResumeError } from "./design-resume";

describe("getProfile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getActiveTenantId).mockReturnValue("tenant_default");
    clearProfileCache();
    vi.mocked(designResumeToProfile).mockResolvedValue(null);
    vi.mocked(isLegacyDesignResumeError).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should throw an error if no base resume has been imported", async () => {
    await expect(getProfile()).rejects.toThrow(
      "Base resume not configured. Import your resume in Settings first.",
    );
  });

  it("should prefer the local Resume Studio document when available", async () => {
    const localProfile = { basics: { name: "Local User" } };
    vi.mocked(designResumeToProfile).mockResolvedValue(localProfile as any);

    const profile = await getProfile();

    expect(designResumeToProfile).toHaveBeenCalledTimes(1);
    expect(profile).toEqual(localProfile);
  });

  it("should cache the local Resume Studio profile", async () => {
    const localProfile = { basics: { name: "Local User" } };
    vi.mocked(designResumeToProfile).mockResolvedValue(localProfile as any);

    await getProfile();
    await getProfile();

    expect(designResumeToProfile).toHaveBeenCalledTimes(1);
  });

  it("should keep local Resume Studio profiles scoped by tenant", async () => {
    vi.mocked(designResumeToProfile)
      .mockResolvedValueOnce({ basics: { name: "Tenant One" } } as any)
      .mockResolvedValueOnce({ basics: { name: "Tenant Two" } } as any);

    vi.mocked(getActiveTenantId).mockReturnValue("tenant-one");
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant One" },
    });
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant One" },
    });

    vi.mocked(getActiveTenantId).mockReturnValue("tenant-two");
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant Two" },
    });

    vi.mocked(getActiveTenantId).mockReturnValue("tenant-one");
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant One" },
    });

    expect(designResumeToProfile).toHaveBeenCalledTimes(2);
  });

  it("should evict inactive tenant profile caches after the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));

    vi.mocked(designResumeToProfile)
      .mockResolvedValueOnce({ basics: { name: "Tenant One" } } as any)
      .mockResolvedValueOnce({ basics: { name: "Tenant Two" } } as any)
      .mockResolvedValueOnce({
        basics: { name: "Tenant One Reloaded" },
      } as any);

    vi.mocked(getActiveTenantId).mockReturnValue("tenant-one");
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant One" },
    });
    expect(__getProfileCacheSizeForTests()).toBe(1);

    vi.advanceTimersByTime(31 * 60 * 1000);
    vi.mocked(getActiveTenantId).mockReturnValue("tenant-two");
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant Two" },
    });
    expect(__getProfileCacheSizeForTests()).toBe(1);

    vi.mocked(getActiveTenantId).mockReturnValue("tenant-one");
    await expect(getProfile()).resolves.toEqual({
      basics: { name: "Tenant One Reloaded" },
    });

    expect(designResumeToProfile).toHaveBeenCalledTimes(3);
  });

  it("should report a missing base resume when the stored document is legacy", async () => {
    vi.mocked(designResumeToProfile).mockRejectedValue(new Error("legacy design resume"));
    vi.mocked(isLegacyDesignResumeError).mockReturnValue(true);

    await expect(getProfile()).rejects.toThrow("Base resume not configured");
  });

  it("should reload the profile when forceRefresh is true", async () => {
    vi.mocked(designResumeToProfile).mockResolvedValue({ basics: { name: "Local User" } } as any);

    await getProfile();
    await getProfile(true);

    expect(designResumeToProfile).toHaveBeenCalledTimes(2);
  });
});
