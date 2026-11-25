import { badRequest, conflict, notFound, toAppError } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { resolveRequestOrigin } from "@infra/request-origin";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import { getBlobStore } from "@server/infra/blob-store";
import { getRequestId } from "@server/infra/request-context";
import {
  deleteDesignResumePicture,
  getCurrentDesignResume,
  getDesignResumeStatus,
  readDesignResumeAssetContent,
  updateCurrentDesignResume,
  uploadDesignResumePicture,
  uploadDesignResumePictureFile,
} from "@server/services/design-resume";
import { importDesignResumeFromFile } from "@server/services/design-resume/import-file";
import { generateDesignResumePdf, previewDesignResumePdfBytes } from "@server/services/pdf";
import {
  getTenantDesignResumePdfKey,
  getTenantDesignResumePdfPath,
} from "@server/services/pdf-storage";
import { clearProfileCache } from "@server/services/profile";
import type { DesignResumeJson, DesignResumePatchRequest } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const designResumeRouter = Router();

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

const jsonPointerSchema = z.string().refine((value) => value === "" || value.startsWith("/"), {
  message: "Patch paths must be valid JSON Pointers.",
});

function valueOperationSchema<const T extends "add" | "replace" | "test">(op: T) {
  return z
    .object({
      op: z.literal(op),
      path: jsonPointerSchema,
      value: z.unknown().optional(),
    })
    .superRefine((value, ctx) => {
      if (!("value" in value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: `Patch ${op} operations require a value.`,
        });
      }
    });
}

function fromOperationSchema<const T extends "move" | "copy">(op: T) {
  return z
    .object({
      op: z.literal(op),
      path: jsonPointerSchema,
      from: jsonPointerSchema.optional(),
    })
    .superRefine((value, ctx) => {
      if (!("from" in value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["from"],
          message: `Patch ${op} operations require a from path.`,
        });
      }
    });
}

const addOperationSchema = valueOperationSchema("add");
const replaceOperationSchema = valueOperationSchema("replace");
const testOperationSchema = valueOperationSchema("test");
const moveOperationSchema = fromOperationSchema("move");
const copyOperationSchema = fromOperationSchema("copy");

const patchOperationSchema = z.union([
  addOperationSchema,
  z.object({
    op: z.literal("remove"),
    path: jsonPointerSchema,
  }),
  replaceOperationSchema,
  moveOperationSchema,
  copyOperationSchema,
  testOperationSchema,
]);

export const designResumePatchSchema = z.object({
  baseRevision: z.number().int().min(1),
  document: z.unknown().optional(),
  operations: z.array(patchOperationSchema).optional(),
});

const pictureMutationSchema = z.object({
  baseRevision: z.number().int().min(1).optional(),
  document: z.unknown().optional(),
});

const uploadSchema = pictureMutationSchema.extend({
  fileName: z.string().trim().min(1).max(255),
  dataUrl: z.string().trim().min(1),
});

const rawUploadHeadersSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .transform((value) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }),
  baseRevision: z.coerce.number().int().min(1).optional(),
});

const importFileSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mediaType: z.string().trim().min(1).max(200).optional(),
  dataBase64: z.string().trim().min(1),
});

function asDesignResumeJson(value: unknown): DesignResumeJson | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DesignResumeJson)
    : undefined;
}

designResumeRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const document = await getCurrentDesignResume();
    if (!document) {
      fail(res, notFound("Base resume has not been imported yet."));
      return;
    }
    ok(res, document);
  }),
);

designResumeRouter.get(
  "/status",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, await getDesignResumeStatus());
  }),
);

designResumeRouter.post(
  "/import/file",
  asyncRoute(async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const requestId = getRequestId();
    const input = importFileSchema.parse(req.body);
    logger.info("Design resume file import route started", {
      requestId: requestId ?? null,
      fileName: input.fileName,
      mediaType: input.mediaType ?? null,
    });
    const document = await importDesignResumeFromFile(input);
    logger.info("Design resume file import route service completed", {
      requestId: requestId ?? null,
      fileName: input.fileName,
      mediaType: input.mediaType ?? null,
      documentId: document.id,
      durationMs: elapsedMs(startedAt),
    });
    clearProfileCache();
    logger.info("Design resume file import route profile cache cleared", {
      requestId: requestId ?? null,
      fileName: input.fileName,
      mediaType: input.mediaType ?? null,
      documentId: document.id,
      durationMs: elapsedMs(startedAt),
    });
    ok(res, document, 201);
    logger.info("Design resume file import route response sent", {
      requestId: requestId ?? null,
      fileName: input.fileName,
      mediaType: input.mediaType ?? null,
      documentId: document.id,
      durationMs: elapsedMs(startedAt),
    });
  }),
);

designResumeRouter.patch(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const input = designResumePatchSchema.parse(req.body) as DesignResumePatchRequest;
    const document = await updateCurrentDesignResume(input);
    clearProfileCache();
    ok(res, document);
  }),
);

designResumeRouter.post(
  "/assets",
  asyncRoute(async (req: Request, res: Response) => {
    if (Buffer.isBuffer(req.body)) {
      const input = rawUploadHeadersSchema.parse({
        fileName: req.header("x-file-name"),
        baseRevision: req.header("x-base-revision"),
      });
      const document = await uploadDesignResumePictureFile({
        fileName: input.fileName,
        mimeType: req.header("content-type"),
        data: req.body,
        baseRevision: input.baseRevision,
      });
      clearProfileCache();
      ok(res, document, 201);
      return;
    }

    const input = uploadSchema.parse(req.body);
    const document = await uploadDesignResumePicture({
      fileName: input.fileName,
      dataUrl: input.dataUrl,
      baseRevision: input.baseRevision,
      document: asDesignResumeJson(input.document),
    });
    clearProfileCache();
    ok(res, document, 201);
  }),
);

designResumeRouter.delete(
  "/assets/picture",
  asyncRoute(async (req: Request, res: Response) => {
    const input = pictureMutationSchema.parse(req.body ?? {});
    const document = await deleteDesignResumePicture({
      baseRevision: input.baseRevision,
      document: asDesignResumeJson(input.document),
    });
    clearProfileCache();
    ok(res, document);
  }),
);

designResumeRouter.get(
  "/assets/:assetId/content",
  asyncRoute(async (req: Request, res: Response) => {
    const assetId = req.params.assetId?.trim();
    if (!assetId) {
      fail(res, badRequest("Asset id is required."));
      return;
    }

    const { asset, content } = await readDesignResumeAssetContent(assetId, {
      bypassTenantScope: getJobOpsAppConfig().appMode !== "hosted",
    });
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(content);
  }),
);

designResumeRouter.post(
  "/preview-pdf",
  asyncRoute(async (req: Request, res: Response) => {
    const bytes = await previewDesignResumePdfBytes();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from(bytes));
  }),
);

designResumeRouter.post(
  "/generate-pdf",
  asyncRoute(async (req: Request, res: Response) => {
    ok(res, await generateDesignResumePdf());
  }),
);

designResumeRouter.get(
  "/pdf",
  asyncRoute(async (_req: Request, res: Response) => {
    const blob = await getBlobStore().get(getTenantDesignResumePdfKey());
    if (blob) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.send(Buffer.from(blob.body));
      return;
    }

    const pdfPath = getTenantDesignResumePdfPath();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(pdfPath, (error) => {
      if (error) {
        fail(res, notFound("Base resume PDF not found"));
      }
    });
  }),
);

designResumeRouter.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
  fail(res, toAppError(error));
});
