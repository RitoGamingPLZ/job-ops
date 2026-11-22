import { AppError, badRequest, conflict } from "@infra/errors";
import { fail, ok, okWithMeta } from "@infra/http";
import { logger } from "@infra/logger";
import { trackServerProductEvent } from "@infra/product-analytics";
import { isDemoMode } from "@server/config/demo";
import { resolveRequestOrigin } from "@server/infra/request-origin";
import { generateFinalPdf } from "@server/pipeline/index";
import * as jobDocumentsRepo from "@server/repositories/job-documents";
import * as jobsRepo from "@server/repositories/jobs";
import { simulateGeneratePdf } from "@server/services/demo-simulator";
import {
  removeStoredJobDocument,
  storeJobDocument,
} from "@server/services/job-document-storage";
import { uploadJobPdf } from "@server/services/job-pdf-upload";
import { previewJobPdfBytes } from "@server/services/pdf";
import { removeStoredJobPdf } from "@server/services/pdf-storage";
import { getSafeInlineJobDocumentMediaType } from "@shared/job-document-classification.js";
import { type Request, type Response, Router } from "express";
import {
  appErrorFromPipelineFailure,
  hydrateJobPdfFreshness,
  requireJob,
  toJobsRouteError,
  uploadJobDocumentSchema,
  uploadJobPdfSchema,
} from "./shared";

export const jobsDocumentsRouter = Router();

