import { badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getExtractorRegistry } from "@server/extractors/registry";
import type { ExtractorSourceId } from "@shared/extractors";
import type { ExtractorRuntimeContext, LocationIntent, SourceLocationPlan } from "@shared/types";
import { type NextFunction, type Request, type Response, Router } from "express";
import { verifyInternalScrapeSecret } from "./internal-auth";

export const internalScrapeRouter = Router();

async function handleInternalScrapeRun(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = (req.body ?? {}) as {
      taskId?: string;
      source?: string;
      target?: string;
      title?: string | null;
      location?: string | null;
      params?: Record<string, unknown>;
    };
    const source = body.source?.trim() as ExtractorSourceId | undefined;
    if (!source) {
      fail(res, badRequest("Missing required 'source' field."));
      return;
    }

    const registry = await getExtractorRegistry();
    const manifest = registry.manifestBySource.get(source);
    if (!manifest) {
      fail(res, notFound(`Unknown extractor source: ${source}`));
      return;
    }

    const params = body.params ?? {};
    const requestedSelectedSources = Array.isArray(params.selectedSources)
      ? params.selectedSources.filter(
          (item): item is string =>
            typeof item === "string" && manifest.providesSources.includes(item.trim()),
        )
      : [];
    const selectedSources =
      requestedSelectedSources.length > 0 ? requestedSelectedSources : [source];
    const searchTerms = Array.isArray(params.searchTerms)
      ? params.searchTerms.filter(
          (term): term is string => typeof term === "string" && term.trim().length > 0,
        )
      : body.title?.trim()
        ? [body.title.trim()]
        : body.target?.trim()
          ? [body.target.trim()]
          : [];

    const selectedCountry =
      typeof params.selectedCountry === "string" && params.selectedCountry.trim()
        ? params.selectedCountry.trim()
        : "";
    const locationIntent =
      params.locationIntent && typeof params.locationIntent === "object"
        ? (params.locationIntent as LocationIntent)
        : undefined;
    const sourceLocationPlan =
      params.sourceLocationPlan && typeof params.sourceLocationPlan === "object"
        ? (params.sourceLocationPlan as SourceLocationPlan)
        : undefined;

    const context: ExtractorRuntimeContext = {
      source,
      selectedSources,
      searchTerms,
      selectedCountry,
      settings:
        params.settings && typeof params.settings === "object" && !Array.isArray(params.settings)
          ? (params.settings as Record<string, string>)
          : {},
      ...(typeof params.cookieStorageDir === "string"
        ? { cookieStorageDir: params.cookieStorageDir }
        : {}),
      ...(locationIntent ? { locationIntent } : {}),
      ...(sourceLocationPlan ? { sourceLocationPlan } : {}),
      ...(typeof params.retryChallengeUrl === "string"
        ? { retryChallengeUrl: params.retryChallengeUrl }
        : {}),
      ...(params.resumeState !== undefined ? { resumeState: params.resumeState } : {}),
      ...(Array.isArray(params.skippedChallengeSearchStates)
        ? {
            skippedChallengeSearchStates: params.skippedChallengeSearchStates.filter(
              (item): item is string => typeof item === "string",
            ),
          }
        : {}),
    };

    const result = await manifest.run(context);
    const postings = result.jobs.map((job) => ({
      jobUrl: job.jobUrl,
      title: job.title,
      employer: job.employer,
      location: job.location ?? null,
      salary: job.salary ?? null,
      datePosted: job.datePosted ?? null,
      description: job.jobDescription ?? null,
    }));

    logger.info("Internal scrape task completed", {
      taskId: body.taskId ?? null,
      source,
      selectedSources,
      extractorSucceeded: result.success,
      postingsCount: postings.length,
      jobsCount: result.jobs.length,
    });

    ok(res, {
      taskId: body.taskId ?? null,
      source,
      extractorSucceeded: result.success,
      jobs: result.jobs,
      postings,
      sourceErrors: result.sourceErrors ?? [],
      ...(result.error ? { error: result.error } : {}),
      ...(result.challengeRequired ? { challengeRequired: result.challengeRequired } : {}),
      ...(result.resumeState !== undefined ? { resumeState: result.resumeState } : {}),
    });
  } catch (error) {
    logger.error("Internal scrape task failed", {
      error: sanitizeUnknown(error),
    });
    next(error);
  }
}

internalScrapeRouter.use(verifyInternalScrapeSecret);
internalScrapeRouter.post("/run", handleInternalScrapeRun);
