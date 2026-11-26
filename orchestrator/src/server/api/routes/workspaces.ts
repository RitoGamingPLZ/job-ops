import { badRequest, conflict, forbidden, notFound, unauthorized } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { getUserId, isSystemAdmin } from "@infra/request-context";
import { verifyPassword } from "@server/auth/password";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import * as authSessionsRepo from "@server/repositories/auth-sessions";
import * as invitationsRepo from "@server/repositories/user-invitations";
import * as usersRepo from "@server/repositories/users";
import { clearServerCredentialCache } from "@server/services/server-credentials";
import {
  clearUserPermissionCache,
  permissionsInputSchema,
} from "@server/services/user-permissions";
import { resolveUserPermissions } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const workspacesRouter = Router();

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(500),
  displayName: z.string().trim().min(1).max(120).optional(),
  isSystemAdmin: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  permissions: permissionsInputSchema.optional(),
});

const updatePermissionsSchema = z.object({
  permissions: permissionsInputSchema,
});

const createInvitationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  permissions: permissionsInputSchema.optional(),
  expiresInDays: z.number().int().min(1).max(invitationsRepo.MAX_INVITATION_TTL_DAYS).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(500),
  mustChangePassword: z.boolean().optional(),
});

const disableUserSchema = z.object({
  isDisabled: z.boolean(),
});

const changeOwnPasswordSchema = z.object({
  password: z.string().min(8).max(500),
  currentPassword: z.string().min(1).max(500).optional(),
});

function requireSystemAdmin(res: Response): boolean {
  if (isSystemAdmin()) return true;
  fail(res, forbidden("System admin access is required"));
  return false;
}

function isUsernameConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /UNIQUE constraint failed: users\.username/i.test(error.message);
}

workspacesRouter.get(
  "/users",
  asyncRoute(async (_req: Request, res: Response) => {
    if (getJobOpsAppConfig().appMode === "hosted") {
      fail(res, forbidden("Workspace user administration is unavailable in hosted mode"));
      return;
    }
    if (!requireSystemAdmin(res)) return;
    ok(res, { users: await usersRepo.listUsers() });
  }),
);

workspacesRouter.post(
  "/users",
  asyncRoute(async (req: Request, res: Response) => {
    if (getJobOpsAppConfig().appMode === "hosted") {
      fail(res, forbidden("Hosted users must be created through hosted signup."));
      return;
    }
    if (!requireSystemAdmin(res)) return;
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }

    try {
      const user = await usersRepo.createPrivateWorkspaceUser({
        username: parsed.data.username,
        password: parsed.data.password,
        displayName: parsed.data.displayName ?? parsed.data.username,
        isSystemAdmin: parsed.data.isSystemAdmin ?? false,
        // Admin-created accounts start with a password the admin knows.
        mustChangePassword: parsed.data.mustChangePassword ?? true,
        ...(parsed.data.permissions ? { permissions: parsed.data.permissions } : {}),
      });
      ok(res, { user }, 201);
      return;
    } catch (error) {
      if (isUsernameConflictError(error)) {
        fail(res, conflict("Username already exists"));
        return;
      }
      throw error;
    }
  }),
);

workspacesRouter.patch(
  "/users/:id/disabled",
  asyncRoute(async (req: Request, res: Response) => {
    if (getJobOpsAppConfig().appMode === "hosted") {
      fail(res, forbidden("Workspace user administration is unavailable in hosted mode"));
      return;
    }
    if (!requireSystemAdmin(res)) return;
    const parsed = disableUserSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }

    const userId = req.params.id;
    if (!userId) {
      fail(res, badRequest("User id is required"));
      return;
    }
    if (userId === getUserId() && parsed.data.isDisabled) {
      fail(res, badRequest("You cannot disable your own user"));
      return;
    }

    const user = await usersRepo.setUserDisabled(userId, parsed.data.isDisabled);
    clearUserPermissionCache();
    clearServerCredentialCache();
    if (!user) {
      fail(res, notFound("User not found"));
      return;
    }
    ok(res, { user });
  }),
);

function requireLocalAdmin(res: Response): boolean {
  if (getJobOpsAppConfig().appMode === "hosted") {
    fail(res, forbidden("Workspace user administration is unavailable in hosted mode"));
    return false;
  }
  return requireSystemAdmin(res);
}

workspacesRouter.patch(
  "/users/:id/permissions",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireLocalAdmin(res)) return;
    const parsed = updatePermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }
    const userId = req.params.id;
    if (!userId) {
      fail(res, badRequest("User id is required"));
      return;
    }
    const existing = await usersRepo.getUserById(userId);
    if (!existing) {
      fail(res, notFound("User not found"));
      return;
    }
    if (existing.isSystemAdmin) {
      fail(res, badRequest("System admins always have every permission"));
      return;
    }

    const user = await usersRepo.setUserPermissions(userId, parsed.data.permissions);
    clearUserPermissionCache();
    clearServerCredentialCache();
    ok(res, { user });
  }),
);

