import { badRequest, notFound, toAppError } from "@infra/errors";
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
import express, { type Request, type Response, Router } from "express";
import { createInternalSecretGuard } from "./internal-auth";

export const internalD1SyncRouter = Router();

const verifyInternalSyncSecret = createInternalSecretGuard({
  allowCronFallback: false,
  allowBearer: false,
  unconfiguredMessage: "Internal D1 sync is not configured.",
  invalidMessage: "Invalid internal sync secret.",
});

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
