import { badRequest } from "@infra/errors";
import { getTenantJobPdfPath, writeStoredJobPdf } from "./pdf-storage";
import { decodeBase64Upload } from "./upload-base64";

type UploadJobPdfInput = {
  jobId: string;
  fileName: string;
  mediaType?: string | null;
  dataBase64: string;
};

const MAX_UPLOAD_PDF_BYTES = 10 * 1024 * 1024;

function normalizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw badRequest("Resume upload requires a file name.");
  }
  if (trimmed.length > 255) {
    throw badRequest("Resume file names must be 255 characters or shorter.");
  }
  return trimmed;
}

function normalizePdfMediaType(input: { fileName: string; mediaType?: string | null }): void {
  const extension = input.fileName.toLowerCase().split(".").pop() ?? "";
  const normalizedMediaType = input.mediaType?.trim().toLowerCase() ?? "";

  if (normalizedMediaType === "application/pdf") {
    return;
  }

  if (
    (!normalizedMediaType || normalizedMediaType === "application/octet-stream") &&
    extension === "pdf"
  ) {
    return;
  }

  throw badRequest("Only PDF resumes are supported.");
}

function assertPdfSignature(decoded: Buffer): void {
  if (decoded.byteLength < 5 || decoded.subarray(0, 5).toString() !== "%PDF-") {
    throw badRequest("Uploaded file must be a valid PDF.");
  }
}

export async function uploadJobPdf(input: UploadJobPdfInput): Promise<{
  outputPath: string;
  byteLength: number;
}> {
  const fileName = normalizeFileName(input.fileName);
  normalizePdfMediaType({
    fileName,
    mediaType: input.mediaType,
  });

  const decoded = decodeBase64Upload({
    dataBase64: input.dataBase64,
    maxBytes: MAX_UPLOAD_PDF_BYTES,
    emptyMessage: "Resume upload requires file data.",
    invalidMessage: "Resume file data must be valid base64.",
    tooLargeMessage: "Resume PDFs must be 10 MB or smaller.",
  });
  assertPdfSignature(decoded);

  const outputPath = getTenantJobPdfPath(input.jobId);
  await writeStoredJobPdf(input.jobId, decoded);

  return {
    outputPath,
    byteLength: decoded.byteLength,
  };
}
