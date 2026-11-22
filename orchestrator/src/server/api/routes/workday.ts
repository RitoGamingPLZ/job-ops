import {
  getJobDetailsFromCxs,
  getJobsFromCxs,
  parseWorkdayUrl,
  WorkdayCxsFetchError,
  workdayUrlToCxsJobsUrl,
} from "@career-boards/workday";
import { badRequest, requestTimeout, toAppError, upstreamError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { detectLogoMimeType } from "@infra/image-mime";
import { logger } from "@infra/logger";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const workdayRouter = Router();
const WORKDAY_ROUTE_TIMEOUT_MS = 30000;
const WORKDAY_LOGO_MAX_BYTES = 1_000_000;

const fetchWorkdayJobsSchema = z.object({
  careersUrl: z.string().trim().url().max(2000),
  maxJobs: z.number().int().min(1).max(500).optional(),
});

workdayRouter.post("/fetch-jobs", async (req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKDAY_ROUTE_TIMEOUT_MS);

  try {
    const input = fetchWorkdayJobsSchema.parse(req.body ?? {});

    let cxsJobsUrl: string;
    try {
      cxsJobsUrl = workdayUrlToCxsJobsUrl(input.careersUrl);
    } catch (error) {
      return fail(
        res,
        badRequest(
          `Invalid Workday URL: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    const response = await getJobsFromCxs({
      cxsJobsUrl,
      careersUrl: input.careersUrl,
      maxJobs: input.maxJobs ?? 40,
      signal: controller.signal,
    });

    ok(res, {
      careersUrl: input.careersUrl,
      cxsJobsUrl,
      response,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof Error && error.name === "AbortError") {
      return fail(res, requestTimeout());
    }
    if (error instanceof WorkdayCxsFetchError) {
      return fail(
        res,
        upstreamError(error.message, {
          url: error.url,
          status: error.status,
        }),
      );
    }
    fail(res, toAppError(error));
  } finally {
    clearTimeout(timeout);
  }
});

const fetchWorkdayJobDetailsSchema = z.object({
  jobUrl: z.string().trim().url().max(2000),
});

workdayRouter.post("/fetch-job-details", async (req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKDAY_ROUTE_TIMEOUT_MS);

  try {
    const input = fetchWorkdayJobDetailsSchema.parse(req.body ?? {});
    const response = await getJobDetailsFromCxs({
      jobUrl: input.jobUrl,
      signal: controller.signal,
    });

    ok(res, {
      jobUrl: input.jobUrl,
      response,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof Error && error.name === "AbortError") {
      return fail(res, requestTimeout());
    }
    if (error instanceof WorkdayCxsFetchError) {
      return fail(
        res,
        upstreamError(error.message, {
          url: error.url,
          status: error.status,
        }),
      );
    }
    fail(res, toAppError(error));
  } finally {
    clearTimeout(timeout);
  }
});

const fetchWorkdayLogoSchema = z.object({
  careersUrl: z.string().trim().url().max(2000),
});

workdayRouter.post("/fetch-logo", async (req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKDAY_ROUTE_TIMEOUT_MS);

  try {
    const input = fetchWorkdayLogoSchema.parse(req.body ?? {});

    let logoUrl: string;
    try {
      const parsedUrl = parseWorkdayUrl(input.careersUrl);
      logoUrl = `${parsedUrl.canonicalCareersUrl}/assets/logo`;
    } catch (error) {
      return fail(
        res,
        badRequest(
          `Invalid Workday URL: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    const response = await fetch(logoUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn("Workday logo upstream request failed", {
        route: "/api/workday/fetch-logo",
        careersUrl: input.careersUrl,
        logoUrl,
        status: response.status,
      });
      return fail(
        res,
        upstreamError("Failed to fetch Workday company logo", {
          url: logoUrl,
          status: response.status,
        }),
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > WORKDAY_LOGO_MAX_BYTES) {
      return fail(
        res,
        upstreamError("Workday company logo exceeded size limit", {
          url: logoUrl,
          contentLength,
          maxBytes: WORKDAY_LOGO_MAX_BYTES,
        }),
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > WORKDAY_LOGO_MAX_BYTES) {
      return fail(
        res,
        upstreamError("Workday company logo exceeded size limit", {
          url: logoUrl,
          contentLength: bytes.byteLength,
          maxBytes: WORKDAY_LOGO_MAX_BYTES,
        }),
      );
    }

    const contentTypeHeader = response.headers.get("content-type");
    const mimeType = detectLogoMimeType(bytes, contentTypeHeader);
    if (!mimeType) {
      logger.warn("Workday logo upstream returned non-image content", {
        route: "/api/workday/fetch-logo",
        careersUrl: input.careersUrl,
        logoUrl,
        contentType: contentTypeHeader?.trim() || null,
      });
      return fail(
        res,
        upstreamError("Workday company logo response was not an image", {
          url: logoUrl,
          contentType: contentTypeHeader?.trim() || null,
        }),
      );
    }

    ok(res, {
      careersUrl: input.careersUrl,
      logoUrl,
      mimeType,
      imageDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof Error && error.name === "AbortError") {
      return fail(res, requestTimeout());
    }
    fail(res, toAppError(error));
  } finally {
    clearTimeout(timeout);
  }
});