function encodeContentDispositionFileName(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDispositionAttachment(fileName: string): string {
  const fallbackFileName =
    fileName
      .replace(/["\\\r\n]/g, "_")
      .replace(/[^\x20-\x7E]/g, "_")
      .trim() || "document";
  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeContentDispositionFileName(fileName)}`;
}

function removeJobDocumentContentHeaders(res: Response): void {
  res.removeHeader("Cache-Control");
  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Type");
  res.removeHeader("X-Content-Type-Options");
}

function setJobDocumentContentHeaders(
  res: Response,
  document: { fileName: string; mediaType: string | null },
): void {
  const safeInlineMediaType = getSafeInlineJobDocumentMediaType(document);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!safeInlineMediaType) {
    res.setHeader(
      "Content-Disposition",
      contentDispositionAttachment(document.fileName),
    );
    res.type("application/octet-stream");
    return;
  }

  res.setHeader("Content-Disposition", "inline");
  if (safeInlineMediaType === "text/plain") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return;
  }
  res.type(safeInlineMediaType);
}

jobsDocumentsRouter.post(
  "/:id/preview-pdf",
  async (req: Request, res: Response) => {
    try {
      const job = await requireJob(req.params.id);
      const bytes = await previewJobPdfBytes(job.id, job.jobDescription ?? "", {
        requestOrigin: resolveRequestOrigin(req),
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.send(Buffer.from(bytes));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"]("Job PDF preview failed", {
        route: "POST /api/jobs/:id/preview-pdf",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
        details: err.details,
      });
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post("/:id/pdf", async (req: Request, res: Response) => {
  let uploadedPath: string | null = null;

  try {
    const input = uploadJobPdfSchema.parse(req.body);
    const currentJob = await jobsRepo.getJobById(req.params.id);

    if (!currentJob) {
      const err = new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
      logger.warn("Job PDF upload failed", {
        route: "POST /api/jobs/:id/pdf",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
      return;
    }

    const uploaded = await uploadJobPdf({
      jobId: req.params.id,
      fileName: input.fileName,
      mediaType: input.mediaType,
      dataBase64: input.dataBase64,
    });
    uploadedPath = uploaded.outputPath;

    const promotingToReady = currentJob.status === "discovered";
    const job = await jobsRepo.updateJob(req.params.id, {
      pdfPath: uploaded.outputPath,
      pdfSource: "uploaded",
      pdfRegenerating: false,
      pdfFingerprint: null,
      pdfGeneratedAt: new Date().toISOString(),
      ...(promotingToReady ? { status: "ready" } : {}),
    });

    if (!job) {
      await removeStoredJobPdf(req.params.id).catch((cleanupError) => {
        logger.warn("Failed to clean up uploaded PDF after missing job", {
          route: "POST /api/jobs/:id/pdf",
          jobId: req.params.id,
          cleanupError,
        });
      });

      const err = new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
      logger.warn("Job PDF upload failed", {
        route: "POST /api/jobs/:id/pdf",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
      return;
    }

    logger.info("Job PDF uploaded", {
      route: "POST /api/jobs/:id/pdf",
      jobId: req.params.id,
      fileName: input.fileName,
      byteLength: uploaded.byteLength,
    });

    if (promotingToReady) {
      void trackServerProductEvent(
        "job_moved_to_ready",
        {
          origin: "pdf_upload",
        },
        {
          requestOrigin: resolveRequestOrigin(req),
          urlPath: "/jobs",
        },
      );
    }

    ok(res, await hydrateJobPdfFreshness(job), 201);
  } catch (error) {
    const err = toJobsRouteError(error, {
      invalidRequestFallbackMessage: "Invalid job PDF upload request",
    });

    if (uploadedPath) {
      await removeStoredJobPdf(req.params.id).catch((cleanupError) => {
        logger.warn("Failed to clean up uploaded PDF after route error", {
          route: "POST /api/jobs/:id/pdf",
          jobId: req.params.id,
          cleanupError,
        });
      });
    }

    logger.error("Job PDF upload failed", {
      route: "POST /api/jobs/:id/pdf",
      jobId: req.params.id,
      status: err.status,
      code: err.code,
      details: err.details,
      uploadedPath,
    });

    fail(res, err);
  }
});

jobsDocumentsRouter.get(
  "/:id/documents",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      ok(res, await jobDocumentsRepo.listJobDocuments(req.params.id));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Job documents list failed",
        {
          route: "GET /api/jobs/:id/documents",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/documents",
  async (req: Request, res: Response) => {
    let storagePath: string | null = null;

    try {
      const input = uploadJobDocumentSchema.parse(req.body);
      await requireJob(req.params.id);

      const stored = await storeJobDocument({
        jobId: req.params.id,
        fileName: input.fileName,
        mediaType: input.mediaType,
        dataBase64: input.dataBase64,
      });
      storagePath = stored.storagePath;

      const document = await jobDocumentsRepo.createJobDocument({
        jobId: req.params.id,
        fileName: stored.fileName,
        mediaType: stored.mediaType,
        byteSize: stored.byteSize,
        storagePath: stored.storagePath,
      });

      logger.info("Job document uploaded", {
        route: "POST /api/jobs/:id/documents",
        jobId: req.params.id,
        documentId: document.id,
        fileName: document.fileName,
        mediaType: document.mediaType,
        byteSize: document.byteSize,
      });

      ok(res, document, 201);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Invalid job document upload request",
      });

      if (storagePath) {
        await removeStoredJobDocument(storagePath).catch((cleanupError) => {
          logger.warn("Failed to clean up uploaded job document after error", {
            route: "POST /api/jobs/:id/documents",
            jobId: req.params.id,
            cleanupError,
          });
        });
      }

      logger.error("Job document upload failed", {
        route: "POST /api/jobs/:id/documents",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
        details: err.details,
      });

      fail(res, err);
    }
  },
);

jobsDocumentsRouter.get(
  "/:id/documents/:documentId/content",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      const document = await jobDocumentsRepo.getJobDocumentForJob(
        req.params.id,
        req.params.documentId,
      );

      if (!document) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      setJobDocumentContentHeaders(res, document);
      res.sendFile(document.storagePath, (error) => {
        if (error && !res.headersSent) {
          removeJobDocumentContentHeaders(res);
          fail(
            res,
            new AppError({
              status: 404,
              code: "NOT_FOUND",
              message: "Document not found",
            }),
          );
        }
      });
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Job document fetch failed",
        {
          route: "GET /api/jobs/:id/documents/:documentId/content",
          jobId: req.params.id,
          documentId: req.params.documentId,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.delete(
  "/:id/documents/:documentId",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      const document = await jobDocumentsRepo.deleteJobDocumentForJob(
        req.params.id,
        req.params.documentId,
      );

      if (!document) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      await removeStoredJobDocument(document.storagePath).catch((error) => {
        logger.warn("Failed to delete job document file", {
          route: "DELETE /api/jobs/:id/documents/:documentId",
          jobId: req.params.id,
          documentId: req.params.documentId,
          error,
        });
      });

      logger.info("Job document deleted", {
        route: "DELETE /api/jobs/:id/documents/:documentId",
        jobId: req.params.id,
        documentId: req.params.documentId,
      });

      ok(res, null);
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Job document delete failed",
        {
          route: "DELETE /api/jobs/:id/documents/:documentId",
          jobId: req.params.id,
          documentId: req.params.documentId,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/generate-pdf",
  async (req: Request, res: Response) => {
    try {
      if (isDemoMode()) {
        const result = await simulateGeneratePdf(req.params.id);
        if (!result.success) {
          return fail(
            res,
            badRequest(result.error ?? "Failed to generate a resume PDF"),
          );
        }
        const job = await requireJob(req.params.id);
        return okWithMeta(res, await hydrateJobPdfFreshness(job), {
          simulated: true,
        });
      }

      // Preparation owns the render; a second render would race its finalize.
      if ((await requireJob(req.params.id)).status === "processing")
        return fail(
          res,
          conflict("This job's resume is still being prepared."),
        );
      const result = await generateFinalPdf(req.params.id, {
        requestOrigin: resolveRequestOrigin(req),
        analyticsOrigin: "generate_pdf",
      });

      if (!result.success) {
        return fail(
          res,
          appErrorFromPipelineFailure(
            result,
            "Failed to generate a resume PDF",
          ),
        );
      }

      const job = await requireJob(req.params.id);
      ok(res, await hydrateJobPdfFreshness(job));
    } catch (error) {
      fail(res, toJobsRouteError(error));
    }
  },
);
