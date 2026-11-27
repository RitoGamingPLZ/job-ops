import { parseJsonSafely } from "@server/utils/json";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@server/auth/password";
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME } from "@server/tenancy/constants";
import {
  ALL_USER_PERMISSIONS_GRANTED,
  type AuthUser as SharedAuthUser,
  type UserPermissions,
  resolveUserPermissions,
} from "@shared/types";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";

const { tenantMemberships, tenants, users } = schema;

type AuthUser = {
  id: string;
  username: string;
  displayName: string | null;
  passwordHash: string | null;
  passwordSalt: string | null;
  isSystemAdmin: boolean;
  isDisabled: boolean;
  mustChangePassword: boolean;
  tenantId: string;
  tenantName: string;
};

export type PublicUser = SharedAuthUser;

type SsoProvisionedUserInput =
  | {
      mode: "local";
      username: string;
      displayName?: string | null;
    }
  | {
      mode: "hosted";
      username: string;
      displayName?: string | null;
      tenantId: string;
    };

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isUsernameConflictError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: users\.username/i.test(error.message);
}

function slugify(value: string): string {
  return (
    normalizeUsername(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "user"
  );
}

function effectivePermissions(isSystemAdmin: boolean, raw: string | null): UserPermissions {
  if (isSystemAdmin) return { ...ALL_USER_PERMISSIONS_GRANTED };
  return resolveUserPermissions(parseJsonSafely<unknown>(raw, null));
}

function mapUser(row: {
  id: string;
  username: string;
  displayName: string | null;
  isSystemAdmin: boolean;
  isDisabled: boolean;
  mustChangePassword: boolean;
  permissions: string | null;
  passwordHash: string | null;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  updatedAt: string;
}): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isSystemAdmin: row.isSystemAdmin,
    isDisabled: row.isDisabled,
    hasPassword: row.passwordHash !== null,
    mustChangePassword: row.mustChangePassword,
    permissions: effectivePermissions(row.isSystemAdmin, row.permissions),
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(users);
  return row?.count ?? 0;
}

