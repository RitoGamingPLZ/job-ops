import { timingSafeEqual } from "node:crypto";
import { forbidden, unauthorized } from "@infra/errors";
import { fail } from "@infra/http";
import type { NextFunction, Request, Response } from "express";

function getProvidedSecret(req: Request, allowBearer: boolean): string {
  const headerSecret = req.headers["x-internal-sync-secret"];
  if (typeof headerSecret === "string" && headerSecret.trim()) {
    return headerSecret.trim();
  }
  if (!allowBearer) return "";
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return "";
}

export function createInternalSecretGuard(options: {
  allowCronFallback: boolean;
  allowBearer: boolean;
  unconfiguredMessage: string;
  invalidMessage: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const syncSecret = process.env.INTERNAL_SYNC_SECRET?.trim();
    const expectedSecret = options.allowCronFallback
      ? syncSecret || process.env.CRON_SECRET?.trim()
      : syncSecret;
    if (!expectedSecret) {
      fail(res, forbidden(options.unconfiguredMessage));
      return;
    }

    const providedSecret = getProvidedSecret(req, options.allowBearer);
    const expectedBuffer = Buffer.from(expectedSecret, "utf8");
    const providedBuffer = Buffer.from(providedSecret, "utf8");
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      fail(res, unauthorized(options.invalidMessage));
      return;
    }

    next();
  };
}

export const verifyInternalScrapeSecret = createInternalSecretGuard({
  allowCronFallback: true,
  allowBearer: true,
  unconfiguredMessage: "Internal scrape execution is not configured.",
  invalidMessage: "Invalid internal scrape secret.",
});
