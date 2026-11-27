import { asyncRoute, ok } from "@infra/http";
import { reconcileActivationMilestonesFromHistorySafely } from "@server/services/activation-funnel";
import {
  deleteStageEvent,
  getStageEvents,
  transitionStage,
  updateStageEvent,
} from "@server/services/applicationTracking";
import { type Request, type Response, Router } from "express";
import { requireInProgress, requireJobsOrInProgress } from "../../require-admin";
import { transitionStageSchema, updateStageEventSchema } from "./shared";

export const jobsStagesRouter = Router();

jobsStagesRouter.get(
  "/:id/events",
  requireJobsOrInProgress,
  asyncRoute(async (req: Request, res: Response) => {
    const events = await getStageEvents(req.params.id);
    ok(res, events);
  }),
);

jobsStagesRouter.post(
  "/:id/stages",
  requireInProgress,
  asyncRoute(async (req: Request, res: Response) => {
    const input = transitionStageSchema.parse(req.body);
    const event = transitionStage(
      req.params.id,
      input.toStage,
      input.occurredAt ?? undefined,
      input.metadata ?? null,
      input.outcome ?? null,
    );
    ok(res, event);
    queueMicrotask(() => {
      void reconcileActivationMilestonesFromHistorySafely({
        route: "POST /api/jobs/:id/stages",
        jobId: req.params.id,
      });
    });
  }),
);

jobsStagesRouter.patch(
  "/:id/events/:eventId",
  requireInProgress,
  asyncRoute(async (req: Request, res: Response) => {
    const input = updateStageEventSchema.parse(req.body);
    updateStageEvent(req.params.eventId, input);
    ok(res, null);
    queueMicrotask(() => {
      void reconcileActivationMilestonesFromHistorySafely({
        route: "PATCH /api/jobs/:id/events/:eventId",
        jobId: req.params.id,
        eventId: req.params.eventId,
      });
    });
  }),
);

jobsStagesRouter.delete(
  "/:id/events/:eventId",
  requireInProgress,
  asyncRoute(async (req: Request, res: Response) => {
    deleteStageEvent(req.params.eventId);
    ok(res, null);
    queueMicrotask(() => {
      void reconcileActivationMilestonesFromHistorySafely({
        route: "DELETE /api/jobs/:id/events/:eventId",
        jobId: req.params.id,
        eventId: req.params.eventId,
      });
    });
  }),
);
