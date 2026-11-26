import { asyncRoute, ok, okWithMeta } from "@infra/http";
import { isDemoMode } from "@server/config/demo";
import {
  confirmOnboardingResumeAction,
  getOnboardingStatus,
  saveOnboardingModelAction,
  saveOnboardingProfileAction,
} from "@server/services/onboarding-status";
import { LOCATION_WORKPLACE_TYPE_VALUES } from "@shared/location-domain";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const onboardingRouter = Router();

const modelActionSchema = z.object({
  provider: z.string().trim().min(1).max(100).optional().nullable(),
  baseUrl: z.string().trim().max(2000).optional().nullable(),
  apiKey: z.string().trim().max(2000).optional().nullable(),
  model: z.string().trim().max(200).optional().nullable(),
});

const profileActionSchema = z.object({
  country: z.string().trim().min(1).max(100),
  cities: z.array(z.string().trim().min(1).max(120)).max(20),
  workplaceTypes: z.array(z.enum(LOCATION_WORKPLACE_TYPE_VALUES)).min(1).max(3),
});

const resumeConfirmActionSchema = z.object({
  source: z.string().trim().min(1).max(300),
});

onboardingRouter.get(
  "/status",
  asyncRoute(async (_req: Request, res: Response) => {
    const data = await getOnboardingStatus();
    ok(res, data);
  }),
);

onboardingRouter.post(
  "/actions/profile",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return okWithMeta(res, await getOnboardingStatus(), { simulated: true });
    }
    const data = await saveOnboardingProfileAction(profileActionSchema.parse(req.body ?? {}));
    ok(res, data);
  }),
);

onboardingRouter.post(
  "/actions/model",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return okWithMeta(res, await getOnboardingStatus(), { simulated: true });
    }

    const input = modelActionSchema.parse(req.body ?? {});
    const data = await saveOnboardingModelAction(input);
    ok(res, data);
  }),
);

onboardingRouter.post(
  "/actions/resume/confirm",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return okWithMeta(res, await getOnboardingStatus(), { simulated: true });
    }
    const data = await confirmOnboardingResumeAction(
      resumeConfirmActionSchema.parse(req.body ?? {}),
    );
    ok(res, data);
  }),
);
