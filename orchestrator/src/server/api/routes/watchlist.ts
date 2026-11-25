import { badRequest, forbidden, toAppError, unprocessableEntity } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { isSystemAdmin } from "@infra/request-context";
import { listCareerBoardSources } from "@server/config/career-boards";

import { resolveWatchlistSourceGroups } from "@server/config/watchlist-groups";
import * as companyRatingsRepo from "@server/repositories/company-ratings";
import * as watchlistRepo from "@server/repositories/watchlist";
import { getWatchlistSourceAdapter } from "@server/watchlist/adapters";
import {
  getCurrentWatchlistResults,
  getWatchlistSelectedSourceById,
  getWatchlistSourceTypeDescriptors,
  hydrateWatchlistSelectedSources,
  withWatchlistSourceTimeout,
} from "@server/watchlist/results";
import { MAX_WATCHLIST_SOURCES, type WatchlistResultsResponse } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const watchlistRouter = Router();

const watchlistStateParamsSchema = z.object({
  source: z.string().trim().min(1).max(120),
  sourceJobId: z.string().trim().min(1).max(500),
});

const watchlistCheckSchema = z.object({
  checks: z
    .array(
      z.object({
        source: z.string().trim().min(1).max(120),
        sourceJobIds: z.array(z.string().trim().min(1).max(500)).max(200),
      }),
    )
    .max(MAX_WATCHLIST_SOURCES),
});

const updateWatchlistSelectionsSchema = z.object({
  selections: z
    .array(
      z.object({
        catalogSourceId: z.string().trim().min(1).max(500).nullable().optional(),
        sourceType: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(200).nullable().optional(),
        careersUrl: z.string().trim().url().max(2000),
      }),
    )
    .max(MAX_WATCHLIST_SOURCES),
});

const watchlistSourceJobSchema = z.object({
  selectedSourceId: z.string().trim().min(1).max(500),
  jobRef: z.string().trim().min(1).max(3000),
});

const watchlistSourceBrandingSchema = z.object({
  selectedSourceId: z.string().trim().min(1).max(500).nullable().optional(),
  sourceType: z.string().trim().min(1).max(120),
  careersUrl: z.string().trim().url().max(2000),
});

const companyRatingSchema = z.object({
  label: z.string().trim().min(1).max(200),
  wlb: z.number().min(0).max(10).nullable(),
  salary: z.number().min(0).max(10).nullable(),
  source: z.string().trim().min(1).max(60).optional(),
  sourceUrl: z.string().trim().url().max(2000).nullish(),
});

async function getWatchlistSourcesPayload(
  catalogSources: Awaited<ReturnType<typeof listCareerBoardSources>>,
  selectedSources: Awaited<ReturnType<typeof watchlistRepo.listWatchlistSelectedSources>>,
) {
  return {
    catalogSources: await companyRatingsRepo.withCompanyRatings(catalogSources),
    groups: resolveWatchlistSourceGroups(catalogSources),
    selectedSources: hydrateWatchlistSelectedSources(selectedSources),
    availableSourceTypes: getWatchlistSourceTypeDescriptors(),
  };
}

watchlistRouter.get(
  "/states",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, { states: await watchlistRepo.listWatchlistJobStates() });
  }),
);

watchlistRouter.get(
  "/sources",
  asyncRoute(async (_req: Request, res: Response) => {
    const [catalogSources, selectedSources] = await Promise.all([
      listCareerBoardSources(),
      watchlistRepo.listWatchlistSelectedSources(),
    ]);

    ok(res, await getWatchlistSourcesPayload(catalogSources, selectedSources));
  }),
);

/**
 * PUT /api/watchlist/company-ratings - Set one company's 0-10 WLB and salary rating.
 * Ratings are shared across tenants, so only a system admin can change them.
 */
watchlistRouter.put(
  "/company-ratings",
  asyncRoute(async (req: Request, res: Response) => {
    if (!isSystemAdmin()) {
      return fail(res, forbidden("System admin access is required"));
    }
    const parsedBody = companyRatingSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return fail(res, badRequest("Invalid company rating", parsedBody.error.flatten()));
    }

    ok(res, { rating: await companyRatingsRepo.upsertCompanyRating(parsedBody.data) });
  }),
);

watchlistRouter.post(
  "/results",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, (await getCurrentWatchlistResults()) satisfies WatchlistResultsResponse);
  }),
);

watchlistRouter.post(
  "/job-details",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedBody = watchlistSourceJobSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return fail(
        res,
        badRequest("Invalid watchlist job details payload", parsedBody.error.flatten()),
      );
    }

    try {
      const source = await getWatchlistSelectedSourceById(parsedBody.data.selectedSourceId);
      const adapter = getWatchlistSourceAdapter(source.sourceType);
      if (!adapter) {
        return fail(
          res,
          unprocessableEntity("Unsupported watchlist source type", {
            sourceType: source.sourceType,
          }),
        );
      }
      ok(
        res,
        await withWatchlistSourceTimeout((signal) =>
          adapter.fetchJobDetails({
            source,
            jobRef: parsedBody.data.jobRef,
            signal,
          }),
        ),
      );
    } catch (error) {
      fail(res, toAppError(error));
    }
  }),
);

