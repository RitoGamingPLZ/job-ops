import { AppError, badRequest } from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { LlmService } from "@server/services/llm/service";
import { learnRecipe, RecipeLearningError } from "@server/watchlist/careers-site/learn";
import { readListingFacetsLocal } from "@server/watchlist/autofilter/facets/careers-site";
import type {
  RemoteCareersSiteFacetsResult,
  RemoteCareersSiteLearnResult,
  RemoteCareersSiteRunResult,
} from "@server/watchlist/careers-site/remote";
import { runRecipe } from "@server/watchlist/careers-site/run-recipe";
import { recipeSchema, SiteBlockedError } from "@server/watchlist/careers-site/types";
import { json, Router } from "express";
import { z } from "zod";
import { verifyInternalScrapeSecret } from "./internal-auth";

/**
 * Careers-site crawling for deployments whose app server has no browser (Cloudflare Durable
 * Objects). The caller owns every piece of state (recipes, blocks, the LLM connection); this
 * container only drives Playwright/jsdom and returns the result. Nothing is stored here.
 */
const httpsUrl = z.string().url().max(2000);
const runSchema = z.object({
  recipe: recipeSchema,
  sourceUrl: httpsUrl.optional(),
  limit: z.number().int().min(1).max(60),
  budgetMs: z.number().int().min(0).max(25_000),
});
const learnSchema = z.object({
  careersUrl: httpsUrl,
  llm: z.object({
    provider: z.string().max(100).nullable(),
    model: z.string().min(1).max(200),
    baseUrl: z.string().url().max(500).nullable(),
    apiKey: z.string().max(4000).nullable(),
  }),
});

const facetsSchema = z.object({ careersUrl: httpsUrl, filtered: z.boolean() });

const FACETS_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 28_000;
const LEARN_TIMEOUT_MS = 175_000;

export const internalCareersSiteRouter = Router();
internalCareersSiteRouter.use(verifyInternalScrapeSecret, json({ limit: "512kb" }));

internalCareersSiteRouter.post(
  "/facets",
  asyncRoute(async (req, res) => {
    const parsed = facetsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid careers-site facets request.");
    const { careersUrl, filtered } = parsed.data;
    let result: RemoteCareersSiteFacetsResult;
    try {
      const { countFiltered: _omit, ...facets } = await readListingFacetsLocal(
        { careersUrl, signal: AbortSignal.timeout(FACETS_TIMEOUT_MS) },
        filtered,
      );
      result = { kind: "facets", facets };
    } catch (error) {
      if (error instanceof SiteBlockedError) {
        result = { kind: "blocked", reason: error.reason };
      } else {
        // AppError messages are the module's own bounded text; anything else stays generic.
        result = {
          kind: "failed",
          message: error instanceof AppError ? error.message : "Careers facets could not be read.",
        };
        logger.warn("Careers-site facets failed in the scraper container", {
          host: new URL(careersUrl).hostname,
          reason: result.message,
        });
      }
    }
    ok(res, result);
  }),
);

internalCareersSiteRouter.post(
  "/run",
  asyncRoute(async (req, res) => {
    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid careers-site run request.");
    const { recipe, sourceUrl, limit, budgetMs } = parsed.data;
    let result: RemoteCareersSiteRunResult;
    try {
      const jobs = await runRecipe(recipe, {
        limit,
        signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
        stopAt: Date.now() + budgetMs,
        ...(sourceUrl ? { sourceUrl } : {}),
      });
      result = { kind: "jobs", jobs };
    } catch (error) {
      if (error instanceof SiteBlockedError) {
        result = { kind: "blocked", reason: error.reason };
      } else {
        logger.warn("Careers-site run failed in the scraper container", {
          host: new URL(recipe.listing.url).hostname,
        });
        result = { kind: "failed" };
      }
    }
    ok(res, result);
  }),
);

internalCareersSiteRouter.post(
  "/learn",
  asyncRoute(async (req, res) => {
    const parsed = learnSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid careers-site learn request.");
    const { careersUrl, llm } = parsed.data;
    let result: RemoteCareersSiteLearnResult;
    try {
      const recipe = await learnRecipe(careersUrl, {
        signal: AbortSignal.timeout(LEARN_TIMEOUT_MS),
        llm: {
          // Only the caller's own connection: never this container's environment credentials or CLIs.
          service: new LlmService({
            provider: llm.provider,
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            allowEnvironmentCredentials: false,
            allowCliProviders: false,
          }),
          model: llm.model,
        },
      });
      result = { kind: "recipe", recipe };
    } catch (error) {
      if (error instanceof SiteBlockedError) {
        result = { kind: "blocked", reason: error.reason };
      } else {
        // Learner errors are bounded messages that never reflect page text or provider output.
        result = {
          kind: "failed",
          message:
            error instanceof RecipeLearningError
              ? error.message
              : "Careers learning failed outside recipe validation",
        };
        logger.warn("Careers-site learning failed in the scraper container", {
          host: new URL(careersUrl).hostname,
          reason: result.message,
        });
      }
    }
    ok(res, result);
  }),
);
