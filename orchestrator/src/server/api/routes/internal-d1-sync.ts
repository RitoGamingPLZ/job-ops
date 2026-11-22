import { timingSafeEqual } from "node:crypto";
import { badRequest, forbidden, notFound, toAppError, unauthorized } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import {
  collectD1Changes,
  getContainerHydrationState,
  getD1SyncSchema,
  importTablesFromD1,
  listPdfFiles,
  readPdfFile,
  writePdfFile,
} from "@server/services/d1-sync";
import express, { type NextFunction, type Request, type Response, Router } from "express";

export const internalD1SyncRouter = Router();

function verifyInternalSyncSecret(req: Request, res: Response, next: NextFunction): void {
  const expectedSecret = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!expectedSecret) {
    fail(res, forbidden("Internal D1 sync is not configured."));
    return;
  }

  const providedHeader = req.headers["x-internal-sync-secret"];
  const providedSecret = typeof providedHeader === "string" ? providedHeader.trim() : "";

  const expectedBuffer = Buffer.from(expectedSecret, "utf8");
  const providedBuffer = Buffer.from(providedSecret, "utf8");
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    fail(res, unauthorized("Invalid internal sync secret."));
    return;
  }

  next();
}

internalD1SyncRouter.use(verifyInternalSyncSecret);

internalD1SyncRouter.get("/schema", (_req: Request, res: Response) => {
  try {
    const tables = getD1SyncSchema();
    const { hydrated, userCount } = getContainerHydrationState();
    ok(res, { tables, hydrated, userCount });
  } catch (error) {
    logger.error("Failed to read D1 sync schema", error);
    fail(res, toAppError(error));
  }
});

internalD1SyncRouter.post("/import", (req: Request, res: Response) => {
  try {
    const body = req.body as {
      tables?: Record<string, Array<Record<string, unknown>>>;
      append?: boolean;
    };
    if (!body || typeof body.tables !== "object" || body.tables === null) {
      fail(res, badRequest("Request body must include a 'tables' object."));
      return;
    }

    const result = importTablesFromD1(body.tables, {
      append: Boolean(body.append),
    });
    ok(res, result);
  } catch (error) {
    logger.error("Failed to import D1 tables into SQLite", error);
    fail(res, toAppError(error));
  }
});

internalD1SyncRouter.post("/collect-changes", (_req: Request, res: Response) => {
  try {
    const changes = collectD1Changes();
    ok(res, changes);
  } catch (error) {
    logger.error("Failed to collect SQLite changes for D1", error);
    fail(res, toAppError(error));
  }
});

internalD1SyncRouter.get("/files", (_req: Request, res: Response) => {
  try {
    const files = listPdfFiles();
    ok(res, { files });
  } catch (error) {
    logger.error("Failed to list PDF files for R2 sync", error);
    fail(res, toAppError(error));
  }
});

internalD1SyncRouter.get("/files/:encodedPath", (req: Request, res: Response) => {
  try {
    const encodedPath = Array.isArray(req.params.encodedPath)
      ? req.params.encodedPath[0]
      : req.params.encodedPath;
    const relativePath = decodeURIComponent(encodedPath || "");
    if (!relativePath) {
      fail(res, badRequest("Missing file path."));
      return;
    }
    const buffer = readPdfFile(relativePath);
    if (!buffer) {
      fail(res, notFound("PDF file not found."));
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.status(200).send(buffer);
  } catch (error) {
    logger.error("Failed to read PDF file for R2 sync", error);
    fail(res, toAppError(error));
  }
});

internalD1SyncRouter.put(
  "/files/:encodedPath",
  express.raw({ type: "*/*", limit: "25mb" }),
  (req: Request, res: Response) => {
    try {
      const encodedPath = Array.isArray(req.params.encodedPath)
        ? req.params.encodedPath[0]
        : req.params.encodedPath;
      const relativePath = decodeURIComponent(encodedPath || "");
      if (!relativePath) {
        fail(res, badRequest("Missing file path."));
        return;
      }
      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
      writePdfFile(relativePath, content);
      ok(res, { path: relativePath, bytes: content.byteLength });
    } catch (error) {
      logger.error("Failed to write PDF file from R2 sync", error);
      fail(res, toAppError(error));
    }
  },
);
