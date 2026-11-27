import { asyncRoute, ok } from "@infra/http";
import { isDemoMode } from "@server/config/demo";
import { DEMO_PROJECT_CATALOG } from "@server/config/demo-defaults";
import { getProfile } from "@server/services/profile";
import { extractProjectsFromProfile } from "@server/services/resumeProjects";
import { type Request, type Response, Router } from "express";

export const profileRouter = Router();

/**
 * GET /api/profile/projects - Get all projects available in the base resume
 */
profileRouter.get(
  "/projects",
  asyncRoute(async (_req: Request, res: Response) => {
    if (isDemoMode()) {
      ok(res, DEMO_PROJECT_CATALOG);
      return;
    }
    const profile = await getProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    ok(res, catalog);
  }),
);

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const profile = await getProfile();
    ok(res, profile);
  }),
);
