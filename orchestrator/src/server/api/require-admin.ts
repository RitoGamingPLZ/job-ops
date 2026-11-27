import { forbidden } from "@infra/errors";
import { fail } from "@infra/http";
import { isSystemAdmin } from "@infra/request-context";
import { currentUserHasPermission } from "@server/services/user-permissions";
import type { UserPermissionKey } from "@shared/types";
import type { NextFunction, Request, Response } from "express";

/** Route guard for features that act on the shared server rather than one workspace. */
export function requireSystemAdminMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (requireSystemAdmin(res)) next();
}

export function requireSystemAdmin(res: Response): boolean {
  if (isSystemAdmin()) return true;
  fail(res, forbidden("System admin access is required"));
  return false;
}

/** Route guard for a feature an admin can switch on or off per user. */
export function requirePermissionMiddleware(permission: UserPermissionKey) {
  return requireAnyPermissionMiddleware(permission);
}

/** Route guard requiring at least one of the listed per-user permissions. */
export function requireAnyPermissionMiddleware(...permissions: UserPermissionKey[]) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      for (const permission of permissions) {
        if (await currentUserHasPermission(permission)) {
          next();
          return;
        }
      }
      fail(res, forbidden("This feature is not enabled for your account. Ask an admin."));
    } catch (error) {
      next(error);
    }
  };
}

export const requireJobs = requirePermissionMiddleware("jobs");
export const requireInProgress = requirePermissionMiddleware("inProgress");
export const requireResumes = requirePermissionMiddleware("resumes");
export const requireJobsOrInProgress = requireAnyPermissionMiddleware("jobs", "inProgress");
