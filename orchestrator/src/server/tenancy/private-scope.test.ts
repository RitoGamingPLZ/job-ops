import { basename, dirname } from "node:path";
import { runWithRequestContext } from "@infra/request-context";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  getPrivateCloudflareCookieStorageDir,
  getRequiredUserScope,
  requiredUserScopeFilter,
} from "./private-scope";

const testTable = sqliteTable("test_user_scoped", {
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
});

describe("private Cloudflare cookie storage", () => {
  it("uses distinct directories for different tenants", () => {
    const forTenant = (tenantId: string) =>
      runWithRequestContext({ requestId: "test", tenantId }, () =>
        getPrivateCloudflareCookieStorageDir(),
      );

    const tenantA = forTenant("tenant-a");
    const tenantB = forTenant("tenant-b");
    expect(tenantA).not.toBe(tenantB);
    expect(forTenant("tenant-a")).toBe(tenantA);
    expect(basename(dirname(tenantA))).toBe("cloudflare-cookies");
    expect(basename(tenantA)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("requiredUserScopeFilter", () => {
  it("requires a non-null userId even outside hosted isolation", () => {
    expect(() =>
      runWithRequestContext({ requestId: "test", tenantId: "tenant-a" }, () =>
        getRequiredUserScope("User context required in test"),
      ),
    ).toThrow("User context required in test");

    const filter = runWithRequestContext(
      { requestId: "test", tenantId: "tenant-a", userId: "user-1" },
      () => requiredUserScopeFilter(testTable),
    );
    expect(filter).toBeDefined();
  });
});