watchlistRouter.post(
  "/import-draft",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedBody = watchlistSourceJobSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return fail(res, badRequest("Invalid watchlist import payload", parsedBody.error.flatten()));
    }

    try {
      const source = await getWatchlistSelectedSourceById(parsedBody.data.selectedSourceId);
      const adapter = getWatchlistSourceAdapter(source.sourceType);
      if (!adapter) {
        return fail(
          res,
          unprocessableEntity("Unsupported watchlist source type", {
            sourceType: source.sourceType,
          }),
        );
      }
      const result = await withWatchlistSourceTimeout((signal) =>
        adapter.prepareImportDraft({
          source,
          jobRef: parsedBody.data.jobRef,
          signal,
        }),
      );

      ok(res, {
        ...result,
        sourceType: source.sourceType,
        catalogSourceId: source.catalogSourceId,
        careersUrl: source.careersUrl,
      });
    } catch (error) {
      fail(res, toAppError(error));
    }
  }),
);

watchlistRouter.post(
  "/source-branding",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedBody = watchlistSourceBrandingSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return fail(
        res,
        badRequest("Invalid watchlist source branding payload", parsedBody.error.flatten()),
      );
    }

    try {
      const selectedSource = parsedBody.data.selectedSourceId
        ? await getWatchlistSelectedSourceById(parsedBody.data.selectedSourceId)
        : null;
      const source = selectedSource ?? {
        sourceType: parsedBody.data.sourceType,
        careersUrl: parsedBody.data.careersUrl,
      };
      const adapter = getWatchlistSourceAdapter(source.sourceType);
      const fetchBranding = adapter?.fetchBranding;
      if (!fetchBranding) {
        return fail(
          res,
          unprocessableEntity("Watchlist source branding is not supported", {
            sourceType: source.sourceType,
          }),
        );
      }

      ok(
        res,
        await withWatchlistSourceTimeout((signal) =>
          fetchBranding({
            source,
            signal,
          }),
        ),
      );
    } catch (error) {
      fail(res, toAppError(error));
    }
  }),
);

watchlistRouter.post(
  "/checks",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedBody = watchlistCheckSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return fail(res, badRequest("Invalid watchlist check payload", parsedBody.error.flatten()));
    }

    ok(res, await watchlistRepo.recordWatchlistCheck(parsedBody.data));
  }),
);

watchlistRouter.put(
  "/sources",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedBody = updateWatchlistSelectionsSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return fail(
        res,
        badRequest("Invalid watchlist source selections", parsedBody.error.flatten()),
      );
    }

    const catalogSources = await listCareerBoardSources();
    const catalogSourcesById = new Map(catalogSources.map((source) => [source.id, source]));
    const normalizedSelections = [];
    const seenUrls = new Set<string>();

    for (const selection of parsedBody.data.selections) {
      const normalizedUrl = selection.careersUrl.trim();
      if (seenUrls.has(normalizedUrl)) {
        return fail(
          res,
          unprocessableEntity("Duplicate watchlist URLs are not allowed", {
            careersUrl: normalizedUrl,
          }),
        );
      }
      seenUrls.add(normalizedUrl);

      if (selection.catalogSourceId) {
        const catalogSource = catalogSourcesById.get(selection.catalogSourceId);
        if (!catalogSource) {
          return fail(
            res,
            unprocessableEntity("Selected watchlist source was not found", {
              catalogSourceId: selection.catalogSourceId,
            }),
          );
        }

        if (catalogSource.careersUrl !== normalizedUrl) {
          return fail(
            res,
            unprocessableEntity("Selected watchlist source URL does not match the catalog", {
              catalogSourceId: selection.catalogSourceId,
              careersUrl: normalizedUrl,
            }),
          );
        }

        normalizedSelections.push({
          catalogSourceId: catalogSource.id,
          sourceType: catalogSource.sourceType,
          label: catalogSource.label,
          careersUrl: catalogSource.careersUrl,
        });
        continue;
      }

      const adapter = getWatchlistSourceAdapter(selection.sourceType);
      if (!adapter) {
        return fail(
          res,
          unprocessableEntity("Unsupported watchlist source type", {
            sourceType: selection.sourceType,
          }),
        );
      }
      if (!adapter.descriptor.supportsCustomSource) {
        return fail(
          res,
          unprocessableEntity("Custom sources are not supported for this source type", {
            sourceType: selection.sourceType,
          }),
        );
      }

      try {
        const normalized = await adapter.normalizeCustomSelection({
          label: selection.label,
          careersUrl: normalizedUrl,
        });
        normalizedSelections.push({
          catalogSourceId: null,
          sourceType: selection.sourceType,
          label: normalized.label,
          careersUrl: normalized.careersUrl,
        });
      } catch (error) {
        return fail(
          res,
          unprocessableEntity(
            `${adapter.descriptor.invalidUrlMessage}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { careersUrl: normalizedUrl },
          ),
        );
      }
    }

    const selectedSources = await watchlistRepo.replaceWatchlistSelectedSources({
      selections: normalizedSelections,
    });

    ok(res, await getWatchlistSourcesPayload(catalogSources, selectedSources));
  }),
);

watchlistRouter.put(
  "/states/:source/:sourceJobId",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedParams = watchlistStateParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return fail(
        res,
        badRequest("Invalid watchlist state parameters", parsedParams.error.flatten()),
      );
    }

    const state = await watchlistRepo.setWatchlistJobState({
      ...parsedParams.data,
      state: "ignored",
    });

    ok(res, { state });
  }),
);

watchlistRouter.delete(
  "/states/:source/:sourceJobId",
  asyncRoute(async (req: Request, res: Response) => {
    const parsedParams = watchlistStateParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return fail(
        res,
        badRequest("Invalid watchlist state parameters", parsedParams.error.flatten()),
      );
    }

    await watchlistRepo.clearWatchlistJobState(parsedParams.data);
    ok(res, { cleared: true });
  }),
);
