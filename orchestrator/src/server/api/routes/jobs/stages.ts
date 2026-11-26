import { badRequest, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { reconcileActivationMilestonesFromHistorySafely } from "@server/services/activation-funnel";
import {
  deleteStageEvent,
  getStageEvents,
  transitionStage,
  updateStageEvent,
} from "@server/services/applicationTracking";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { requireInProgress, requireJobsOrInProgress } from "../../require-admin";
import { transitionStageSchema, updateStageEventSchema } from "./shared";

export const jobsStagesRouter = Router();

jobsStagesRouter.get(
  "/:id/events",
  requireJobsOrInProgress,
  async (req: Request, res: Response) => {
    try {
      const events = await getStageEvents(req.params.id);
      ok(res, events);
    } catch (error) {
      fail(res, toAppError(error));
    }
  },
);

jobsStagesRouter.post("/:id/stages", requireInProgress, async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    fail(res, toAppError(error));
  }
});

jobsStagesRouter.patch(
  "/:id/events/:eventId",
  requireInProgress,
  async (req: Request, res: Response) => {
    try {
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
    } catch (error) {
      if (error instanceof z.ZodError) {
        return fail(res, badRequest(error.message, error.flatten()));
      }
      fail(res, toAppError(error));
    }
  },
);

jobsStagesRouter.delete(
  "/:id/events/:eventId",
  requireInProgress,
  async (req: Request, res: Response) => {
    try {
      deleteStageEvent(req.params.eventId);
      ok(res, null);
      queueMicrotask(() => {
        void reconcileActivationMilestonesFromHistorySafely({
          route: "DELETE /api/jobs/:id/events/:eventId",
          jobId: req.params.id,
          eventId: req.params.eventId,
        });
      });
    } catch (error) {
      fail(res, toAppError(error));
    }
  },
);