workspacesRouter.get(
  "/invitations",
  asyncRoute(async (_req: Request, res: Response) => {
    if (!requireLocalAdmin(res)) return;
    ok(res, { invitations: await invitationsRepo.listInvitations() });
  }),
);

workspacesRouter.post(
  "/invitations",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireLocalAdmin(res)) return;
    const parsed = createInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }
    const { invitation, token } = await invitationsRepo.createInvitation({
      label: parsed.data.label,
      permissions: resolveUserPermissions(parsed.data.permissions),
      expiresInDays: parsed.data.expiresInDays,
      createdByUserId: getUserId() ?? null,
    });
    // The raw token is also kept on the pending invitation so an admin can copy the link again.
    ok(res, { invitation: { ...invitation, token } }, 201);
  }),
);

workspacesRouter.post(
  "/invitations/:id/regenerate",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireLocalAdmin(res)) return;
    const id = req.params.id;
    const result = id ? await invitationsRepo.regenerateInvitationToken(id) : null;
    if (!result) {
      fail(res, notFound("Pending invitation not found"));
      return;
    }
    ok(res, { invitation: { ...result.invitation, token: result.token } });
  }),
);

workspacesRouter.delete(
  "/invitations/:id",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireLocalAdmin(res)) return;
    const id = req.params.id;
    if (!id || !(await invitationsRepo.deleteInvitation(id))) {
      fail(res, notFound("Invitation not found"));
      return;
    }
    ok(res, { id });
  }),
);

workspacesRouter.delete(
  "/users/:id",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireLocalAdmin(res)) return;
    const userId = req.params.id;
    if (!userId) {
      fail(res, badRequest("User id is required"));
      return;
    }
    if (userId === getUserId()) {
      fail(res, badRequest("You cannot delete your own user"));
      return;
    }
    const existing = await usersRepo.getUserById(userId);
    if (!existing) {
      fail(res, notFound("User not found"));
      return;
    }
    if (existing.isSystemAdmin) {
      fail(res, badRequest("System admins cannot be deleted"));
      return;
    }

    await authSessionsRepo.revokeAuthSessionsForUser(userId);
    await usersRepo.deleteUserAndPrivateWorkspace(userId);
    clearUserPermissionCache();
    clearServerCredentialCache();
    ok(res, { id: userId });
  }),
);

workspacesRouter.post(
  "/users/:id/reset-password",
  asyncRoute(async (req: Request, res: Response) => {
    if (getJobOpsAppConfig().appMode === "hosted") {
      fail(res, forbidden("Workspace user administration is unavailable in hosted mode"));
      return;
    }
    if (!requireSystemAdmin(res)) return;
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }

    const userId = req.params.id;
    if (!userId) {
      fail(res, badRequest("User id is required"));
      return;
    }
    const user = await usersRepo.getUserById(userId);
    if (!user) {
      fail(res, notFound("User not found"));
      return;
    }

    await usersRepo.updateUserPassword({
      id: userId,
      password: parsed.data.password,
      ...(parsed.data.mustChangePassword !== undefined
        ? { mustChangePassword: parsed.data.mustChangePassword }
        : {}),
    });
    await authSessionsRepo.revokeAuthSessionsForUser(userId);
    ok(res, { userId });
  }),
);

workspacesRouter.post(
  "/me/password",
  asyncRoute(async (req: Request, res: Response) => {
    const userId = getUserId();
    if (!userId) {
      fail(res, forbidden("Authenticated user context is required"));
      return;
    }
    const parsed = changeOwnPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, badRequest("Invalid request body", parsed.error.flatten()));
      return;
    }

    const user = await usersRepo.getUserById(userId);
    if (!user) {
      fail(res, notFound("User not found"));
      return;
    }

    // Accounts that only sign in through an identity provider have nothing to
    // prove yet, so they set their first password without one.
    if (user.hasPassword) {
      if (!parsed.data.currentPassword) {
        fail(res, badRequest("Current password is required"));
        return;
      }
      const credentials = await usersRepo.getUserForLogin(user.username);
      const currentPasswordValid = await verifyPassword({
        password: parsed.data.currentPassword,
        passwordHash: credentials?.passwordHash ?? null,
        passwordSalt: credentials?.passwordSalt ?? null,
      });
      if (!currentPasswordValid) {
        fail(res, unauthorized("Current password is incorrect"));
        return;
      }
    }

    await usersRepo.updateUserPassword({
      id: userId,
      password: parsed.data.password,
      mustChangePassword: false,
    });
    ok(res, { userId });
  }),
);
