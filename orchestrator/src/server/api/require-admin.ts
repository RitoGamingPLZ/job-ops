import { forbidden } from "@infra/errors";
import { fail } from "@infra/http";
import { isSystemAdmin } from "@infra/request-context";
import { currentUserHasPermission } from "@server/services/user-permissions";
import type { UserPermissionKey } from "@shared/types";
import type { NextFunction, Request, Response } from "express";

/** Route guard for features that act on the shared server rather than one workspace. */
export function requireSystemAdminMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (isSystemAdmin()) {
    next();
    return;
  }
  fail(res, forbidden("System admin access is required"));
}

/** Route guard for a feature an admin can switch on or off per user. */
export function requirePermissionMiddleware(permission: UserPermissionKey) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (await currentUserHasPermission(permission)) {
        next();
        return;
      }
      fail(res, forbidden("This feature is not enabled for your account. Ask an admin."));
    } catch (error) {
      next(error);
    }
  };
}
