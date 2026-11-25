/**
 * API routes for the orchestrator.
 */

import { Router } from "express";
import {
  heavyActionLimiter,
  invitationLimiter,
  loginAccountLimiter,
  loginIpLimiter,
  outboundFetchLimiter,
  pipelineRunLimiter,
  validationLimiter,
} from "./rate-limits";
import { requireAnyPermissionMiddleware, requirePermissionMiddleware } from "./require-admin";
import { appStatusRouter } from "./routes/app-status";
import { authRouter } from "./routes/auth";
import { authSsoRouter } from "./routes/auth-sso";
import { backupRouter } from "./routes/backup";
import { billingRouter } from "./routes/billing";
import { coworkRouter } from "./routes/cowork";
import { databaseRouter } from "./routes/database";
import { demoRouter } from "./routes/demo";
import { designResumeRouter } from "./routes/design-resume";
import { extractorHealthRouter } from "./routes/extractor-health";
import { ghostwriterRouter } from "./routes/ghostwriter";
import { internalD1SyncRouter } from "./routes/internal-d1-sync";
import { internalScrapeRouter } from "./routes/internal-scrape";
import { jobsRouter } from "./routes/jobs";
import { manualJobsRouter } from "./routes/manual-jobs";
import { onboardingRouter } from "./routes/onboarding";
import { pipelineRouter } from "./routes/pipeline";
import { postApplicationProvidersRouter } from "./routes/post-application-providers";
import { postApplicationReviewRouter } from "./routes/post-application-review";
import { profileRouter } from "./routes/profile";
import { settingsRouter } from "./routes/settings";
import { watchlistRouter } from "./routes/watchlist";
import { watchlistAutofilterRouter } from "./routes/watchlist-autofilter";
import { webhookRouter } from "./routes/webhook";
import { workdayRouter } from "./routes/workday";
import { workspacesRouter } from "./routes/workspaces";

export const apiRouter = Router();

apiRouter.use("/auth/login", loginIpLimiter, loginAccountLimiter);
apiRouter.use("/auth/invitations", invitationLimiter);
apiRouter.use(
  "/pipeline/run",
  requirePermissionMiddleware("jobs"),
  requirePermissionMiddleware("pipeline"),
  pipelineRunLimiter,
);
apiRouter.use("/pipeline", requireAnyPermissionMiddleware("jobs", "inProgress"));
apiRouter.use(
  "/manual-jobs/fetch",
  requirePermissionMiddleware("jobs"),
  requirePermissionMiddleware("urlImport"),
);
apiRouter.use("/manual-jobs", requirePermissionMiddleware("jobs"), outboundFetchLimiter);
apiRouter.use("/workday", requirePermissionMiddleware("watchlist"), outboundFetchLimiter);
apiRouter.use("/watchlist", requirePermissionMiddleware("watchlist"), outboundFetchLimiter);
apiRouter.use("/jobs/actions", heavyActionLimiter);
apiRouter.use(
  "/jobs/:id/chat",
  requireAnyPermissionMiddleware("jobs", "inProgress", "resumes"),
  heavyActionLimiter,
);
apiRouter.use("/design-resume", requirePermissionMiddleware("resumes"), heavyActionLimiter);
apiRouter.use("/onboarding/validate", validationLimiter);
apiRouter.use("/settings/llm-models", validationLimiter);
apiRouter.use("/app", appStatusRouter);
apiRouter.use("/billing", billingRouter);
apiRouter.use("/jobs", jobsRouter);
apiRouter.use("/jobs/:id/chat", ghostwriterRouter);
apiRouter.use("/demo", demoRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/pipeline", pipelineRouter);
apiRouter.use("/post-application", requirePermissionMiddleware("emailTracking"));
apiRouter.use("/post-application", postApplicationProvidersRouter);
apiRouter.use("/post-application", postApplicationReviewRouter);
apiRouter.use("/manual-jobs", manualJobsRouter);
apiRouter.use("/webhook", webhookRouter);
apiRouter.use("/internal/d1-sync", internalD1SyncRouter);
apiRouter.use("/internal/scrape", internalScrapeRouter);
apiRouter.use("/profile", profileRouter);
apiRouter.use("/database", databaseRouter);
apiRouter.use("/design-resume", designResumeRouter);
apiRouter.use("/onboarding", onboardingRouter);
apiRouter.use("/backups", backupRouter);
apiRouter.use("/workspaces", workspacesRouter);
apiRouter.use("/auth/sso", authSsoRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/workday", workdayRouter);
apiRouter.use("/watchlist", watchlistRouter);
apiRouter.use("/watchlist", watchlistAutofilterRouter);
apiRouter.use("/", extractorHealthRouter);

apiRouter.use(coworkRouter);
