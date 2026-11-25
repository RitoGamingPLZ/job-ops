/**
 * Service for generating PDF resumes from the local Design Resume.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, type AppErrorCode, conflict, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import { getBlobStore } from "@server/infra/blob-store";
import { getRequestId } from "@server/infra/request-context";
import { getSetting } from "@server/repositories/settings";
import { safePdfFileName } from "@shared/filename-sanitizer";
import { settingsRegistry } from "@shared/settings-registry";
import type { DesignResumePdfResponse, PdfPaperSize, PdfRenderer } from "@shared/types";
import { getCurrentDesignResume, readDesignResumeAssetContent } from "./design-resume";
import { ensureJobResume } from "./job-resume";
import { resolveWritingOutputLanguageForResumeJson } from "./output-language";
import {
  getLegacyJobPdfPath,
  getTenantDesignResumePdfKey,
  getTenantJobPdfKey,
  getTenantJobPdfPath,
  storedJobPdfExists,
  writeStoredJobPdf,
} from "./pdf-storage";
import { renderResumePdf } from "./resume-renderer";
import { buildResumeRenderDocument } from "./resume-renderer/document";
import { parseV5ResumeData } from "./resume-document/schema/v5";
import { getWritingStyle } from "./writing-style";

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
  errorCode?: AppErrorCode;
}

export interface GeneratePdfOptions {
  requestOrigin?: string | null;
}

export async function resolvePdfRenderer(): Promise<PdfRenderer> {
  const storedValue = await getSetting("pdfRenderer");
  return (
    settingsRegistry.pdfRenderer.parse(storedValue ?? undefined) ??
    settingsRegistry.pdfRenderer.default()
  );
}

async function resolvePdfPaperSize(): Promise<PdfPaperSize> {
  const storedValue = await getSetting("pdfPaperSize");
  return (
    settingsRegistry.pdfPaperSize.parse(storedValue ?? undefined) ??
    settingsRegistry.pdfPaperSize.default()
  );
}

async function resolveTypstTheme() {
  const storedValue = await getSetting("typstTheme");
  return (
    settingsRegistry.typstTheme.parse(storedValue ?? undefined) ??
    settingsRegistry.typstTheme.default()
  );
}

async function resolveLocalResumeLanguage(
  resumeJson: Record<string, unknown>,
  jobDescription?: string | null,
) {
  const writingStyle = await getWritingStyle();
  return resolveWritingOutputLanguageForResumeJson({
    style: writingStyle,
    resumeJson,
    jobDescription,
  }).language;
}

// Runtime capability only: never retain tenant-specific documents or assets here.
export type RemotePdfRenderer = (body: string, requestId?: string) => Promise<Uint8Array>;
let remotePdfRenderer: RemotePdfRenderer | null = null;

export function setRemotePdfRenderer(renderer: RemotePdfRenderer | null): void {
  remotePdfRenderer = renderer;
}

async function renderLocalResumePdfBytes(args: {
  resumeJson: Record<string, unknown>;
  jobId: string;
  language: Awaited<ReturnType<typeof resolveLocalResumeLanguage>>;
  renderer: PdfRenderer;
  typstTheme?: Awaited<ReturnType<typeof resolveTypstTheme>>;
  paperSize: PdfPaperSize;
}): Promise<Uint8Array> {
  if (remotePdfRenderer) {
    const picture = buildResumeRenderDocument(args.resumeJson).picture;
    let resolvedPicture: { base64: string; mimeType: string } | undefined;
    if (picture?.assetId && !picture.hidden) {
      // Uses the caller's tenant/user scope and the configured BlobStore (R2 in the DO).
      try {
        const { asset, content } = await readDesignResumeAssetContent(picture.assetId);
        resolvedPicture = { base64: content.toString("base64"), mimeType: asset.mimeType };
      } catch (error) {
        logger.warn("Resume picture unavailable; rendering without photo", {
          jobId: args.jobId,
          error,
        });
      }
    }
    try {
      return await remotePdfRenderer(
        JSON.stringify({ ...args, picture: resolvedPicture }),
        getRequestId(),
      );
    } catch (error) {
      logger.warn("PDF render container request failed", { jobId: args.jobId, error });
      throw error;
    }
  }

  const tempPath = join(tmpdir(), `jobops-resume-${randomUUID()}.pdf`);
  try {
    await renderResumePdf({
      resumeJson: args.resumeJson,
      outputPath: tempPath,
      jobId: args.jobId,
      language: args.language,
      renderer: args.renderer,
      typstTheme: args.typstTheme,
      paperSize: args.paperSize,
    });
    const content = await readFile(tempPath);
    return typeof content === "string"
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function classifyPdfGenerationError(error: unknown): AppErrorCode {
  if (error instanceof AppError) {
    return error.code;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "REQUEST_TIMEOUT";
  }

  return "INTERNAL_ERROR";
}

async function resolveDesignResumeForRenderer(): Promise<{
  documentId: string;
  title: string;
  data: Record<string, unknown>;
  mode: "v5";
}> {
  const designResume = await getCurrentDesignResume();
  if (!designResume?.resumeJson) {
    throw notFound("The base resume has not been imported yet.");
  }

  return {
    documentId: designResume.id,
    title: designResume.title,
    data: parseV5ResumeData(designResume.resumeJson as Record<string, unknown>) as Record<
      string,
      unknown
    >,
    mode: "v5",
  };
}

export async function loadBaseResumeSource(): Promise<{
  data: Record<string, unknown>;
  mode: "v5";
}> {
  const designResume = await getCurrentDesignResume();
  if (!designResume?.resumeJson) {
    throw conflict("Import or create a resume first");
  }
  return {
    data: parseV5ResumeData(designResume.resumeJson as Record<string, unknown>) as Record<
      string,
      unknown
    >,
    mode: "v5",
  };
}

async function renderJobPdfBytes(
  jobId: string,
  jobDescription: string,
  options?: GeneratePdfOptions,
): Promise<{ bytes: Uint8Array; renderer: PdfRenderer }> {
  const renderer = await resolvePdfRenderer();
  logger.info("Generating PDF resume", { jobId, renderer });

  const savedResume = await ensureJobResume(jobId, {
    requestOrigin: options?.requestOrigin ?? null,
  });
  const data = parseV5ResumeData(structuredClone(savedResume.document)) as Record<string, unknown>;
  const paperSize = await resolvePdfPaperSize();
  const [language, typstTheme] = await Promise.all([
    resolveLocalResumeLanguage(data, jobDescription),
    renderer === "typst" ? resolveTypstTheme() : Promise.resolve(undefined),
  ]);
  const bytes = await renderLocalResumePdfBytes({
    resumeJson: data,
    jobId,
    language,
    renderer,
    typstTheme,
    paperSize,
  });
  return { bytes, renderer };
}

/**
 * Render an ephemeral PDF preview for a job without writing to BlobStore/R2.
 */
