import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type UserInvitation,
  type UserInvitationStatus,
  type UserPermissions,
  resolveUserPermissions,
} from "@shared/types";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "../db";

const { userInvitations, users } = schema;

// Explicitly global: invitations are instance-level and are only reachable by a
// system admin or by presenting the secret token.

const DEFAULT_TTL_DAYS = 7;
export const MAX_INVITATION_TTL_DAYS = 30;

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

type InvitationRow = typeof userInvitations.$inferSelect;

function readPermissions(raw: string): UserPermissions {
  try {
    return resolveUserPermissions(JSON.parse(raw));
  } catch {
    return resolveUserPermissions(null);
  }
}

function resolveStatus(row: InvitationRow, now: Date): UserInvitationStatus {
  if (row.revokedAt) return "revoked";
  if (row.usedAt) return "used";
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

function toInvitation(row: InvitationRow, usedByUsername: string | null): UserInvitation {
  const status = resolveStatus(row, new Date());
  return {
    id: row.id,
    label: row.label,
    permissions: readPermissions(row.permissions),
    status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    usedAt: row.usedAt,
    usedByUsername,
    // Only a still-usable link can be copied again. Invitations created before the token was
    // stored have none, and cannot be recovered from the hash.
    token: status === "pending" ? row.token : null,
  };
}

export async function createInvitation(input: {
  label: string;
  permissions: UserPermissions;
  expiresInDays?: number;
  createdByUserId: string | null;
}): Promise<{ invitation: UserInvitation; token: string }> {
  const token = generateToken();
  const days = Math.min(
    Math.max(Math.floor(input.expiresInDays ?? DEFAULT_TTL_DAYS), 1),
    MAX_INVITATION_TTL_DAYS,
  );
  const now = new Date();
  const row: InvitationRow = {
    id: randomUUID(),
    tokenHash: hashInvitationToken(token),
    token,
    label: input.label,
    permissions: JSON.stringify(input.permissions),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    createdByUserId: input.createdByUserId,
    createdAt: now.toISOString(),
    usedAt: null,
    usedByUserId: null,
    revokedAt: null,
  };
  await db.insert(userInvitations).values(row);
  return { invitation: toInvitation(row, null), token };
}

export async function listInvitations(): Promise<UserInvitation[]> {
  const rows = await db
    .select({ invitation: userInvitations, usedByUsername: users.username })
    .from(userInvitations)
    .leftJoin(users, eq(users.id, userInvitations.usedByUserId))
    .orderBy(desc(userInvitations.createdAt));
  return rows.map((row) => toInvitation(row.invitation, row.usedByUsername));
}

/** Looks up a still-usable invitation by its secret token. */
export async function findPendingInvitationByToken(token: string): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.tokenHash, hashInvitationToken(token)),
        isNull(userInvitations.usedAt),
        isNull(userInvitations.revokedAt),
        gt(userInvitations.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function permissionsOfInvitation(row: InvitationRow): UserPermissions {
  return readPermissions(row.permissions);
}

/**
 * Atomically claims a pending invitation so two people cannot redeem one link.
 * Returns false when it was already used, revoked or expired.
 */
export async function claimInvitation(id: string): Promise<boolean> {
  const result = await db
    .update(userInvitations)
    .set({ usedAt: new Date().toISOString() })
    .where(
      and(
        eq(userInvitations.id, id),
        isNull(userInvitations.usedAt),
        isNull(userInvitations.revokedAt),
        gt(userInvitations.expiresAt, new Date().toISOString()),
      ),
    )
    .returning({ id: userInvitations.id });
  return result.length > 0;
}

/** Undoes a claim when the account could not be created (e.g. username taken). */
export async function releaseInvitation(id: string): Promise<void> {
  await db.update(userInvitations).set({ usedAt: null }).where(eq(userInvitations.id, id));
}

export async function recordInvitationUser(id: string, userId: string): Promise<void> {
  // The account exists now, so the raw link is no longer needed.
  await db
    .update(userInvitations)
    .set({ usedByUserId: userId, token: null })
    .where(eq(userInvitations.id, id));
}

/**
 * Deletes an invitation in any status. A pending link stops working immediately; deleting a
 * used invitation only removes its history, the account it created is untouched.
 * Returns false when it does not exist.
 */
export async function deleteInvitation(id: string): Promise<boolean> {
  const result = await db
    .delete(userInvitations)
    .where(eq(userInvitations.id, id))
    .returning({ id: userInvitations.id });
  return result.length > 0;
}
