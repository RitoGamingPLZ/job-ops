import { forbidden } from "@infra/errors";
import { fail } from "@infra/http";
import { isSystemAdmin } from "@infra/request-context";
import { canUseServerCredentials } from "@server/services/server-credentials";
import type { NextFunction, Request, Response } from "express";

/** Route guard for features that act on the shared server rather than one workspace. */
export function requireSystemAdminMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (isSystemAdmin()) {
    next();
    return;
  }
  fail(res, forbidden("System admin access is required"));
}

/** Route guard for features backed by the operator's own integrations (e.g. Gmail OAuth app). */
export async function requireServerCredentialsMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (await canUseServerCredentials()) {
      next();
      return;
    }
    fail(res, forbidden("This feature is not available for your account."));
  } catch (error) {
    next(error);
  }
}