export async function previewJobPdfBytes(
  jobId: string,
  jobDescription: string,
  options?: GeneratePdfOptions,
): Promise<Uint8Array> {
  const { bytes } = await renderJobPdfBytes(jobId, jobDescription, options);
  return bytes;
}

/**
 * Generate a tailored PDF resume for a job using the configured resume source.
 *
 * Flow:
 * 1. Prepare resume data with tailored content and project selection
 * 2. Normalize the tailored resume into the renderer document model
 * 3. Render a PDF with the active renderer and persist it to BlobStore/R2
 */
export async function generatePdf(
  jobId: string,
  jobDescription: string,
  options?: GeneratePdfOptions,
): Promise<PdfResult> {
  let renderer: PdfRenderer | null = null;

  try {
    const rendered = await renderJobPdfBytes(jobId, jobDescription, options);
    renderer = rendered.renderer;
    await writeStoredJobPdf(jobId, rendered.bytes);

    const outputPath = getTenantJobPdfPath(jobId);
    logger.info("PDF generated successfully", {
      jobId,
      outputPath,
      blobKey: getTenantJobPdfKey(jobId),
      renderer,
    });
    return { success: true, pdfPath: outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("PDF generation failed", { jobId, renderer, error });
    return {
      success: false,
      error: message,
      errorCode: classifyPdfGenerationError(error),
    };
  }
}

async function renderDesignResumePdfBytes(): Promise<{
  bytes: Uint8Array;
  title: string;
  language: Awaited<ReturnType<typeof resolveLocalResumeLanguage>>;
  renderer: PdfRenderer;
}> {
  const renderer = await resolvePdfRenderer();
  const designResume = await resolveDesignResumeForRenderer();
  const [language, paperSize] = await Promise.all([
    resolveLocalResumeLanguage(designResume.data),
    resolvePdfPaperSize(),
  ]);

  logger.info("Generating Design Resume PDF", {
    renderer,
    documentId: designResume.documentId,
  });

  const bytes = await renderLocalResumePdfBytes({
    resumeJson: designResume.data,
    jobId: "design-resume",
    language,
    renderer,
    typstTheme: renderer === "typst" ? await resolveTypstTheme() : undefined,
    paperSize,
  });

  return { bytes, title: designResume.title, language, renderer };
}

/**
 * Render an ephemeral PDF preview for the base/design resume without writing to BlobStore/R2.
 */
export async function previewDesignResumePdfBytes(): Promise<Uint8Array> {
  const { bytes } = await renderDesignResumePdfBytes();
  return bytes;
}

export async function generateDesignResumePdf(): Promise<DesignResumePdfResponse> {
  if (getJobOpsAppConfig().appMode !== "hosted") {
    return generateDesignResumePdfImpl();
  }
  const { withHostedUsageReservation } = await import("./hosted-usage");
  return withHostedUsageReservation({ action: "pdf_export" }, async () => ({
    result: await generateDesignResumePdfImpl(),
    usedUnits: 1,
  }));
}

async function generateDesignResumePdfImpl(): Promise<DesignResumePdfResponse> {
  const { bytes, title, language } = await renderDesignResumePdfBytes();
  const generatedAt = new Date().toISOString();

  await getBlobStore().put(getTenantDesignResumePdfKey(), bytes, {
    contentType: "application/pdf",
  });

  return {
    fileName: safePdfFileName(title, {
      fallbackBase: "Design_Resume",
      language,
    }),
    pdfUrl: `/api/design-resume/pdf?v=${encodeURIComponent(generatedAt)}`,
    generatedAt,
  };
}

/**
 * Check if a PDF exists for a job.
 */
export async function pdfExists(jobId: string): Promise<boolean> {
  if (await storedJobPdfExists(jobId)) {
    return true;
  }
  const pdfPath = getTenantJobPdfPath(jobId);
  try {
    await access(pdfPath);
    return true;
  } catch {
    try {
      await access(getLegacyJobPdfPath(jobId));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the path to a job's PDF.
 */
export function getPdfPath(jobId: string): string {
  const pdfPath = getTenantJobPdfPath(jobId);
  if (existsSync(pdfPath)) return pdfPath;
  return getLegacyJobPdfPath(jobId);
}
