import { badRequest, serviceUnavailable, toAppError } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { suggestFilters } from "@server/watchlist/autofilter/suggest";
import { Router } from "express";
import { z } from "zod";

export const watchlistAutofilterRouter = Router();
const bodySchema = z.object({
  sourceType: z.string().trim().min(1).max(120),
  careersUrl: z.string().trim().url().max(2000),
  label: z.string().trim().min(1).max(200).nullable().optional(),
});

// Mounted under the same app auth and tenant-context middleware as watchlist.ts.
watchlistAutofilterRouter.post(
  "/suggest-filters",
  asyncRoute(async (req, res) => {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return fail(
        res,
        badRequest("Invalid filter suggestion payload", parsed.error.flatten()),
      );
    try {
      ok(res, await suggestFilters(parsed.data));
    } catch (error) {
      const unavailable =
        error instanceof Error &&
        (error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          /\b(timed?\s*out|aborted)\b/i.test(error.message));
      fail(
        res,
        unavailable
          ? serviceUnavailable(
              "Filter suggestion request timed out or was aborted",
            )
          : toAppError(error),
      );
    }
  }),
);
