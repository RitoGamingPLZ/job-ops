import { badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
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
  const tables = getD1SyncSchema();
  const { hydrated, userCount } = getContainerHydrationState();
  ok(res, { tables, hydrated, userCount });
});

internalD1SyncRouter.post("/import", (req: Request, res: Response) => {
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
});

internalD1SyncRouter.post("/collect-changes", (_req: Request, res: Response) => {
  const changes = collectD1Changes();
  ok(res, changes);
});

internalD1SyncRouter.get("/files", (_req: Request, res: Response) => {
  const files = listPdfFiles();
  ok(res, { files });
});

internalD1SyncRouter.get("/files/:encodedPath", (req: Request, res: Response) => {
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
});

internalD1SyncRouter.put(
  "/files/:encodedPath",
  express.raw({ type: "*/*", limit: "25mb" }),
  (req: Request, res: Response) => {
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
  },
);
