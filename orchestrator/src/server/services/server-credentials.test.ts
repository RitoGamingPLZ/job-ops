import { runWithRequestContext } from "@infra/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantHasServerCredentialAccess = vi.fn();
vi.mock("@server/repositories/users", () => ({
  tenantHasServerCredentialAccess: (...args: unknown[]) => tenantHasServerCredentialAccess(...args),
}));

import {
  canUseServerCredentials,
  clearServerCredentialCache,
  hasOwnExtractorCredentials,
} from "./server-credentials";

describe("canUseServerCredentials", () => {
  beforeEach(() => {
    delete process.env.JOBOPS_APP_MODE;
    delete process.env.JOBOPS_MODE;
    clearServerCredentialCache();
    tenantHasServerCredentialAccess.mockReset();
  });

  it("allows contexts without a tenant (boot tasks, secret webhooks)", async () => {
    expect(await canUseServerCredentials()).toBe(true);
    expect(tenantHasServerCredentialAccess).not.toHaveBeenCalled();
  });

  it("allows system admins without a lookup", async () => {
    const result = await runWithRequestContext(
      { tenantId: "t1", userId: "u1", isSystemAdmin: true },
      canUseServerCredentials,
    );
    expect(result).toBe(true);
    expect(tenantHasServerCredentialAccess).not.toHaveBeenCalled();
  });

  it("denies invited users and caches the lookup per tenant", async () => {
    tenantHasServerCredentialAccess.mockResolvedValue(false);
    const check = (tenantId: string) =>
      runWithRequestContext(
        { tenantId, userId: "u2", isSystemAdmin: false },
        canUseServerCredentials,
      );
    expect(await check("guest-tenant")).toBe(false);
    expect(await check("guest-tenant")).toBe(false);
    expect(tenantHasServerCredentialAccess).toHaveBeenCalledTimes(1);
  });

  it("keeps background work in an admin's workspace trusted", async () => {
    tenantHasServerCredentialAccess.mockResolvedValue(true);
    const result = await runWithRequestContext(
      { tenantId: "admin-tenant", userId: "u1", isSystemAdmin: false },
      canUseServerCredentials,
    );
    expect(result).toBe(true);
  });
});

describe("hasOwnExtractorCredentials", () => {
  it("allows extractors that need no operator credentials", () => {
    expect(hasOwnExtractorCredentials({ id: "indeed" }, {})).toBe(true);
  });

  it("blocks env-backed extractors for users without their own credentials", () => {
    expect(
      hasOwnExtractorCredentials(
        { id: "adzuna", requiredEnvVars: ["ADZUNA_APP_ID"] },
        {
          adzunaAppId: "x",
        },
      ),
    ).toBe(false);
    expect(hasOwnExtractorCredentials({ id: "seek", requiredEnvVars: ["APIFY_TOKEN"] }, {})).toBe(
      false,
    );
  });

  it("lets UKVisaJobs run on the user's saved login only", () => {
    const manifest = { id: "ukvisajobs", requiredEnvVars: ["UKVISAJOBS_EMAIL"] };
    expect(hasOwnExtractorCredentials(manifest, {})).toBe(false);
    expect(
      hasOwnExtractorCredentials(manifest, { ukvisajobsEmail: "a@b.c", ukvisajobsPassword: "pw" }),
    ).toBe(true);
  });
});
