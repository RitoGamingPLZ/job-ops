import { asyncRoute, ok } from "@infra/http";
import { requireSystemAdminMiddleware } from "@server/api/require-admin";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import { clearWorkspaceJobData } from "@server/repositories/workspace-maintenance";
import { type Request, type Response, Router } from "express";

export const databaseRouter = Router();

/**
 * DELETE /api/database - Clear the active workspace's jobs and pipeline runs
 */
databaseRouter.delete(
  "/",
  requireSystemAdminMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
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
  }),
);
