import { timingSafeEqual } from "node:crypto";
import { forbidden, unauthorized } from "@infra/errors";
import { fail } from "@infra/http";
import type { NextFunction, Request, Response } from "express";

function getProvidedSecret(req: Request): string {
  const headerSecret = req.headers["x-internal-sync-secret"];
  if (typeof headerSecret === "string" && headerSecret.trim()) {
    return headerSecret.trim();
  }
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return "";
}

export function verifyInternalScrapeSecret(req: Request, res: Response, next: NextFunction): void {
  const expectedSecret =
    process.env.INTERNAL_SYNC_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!expectedSecret) {
    fail(res, forbidden("Internal scrape execution is not configured."));
    return;
  }

  const providedSecret = getProvidedSecret(req);
  const expectedBuffer = Buffer.from(expectedSecret, "utf8");
  const providedBuffer = Buffer.from(providedSecret, "utf8");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    fail(res, unauthorized("Invalid internal scrape secret."));
    return;
  }

  next();
}