export async function getUserForLogin(username: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      passwordSalt: users.passwordSalt,
      isSystemAdmin: users.isSystemAdmin,
      isDisabled: users.isDisabled,
      mustChangePassword: users.mustChangePassword,
      tenantId: tenantMemberships.tenantId,
      tenantName: tenants.name,
    })
    .from(users)
    .innerJoin(tenantMemberships, eq(tenantMemberships.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(eq(users.username, normalizeUsername(username)))
    .limit(1);

  return row ?? null;
}

/** Users joined to their workspace, shaped for `mapUser`. */
function selectUsersWithWorkspace() {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      isSystemAdmin: users.isSystemAdmin,
      isDisabled: users.isDisabled,
      mustChangePassword: users.mustChangePassword,
      permissions: users.permissions,
      passwordHash: users.passwordHash,
      workspaceId: tenantMemberships.tenantId,
      workspaceName: tenants.name,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .innerJoin(tenantMemberships, eq(tenantMemberships.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId));
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const [row] = await selectUsersWithWorkspace().where(eq(users.id, id)).limit(1);

  return row ? mapUser(row) : null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await selectUsersWithWorkspace();

  return rows.map(mapUser);
}

export async function createPrivateWorkspaceUser(input: {
  username: string;
  password: string;
  displayName?: string | null;
  isSystemAdmin?: boolean;
  mustChangePassword?: boolean;
  useDefaultTenant?: boolean;
  permissions?: Partial<UserPermissions>;
}): Promise<PublicUser> {
  const now = new Date().toISOString();
  const username = normalizeUsername(input.username);
  const userId = randomUUID();
  const tenantId = input.useDefaultTenant ? DEFAULT_TENANT_ID : randomUUID();
  const tenantName = input.displayName?.trim() || username;
  const tenantSlug = input.useDefaultTenant
    ? "default"
    : `${slugify(username)}-${tenantId.slice(0, 8)}`;
  const { passwordHash, passwordSalt } = await hashPassword(input.password);

  db.transaction((tx) => {
    if (input.useDefaultTenant) {
      tx.insert(tenants)
        .values({
          id: DEFAULT_TENANT_ID,
          name: DEFAULT_TENANT_NAME,
          slug: "default",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    } else {
      tx.insert(tenants)
        .values({
          id: tenantId,
          name: tenantName,
          slug: tenantSlug,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    tx.insert(users)
      .values({
        id: userId,
        username,
        displayName: input.displayName?.trim() || null,
        passwordHash,
        passwordSalt,
        isSystemAdmin: input.isSystemAdmin ?? false,
        isDisabled: false,
        mustChangePassword: input.mustChangePassword ?? false,
        permissions: input.permissions
          ? JSON.stringify({ ...resolveUserPermissions(null), ...input.permissions })
          : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.insert(tenantMemberships)
      .values({
        id: randomUUID(),
        userId,
        tenantId,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  const user = await getUserById(userId);
  if (!user) throw new Error("Failed to load created user");
  return user;
}

export async function createHostedTenantUser(input: {
  username: string;
  password: string;
  tenantId: string;
  displayName?: string | null;
}): Promise<PublicUser | null> {
  const now = new Date().toISOString();
  const username = normalizeUsername(input.username);
  const userId = randomUUID();
  const { passwordHash, passwordSalt } = await hashPassword(input.password);

  const created = db.transaction((tx) => {
    const tenant = tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .get();
    if (!tenant) return false;

    tx.insert(users)
      .values({
        id: userId,
        username,
        displayName: input.displayName?.trim() || null,
        passwordHash,
        passwordSalt,
        isSystemAdmin: false,
        isDisabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.insert(tenantMemberships)
      .values({
        id: randomUUID(),
        userId,
        tenantId: input.tenantId,
        role: "member",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return true;
  });

  if (!created) return null;
  const user = await getUserById(userId);
  if (!user) throw new Error("Failed to load created user");
  return user;
}

/**
 * Creates an account for an SSO identity that has no local password yet. The
 * caller is responsible for enforcing the provider's signup policy.
 */
export async function createSsoProvisionedUser(
  input: SsoProvisionedUserInput,
): Promise<PublicUser | null> {
  const now = new Date().toISOString();
  const username = normalizeUsername(input.username);
  const displayName = input.displayName?.trim() || null;
  const userId = randomUUID();

  if (input.mode === "hosted") {
    const hostedTenantId = input.tenantId;
    const created = db.transaction((tx) => {
      const tenant = tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, hostedTenantId))
        .get();
      if (!tenant) return false;

      tx.insert(users)
        .values({
          id: userId,
          username,
          displayName,
          passwordHash: null,
          passwordSalt: null,
          isSystemAdmin: false,
          isDisabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(tenantMemberships)
        .values({
          id: randomUUID(),
          userId,
          tenantId: hostedTenantId,
          role: "member",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return true;
    });

    if (!created) return null;
  } else {
    const tenantId = randomUUID();

    db.transaction((tx) => {
      tx.insert(tenants)
        .values({
          id: tenantId,
          name: displayName || username,
          slug: `${slugify(username)}-${tenantId.slice(0, 8)}`,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(users)
        .values({
          id: userId,
          username,
          displayName,
          passwordHash: null,
          passwordSalt: null,
          isSystemAdmin: false,
          isDisabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(tenantMemberships)
        .values({
          id: randomUUID(),
          userId,
          tenantId,
          role: "owner",
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  }

  const user = await getUserById(userId);
  if (!user) throw new Error("Failed to load created user");
  return user;
}

export async function createInitialSystemAdmin(input: {
  username: string;
  password: string;
  displayName?: string | null;
}): Promise<PublicUser | null> {
  const now = new Date().toISOString();
  const username = normalizeUsername(input.username);
  const userId = randomUUID();
  const { passwordHash, passwordSalt } = await hashPassword(input.password);

  const created = db.transaction((tx) => {
    const existing = tx
      .select({ count: sql<number>`count(*)`.as("count") })
      .from(users)
      .get();
    if ((existing?.count ?? 0) > 0) {
      return false;
    }

    tx.insert(tenants)
      .values({
        id: DEFAULT_TENANT_ID,
        name: DEFAULT_TENANT_NAME,
        slug: "default",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    tx.insert(users)
      .values({
        id: userId,
        username,
        displayName: input.displayName?.trim() || null,
        passwordHash,
        passwordSalt,
        isSystemAdmin: true,
        isDisabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.insert(tenantMemberships)
      .values({
        id: randomUUID(),
        userId,
        tenantId: DEFAULT_TENANT_ID,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return true;
  });

  if (!created) return null;
  const user = await getUserById(userId);
  if (!user) throw new Error("Failed to load created user");
  return user;
}

export async function setUserDisabled(id: string, isDisabled: boolean): Promise<PublicUser | null> {
  await db
    .update(users)
    .set({ isDisabled, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
  return getUserById(id);
}

/**
 * Permanently deletes a user. A workspace left with no members (the normal case for
 * private workspaces) is deleted too, which cascades to all of its data. The shared
 * default workspace is never removed. Returns false when the user does not exist.
 */
export async function deleteUserAndPrivateWorkspace(id: string): Promise<boolean> {
  return db.transaction((tx) => {
    const existing = tx.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
    if (!existing) return false;

    const memberships = tx
      .select({ tenantId: tenantMemberships.tenantId })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.userId, id))
      .all();

    tx.delete(users).where(eq(users.id, id)).run();

    for (const { tenantId } of memberships) {
      if (tenantId === DEFAULT_TENANT_ID) continue;
      const remaining = tx
        .select({ count: sql<number>`count(*)`.as("count") })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, tenantId))
        .get();
      if ((remaining?.count ?? 0) === 0) {
        tx.delete(tenants).where(eq(tenants.id, tenantId)).run();
      }
    }
    return true;
  });
}

export async function updateUserPassword(input: {
  id: string;
  password: string;
  mustChangePassword?: boolean;
}): Promise<void> {
  const { passwordHash, passwordSalt } = await hashPassword(input.password);
  const updates: {
    passwordHash: string;
    passwordSalt: string;
    updatedAt: string;
    mustChangePassword?: boolean;
  } = {
    passwordHash,
    passwordSalt,
    updatedAt: new Date().toISOString(),
  };
  if (input.mustChangePassword !== undefined) {
    updates.mustChangePassword = input.mustChangePassword;
  }
  await db.update(users).set(updates).where(eq(users.id, input.id));
}

async function listEnabledTenantMembers(tenantId: string) {
  return db
    .select({ isSystemAdmin: users.isSystemAdmin, permissions: users.permissions })
    .from(users)
    .innerJoin(tenantMemberships, eq(tenantMemberships.userId, users.id))
    .where(sql`${tenantMemberships.tenantId} = ${tenantId} AND ${users.isDisabled} = 0`);
}

/**
 * True when someone in this workspace may spend the operator's job-source credentials:
 * an enabled system admin, or an enabled member the admin granted `serverCredentials`.
 */
export async function tenantHasServerCredentialAccess(tenantId: string): Promise<boolean> {
  const rows = await listEnabledTenantMembers(tenantId);
  return rows.some(
    (row) => effectivePermissions(row.isSystemAdmin, row.permissions).serverCredentials,
  );
}

/**
 * True when someone in this workspace may use the server's default AI model:
 * an enabled system admin, or an enabled member the admin granted `defaultModel`.
 */
export async function tenantHasDefaultModelAccess(tenantId: string): Promise<boolean> {
  const rows = await listEnabledTenantMembers(tenantId);
  return rows.some((row) => effectivePermissions(row.isSystemAdmin, row.permissions).defaultModel);
}

/**
 * The workspace of the oldest enabled system admin. The admin configures the server's default AI
 * connection (provider, model, key) in that workspace, so users granted `defaultModel` resolve it from here.
 */
export async function getSystemAdminTenantId(): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: tenantMemberships.tenantId })
    .from(tenantMemberships)
    .innerJoin(users, eq(tenantMemberships.userId, users.id))
    .where(sql`${users.isSystemAdmin} = 1 AND ${users.isDisabled} = 0`)
    .orderBy(users.createdAt)
    .limit(1);
  return row?.tenantId ?? null;
}

/** True when an enabled system admin belongs to this workspace. */
export async function tenantHasSystemAdmin(tenantId: string): Promise<boolean> {
  const rows = await listEnabledTenantMembers(tenantId);
  return rows.some((row) => row.isSystemAdmin === true);
}

/** Effective permissions for one user, or null when the user does not exist. */
export async function getUserPermissions(userId: string): Promise<UserPermissions | null> {
  const [row] = await db
    .select({ isSystemAdmin: users.isSystemAdmin, permissions: users.permissions })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? effectivePermissions(row.isSystemAdmin, row.permissions) : null;
}

/** Merges the given keys into the stored permissions. */
export async function setUserPermissions(
  id: string,
  permissions: Partial<UserPermissions>,
): Promise<PublicUser | null> {
  const [existing] = await db
    .select({ permissions: users.permissions })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!existing) return null;

  const merged = {
    ...resolveUserPermissions(parseJsonSafely<unknown>(existing.permissions, null)),
    ...permissions,
  };
  await db
    .update(users)
    .set({ permissions: JSON.stringify(merged), updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));
  return getUserById(id);
}
