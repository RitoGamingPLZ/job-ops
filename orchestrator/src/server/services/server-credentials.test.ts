import { runWithRequestContext } from "@infra/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantHasServerCredentialAccess = vi.fn();
const tenantHasDefaultModelAccess = vi.fn();
const tenantHasSystemAdmin = vi.fn();
const currentUserHasPermission = vi.fn();
const getSetting = vi.fn();
vi.mock("@server/repositories/users", () => ({
  tenantHasDefaultModelAccess: (...args: unknown[]) => tenantHasDefaultModelAccess(...args),
  tenantHasServerCredentialAccess: (...args: unknown[]) => tenantHasServerCredentialAccess(...args),
  tenantHasSystemAdmin: (...args: unknown[]) => tenantHasSystemAdmin(...args),
}));
vi.mock("@server/services/user-permissions", () => ({
  currentUserHasPermission: (...args: unknown[]) => currentUserHasPermission(...args),
}));
vi.mock("@server/repositories/settings", () => ({
  getSetting: (...args: unknown[]) => getSetting(...args),
}));

import {
  canUseDefaultModel,
  canUseServerCredentials,
  clearServerCredentialCache,
  ensureUserHasLlmAccess,
  hasOwnExtractorCredentials,
  isOperatorContext,
} from "./server-credentials";

describe("canUseServerCredentials", () => {
  beforeEach(() => {
    delete process.env.JOBOPS_APP_MODE;
    delete process.env.JOBOPS_MODE;
    clearServerCredentialCache();
    tenantHasServerCredentialAccess.mockReset();
    tenantHasDefaultModelAccess.mockReset();
    tenantHasSystemAdmin.mockReset();
    currentUserHasPermission.mockReset();
    getSetting.mockReset();
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
  });
});

describe("canUseDefaultModel, isOperatorContext, and ensureUserHasLlmAccess", () => {
  beforeEach(() => {
    delete process.env.JOBOPS_APP_MODE;
    delete process.env.JOBOPS_MODE;
    clearServerCredentialCache();
    tenantHasDefaultModelAccess.mockReset();
    tenantHasSystemAdmin.mockReset();
    currentUserHasPermission.mockReset();
    getSetting.mockReset();
  });

  it("checks user permission and cached tenant access for defaultModel", async () => {
    currentUserHasPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(
      await runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: false },
        canUseDefaultModel,
      ),
    ).toBe(false);
    expect(
      await runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: false },
        canUseDefaultModel,
      ),
    ).toBe(true);

    tenantHasDefaultModelAccess.mockResolvedValueOnce(true);
    expect(
      await runWithRequestContext(
        { tenantId: "t1", userId: undefined, isSystemAdmin: false },
        canUseDefaultModel,
      ),
    ).toBe(true);
  });

  it("restricts isOperatorContext for non-admin user requests", async () => {
    expect(
      await runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: false },
        isOperatorContext,
      ),
    ).toBe(false);
    expect(
      await runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: true },
        isOperatorContext,
      ),
    ).toBe(true);
    tenantHasSystemAdmin.mockResolvedValueOnce(true);
    expect(
      await runWithRequestContext(
        { tenantId: "t1", userId: undefined, isSystemAdmin: false },
        isOperatorContext,
      ),
    ).toBe(true);
  });

  it("blocks non-admin local users without defaultModel or own key and allows when either is set", async () => {
    currentUserHasPermission.mockResolvedValue(false);
    getSetting.mockResolvedValue(null);
    await expect(
      runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: false },
        ensureUserHasLlmAccess,
      ),
    ).rejects.toMatchObject({ status: 422, code: "UNPROCESSABLE_ENTITY" });

    getSetting.mockResolvedValue("sk-own-key");
    await expect(
      runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: false },
        ensureUserHasLlmAccess,
      ),
    ).resolves.toBeUndefined();

    getSetting.mockResolvedValue(null);
    currentUserHasPermission.mockResolvedValue(true);
    await expect(
      runWithRequestContext(
        { tenantId: "t1", userId: "u1", isSystemAdmin: false },
        ensureUserHasLlmAccess,
      ),
    ).resolves.toBeUndefined();
  });
});
