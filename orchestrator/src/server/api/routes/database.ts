import { forbidden, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { isSystemAdmin } from "@infra/request-context";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import { clearWorkspaceJobData } from "@server/repositories/workspace-maintenance";
import { type Request, type Response, Router } from "express";

export const databaseRouter = Router();

function requireSystemAdmin(res: Response): boolean {
  if (isSystemAdmin()) return true;
  fail(res, forbidden("System admin access is required"));
  return false;
}

/**
 * DELETE /api/database - Clear the active workspace's jobs and pipeline runs
 */
databaseRouter.delete("/", async (_req: Request, res: Response) => {
  try {
    if (!requireSystemAdmin(res)) return;

    if (isDemoMode()) {
      return sendDemoBlocked(res, "Clearing the database is disabled in the public demo.", {
        route: "DELETE /api/database",
      });
    }

    const result = await clearWorkspaceJobData();

    ok(res, {
      message: "Database cleared",
      jobsDeleted: result.jobsDeleted,
      runsDeleted: result.runsDeleted,
    });
  } catch (error) {
    fail(res, toAppError(error));
  }
});
