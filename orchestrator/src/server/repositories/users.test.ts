import { useSqliteTestDb } from "../testing/sqlite-test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("users repository", () => {
  const database = useSqliteTestDb();
  beforeEach(async () => {
    await database.open();
  });
  afterEach(database.close);

  it("reports whether a user can sign in with a password", async () => {
    const repo = await import("./users");

    const passwordUser = await repo.createPrivateWorkspaceUser({
      username: "Alice",
      password: "correct horse battery staple",
    });
    const ssoUser = await repo.createSsoProvisionedUser({
      mode: "local",
      username: "Bob",
      displayName: "Bob Smith",
    });

    expect(passwordUser.hasPassword).toBe(true);
    expect(ssoUser).toMatchObject({
      username: "bob",
      displayName: "Bob Smith",
      hasPassword: false,
      isSystemAdmin: false,
    });

    const listed = await repo.listUsers();
    expect(listed.map((user) => [user.username, user.hasPassword]).sort()).toEqual([
      ["alice", true],
      ["bob", false],
    ]);
    expect(Object.keys(listed[0] ?? {})).not.toContain("passwordHash");
  });

  it("leaves the password columns empty for a provisioned user", async () => {
    const repo = await import("./users");
    const { verifyPassword } = await import("@server/auth/password");

    await repo.createSsoProvisionedUser({ mode: "local", username: "bob" });

    const authUser = await repo.getUserForLogin("bob");
    expect(authUser).toMatchObject({
      passwordHash: null,
      passwordSalt: null,
    });
    await expect(
      verifyPassword({
        password: "",
        passwordHash: authUser?.passwordHash ?? null,
        passwordSalt: authUser?.passwordSalt ?? null,
      }),
    ).resolves.toBe(false);
  });

  it("gives a locally provisioned user their own workspace", async () => {
    const repo = await import("./users");

    const first = await repo.createSsoProvisionedUser({
      mode: "local",
      username: "alice",
    });
    const second = await repo.createSsoProvisionedUser({
      mode: "local",
      username: "bob",
    });

    expect(first?.workspaceId).not.toBe(second?.workspaceId);
    expect(first?.workspaceName).toBe("alice");
  });

  it("joins the configured hosted tenant and reports a missing one", async () => {
    const repo = await import("./users");

    const hosted = await repo.createSsoProvisionedUser({
      mode: "hosted",
      username: "alice",
      tenantId: "tenant_default",
    });
    expect(hosted).toMatchObject({
      workspaceId: "tenant_default",
      hasPassword: false,
    });

    await expect(
      repo.createSsoProvisionedUser({
        mode: "hosted",
        username: "bob",
        tenantId: "tenant_missing",
      }),
    ).resolves.toBeNull();
  });
});
