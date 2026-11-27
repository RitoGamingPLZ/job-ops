import { badRequest, serviceUnavailable, toAppError } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import {
  applyCareersSiteSearch,
  getCareersSiteSearchControls,
  rescanCareersSite,
} from "@server/watchlist/adapters/careers-site";
import { detectWatchlistSourceTypeForUrl } from "@server/watchlist/adapters/detect";
import { suggestFilters } from "@server/watchlist/autofilter/suggest";
import { Router } from "express";
import { z } from "zod";

export const watchlistAutofilterRouter = Router();
const bodySchema = z.object({
  sourceType: z.string().trim().min(1).max(120),
  careersUrl: z.string().trim().url().max(2000),
  label: z.string().trim().min(1).max(200).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  forceRefresh: z.boolean().optional(),
});

// Mounted under the same app auth and tenant-context middleware as watchlist.ts.
watchlistAutofilterRouter.post(
  "/suggest-filters",
  asyncRoute(async (req, res) => {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return fail(res, badRequest("Invalid filter suggestion payload", parsed.error.flatten()));
    try {
      ok(res, await suggestFilters({ ...parsed.data, useCache: true }));
    } catch (error) {
      const unavailable =
        error instanceof Error &&
        (error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          /\b(timed?\s*out|aborted)\b/i.test(error.message));
      fail(
        res,
        unavailable
          ? serviceUnavailable("Filter suggestion request timed out or was aborted")
          : toAppError(error),
      );
    }
  }),
);

// Search controls come from the public recipe of a custom careers site. These routes read that
// recipe only: no model call, no tenant data beyond the URL the caller already holds.
const controlsSchema = z.object({ careersUrl: z.string().trim().url().max(2000) });
const applySchema = controlsSchema.extend({
  values: z
    .record(z.string().min(1).max(60), z.array(z.string().max(120)).max(10))
    .refine((values) => Object.keys(values).length <= 12),
});

watchlistAutofilterRouter.post(
  "/search-controls",
  asyncRoute(async (req, res) => {
    const parsed = controlsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, badRequest("Invalid search controls payload"));
    // Known providers (Greenhouse, Lever, ...) have their own filters; this is for custom sites.
    if (detectWatchlistSourceTypeForUrl(parsed.data.careersUrl) !== "careers_site")
      return ok(res, { status: "unsupported" });
    ok(res, await getCareersSiteSearchControls(parsed.data.careersUrl));
  }),
);

watchlistAutofilterRouter.post(
  "/search-controls/apply",
  asyncRoute(async (req, res) => {
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, badRequest("Invalid search filter payload"));
    ok(res, await applyCareersSiteSearch(parsed.data.careersUrl, parsed.data.values));
  }),
);

watchlistAutofilterRouter.post(
  "/search-controls/rescan",
  asyncRoute(async (req, res) => {
    const parsed = controlsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, badRequest("Invalid search controls payload"));
    if (detectWatchlistSourceTypeForUrl(parsed.data.careersUrl) !== "careers_site")
      return ok(res, { status: "unsupported" });
    await rescanCareersSite(parsed.data.careersUrl);
    ok(res, { status: "learning" });
  }),
);
