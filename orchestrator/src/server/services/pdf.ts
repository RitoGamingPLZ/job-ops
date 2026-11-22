/**
 * Service for generating PDF resumes from the local Design Resume when available,
 * falling back to the configured Reactive Resume base resume otherwise.
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
import { getJobOpsPublicAvailability } from "@server/infra/public-availability";
import { getSetting } from "@server/repositories/settings";
import { safePdfFileName } from "@shared/filename-sanitizer";
import { settingsRegistry } from "@shared/settings-registry";
import type { DesignResumePdfResponse, PdfPaperSize, PdfRenderer } from "@shared/types";
import { getCurrentDesignResume } from "./design-resume";
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
import {
  deleteResume as deleteRxResume,
  exportResumePdf as exportRxResumePdf,
  getResume as getRxResume,
  importResume as importRxResume,
  type PreparedRxResumePdfPayload,
} from "./rxresume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";
import {
  mergeReactiveResumeV5Content,
  prepareReactiveResumeV5DocumentForExternalUse,
} from "./rxresume/document";
import { applyPdfPaperSizeToResumeData } from "./rxresume/paper-size";
import { parseV5ResumeData } from "./rxresume/schema/v5";
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

async function downloadRxResumePdfBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Reactive Resume PDF download failed with HTTP ${response.status}.`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function stripPictureWhenJobOpsIsNotHosted(args: {
  data: Record<string, unknown>;
  requestOrigin?: string | null;
}): Promise<Record<string, unknown>> {
  const picture =
    args.data.picture && typeof args.data.picture === "object" && !Array.isArray(args.data.picture)
      ? (args.data.picture as Record<string, unknown>)
      : null;
  if (!picture) return args.data;

  const pictureUrl = typeof picture.url === "string" ? picture.url.trim() : "";
  if (!/^\/api\/design-resume\/assets\/[^/]+\/content$/.test(pictureUrl)) {
    return args.data;
  }

  const availability = await getJobOpsPublicAvailability({
    requestOrigin: args.requestOrigin ?? null,
    force: false,
  });
  if (availability.isPubliclyAvailable) {
    return args.data;
  }

  return {
    ...args.data,
    picture: {
      ...picture,
      hidden: true,
      url: "",
    },
  };
}

async function renderRxResumePdfBytes(args: {
  preparedResume: PreparedRxResumePdfPayload;
  jobId: string;
  name?: string;
  requestOrigin?: string | null;
  paperSize: PdfPaperSize;
}): Promise<Uint8Array> {
  const { preparedResume, jobId } = args;
  let importedResumeId: string | null = null;
  const importData = applyPdfPaperSizeToResumeData(
    prepareReactiveResumeV5DocumentForExternalUse(
      await stripPictureWhenJobOpsIsNotHosted({
        data: preparedResume.data,
        requestOrigin: args.requestOrigin ?? null,
      }),
      {
        requestOrigin: args.requestOrigin ?? null,
      },
    ),
    args.paperSize,
  );

  try {
    importedResumeId = await importRxResume({
      name: args.name?.trim() || `JobOps Tailored Resume ${jobId}`,
      data: importData,
    });

    const exportResult = await exportRxResumePdf(importedResumeId);
    if (exportResult.kind === "pdf") {
      return exportResult.bytes;
    }
    return await downloadRxResumePdfBytes(exportResult.url);
  } finally {
    if (importedResumeId) {
      try {
        await deleteRxResume(importedResumeId);
      } catch (error) {
        logger.warn("Failed to clean up temporary Reactive Resume PDF export", {
          jobId,
          importedResumeId,
          error,
        });
      }
    }
  }
}

async function renderLocalResumePdfBytes(args: {
  resumeJson: Record<string, unknown>;
  jobId: string;
  language: Awaited<ReturnType<typeof resolveLocalResumeLanguage>>;
  renderer: Exclude<PdfRenderer, "rxresume">;
  typstTheme?: Awaited<ReturnType<typeof resolveTypstTheme>>;
  paperSize: PdfPaperSize;
}): Promise<Uint8Array> {
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

  if (error instanceof Error && /Reactive Resume|RxResume/i.test(error.message)) {
    return "UPSTREAM_ERROR";
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "REQUEST_TIMEOUT";
  }

  return "INTERNAL_ERROR";
}

async function resolveDesignResumeForRenderer(args: {
  renderer: PdfRenderer;
  requestOrigin?: string | null;
}): Promise<{
  documentId: string;
  title: string;
  data: Record<string, unknown>;
  mode: "v5";
}> {
  const designResume = await getCurrentDesignResume();
  if (!designResume?.resumeJson) {
    throw notFound("The base resume has not been imported yet.");
  }

  const localDocument = parseV5ResumeData(
    designResume.resumeJson as Record<string, unknown>,
  ) as Record<string, unknown>;

  if (
    args.renderer !== "rxresume" ||
    !designResume.sourceResumeId ||
    designResume.sourceMode !== "v5"
  ) {
    return {
      documentId: designResume.id,
      title: designResume.title,
      data: localDocument,
      mode: "v5",
    };
  }

  try {
    const upstreamResume = await getRxResume(designResume.sourceResumeId);

    if (!upstreamResume.data || typeof upstreamResume.data !== "object") {
      throw new Error("Reactive Resume base resume is empty or invalid.");
    }

    const upstreamDocument = parseV5ResumeData(
      upstreamResume.data as Record<string, unknown>,
    ) as Record<string, unknown>;

    return {
      documentId: designResume.id,
      title: designResume.title,
      data: mergeReactiveResumeV5Content(upstreamDocument, localDocument, {
        requestOrigin: args.requestOrigin ?? null,
      }) as Record<string, unknown>,
      mode: "v5",
    };
  } catch (error) {
    logger.warn("Failed to refresh Reactive Resume template metadata for Design Resume rendering", {
      documentId: designResume.id,
      sourceResumeId: designResume.sourceResumeId,
      sourceMode: designResume.sourceMode,
      error,
    });

    return {
      documentId: designResume.id,
      title: designResume.title,
      data: localDocument,
      mode: "v5",
    };
  }
}

export async function loadBaseResumeSource(args: {
  renderer: PdfRenderer;
  requestOrigin?: string | null;
}): Promise<{
  data: Record<string, unknown>;
  mode: "v5";
}> {
  const designResume = await getCurrentDesignResume();
  if (designResume?.resumeJson) {
    if (args.renderer === "rxresume") {
      const resolved = await resolveDesignResumeForRenderer({
        renderer: args.renderer,
        requestOrigin: args.requestOrigin ?? null,
      });
      return {
        data: resolved.data,
        mode: "v5",
      };
    }

    return {
      data: parseV5ResumeData(designResume.resumeJson as Record<string, unknown>) as Record<
        string,
        unknown
      >,
      mode: "v5",
    };
  }

  const { resumeId: baseResumeId } = await getConfiguredRxResumeBaseResumeId();
  if (!baseResumeId) {
    throw conflict("Import or create a resume first");
  }

  const baseResume = await getRxResume(baseResumeId);
  if (!baseResume.data || typeof baseResume.data !== "object") {
    throw new Error("Reactive Resume base resume is empty or invalid.");
  }

  return {
    data: baseResume.data as Record<string, unknown>,
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
  const preparedResume = {
    mode: "v5" as const,
    data,
    projectCatalog: [],
    selectedProjectIds: [],
  };

  const paperSize = await resolvePdfPaperSize();
  if (renderer !== "rxresume") {
    const [language, typstTheme] = await Promise.all([
      resolveLocalResumeLanguage(preparedResume.data, jobDescription),
      renderer === "typst" ? resolveTypstTheme() : Promise.resolve(undefined),
    ]);
    const bytes = await renderLocalResumePdfBytes({
      resumeJson: preparedResume.data,
      jobId,
      language,
      renderer,
      typstTheme,
      paperSize,
    });
    return { bytes, renderer };
  }

  const bytes = await renderRxResumePdfBytes({
    preparedResume,
    jobId,
    requestOrigin: options?.requestOrigin ?? null,
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

async function renderDesignResumePdfBytes(options?: { requestOrigin?: string | null }): Promise<{
  bytes: Uint8Array;
  title: string;
  language: Awaited<ReturnType<typeof resolveLocalResumeLanguage>>;
  renderer: PdfRenderer;
}> {
  const renderer = await resolvePdfRenderer();
  const designResume = await resolveDesignResumeForRenderer({
    renderer,
    requestOrigin: options?.requestOrigin ?? null,
  });
  const preparedResume: PreparedRxResumePdfPayload = {
    mode: "v5",
    data: structuredClone(designResume.data) as Record<string, unknown>,
    projectCatalog: [],
    selectedProjectIds: [],
  };

  const [language, paperSize] = await Promise.all([
    resolveLocalResumeLanguage(designResume.data),
    resolvePdfPaperSize(),
  ]);

  logger.info("Generating Design Resume PDF", {
    renderer,
    documentId: designResume.documentId,
  });

  const bytes =
    renderer !== "rxresume"
      ? await renderLocalResumePdfBytes({
          resumeJson: designResume.data,
          jobId: "design-resume",
          language,
          renderer,
          typstTheme: renderer === "typst" ? await resolveTypstTheme() : undefined,
          paperSize,
        })
      : await renderRxResumePdfBytes({
          preparedResume,
          jobId: "design-resume",
          name: designResume.title,
          requestOrigin: options?.requestOrigin ?? null,
          paperSize,
        });

  return { bytes, title: designResume.title, language, renderer };
}

/**
 * Render an ephemeral PDF preview for the base/design resume without writing to BlobStore/R2.
 */
export async function previewDesignResumePdfBytes(options?: {
  requestOrigin?: string | null;
}): Promise<Uint8Array> {
  const { bytes } = await renderDesignResumePdfBytes(options);
  return bytes;
}

export async function generateDesignResumePdf(options?: {
  requestOrigin?: string | null;
}): Promise<DesignResumePdfResponse> {
  if (getJobOpsAppConfig().appMode !== "hosted") {
    return generateDesignResumePdfImpl(options);
  }
  const { withHostedUsageReservation } = await import("./hosted-usage");
  return withHostedUsageReservation({ action: "pdf_export" }, async () => ({
    result: await generateDesignResumePdfImpl(options),
    usedUnits: 1,
  }));
}

async function generateDesignResumePdfImpl(options?: {
  requestOrigin?: string | null;
}): Promise<DesignResumePdfResponse> {
  const { bytes, title, language } = await renderDesignResumePdfBytes(options);
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
