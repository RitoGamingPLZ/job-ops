import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getBlobStore } from "@infra/blob-store";
import { badRequest } from "@infra/errors";
import { getDataDir } from "@server/config/dataDir";
import { getActiveTenantId } from "@server/tenancy/context";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import { decodeBase64Upload } from "./upload-base64";

const MAX_JOB_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type StoredJobDocumentInput = {
  jobId: string;
  fileName: string;
  mediaType?: string | null;
  dataBase64: string;
};

function getTenantJobDocumentsKeyPrefix(jobId: string, tenantId = getActiveTenantId()): string {
  const scope = getPrivateDataScope();
  if (scope.enforceUserIsolation && scope.userId && tenantId === scope.tenantId) {
    return `job-documents/${tenantId}/users/${scope.userId}/${jobId}`;
  }
  return `job-documents/${tenantId}/${jobId}`;
}

function getTenantJobDocumentsDir(jobId: string, tenantId = getActiveTenantId()): string {
  return join(getDataDir(), ...getTenantJobDocumentsKeyPrefix(jobId, tenantId).split("/"));
}

function resolveBlobKeyFromStoragePath(storagePath: string): string | null {
  if (!isAbsolute(storagePath)) {
    const normalized = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized || null;
  }

  const rootDir = resolve(getDataDir());
  const rel = relative(rootDir, resolve(storagePath));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return rel.split(sep).join("/");
}

function normalizeJobDocumentFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw badRequest("Document upload requires a file name.");
  }
  if (trimmed.length > 255) {
    throw badRequest("Document file names must be 255 characters or shorter.");
  }
  return trimmed;
}

function normalizeJobDocumentMediaType(mediaType?: string | null): string | null {
  const normalized = mediaType?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.length > 200) {
    throw badRequest("Document media type must be 200 characters or shorter.");
  }
  return normalized;
}

export async function storeJobDocument(input: StoredJobDocumentInput): Promise<{
  fileName: string;
  mediaType: string | null;
  byteSize: number;
  storagePath: string;
}> {
  const fileName = normalizeJobDocumentFileName(input.fileName);
  const mediaType = normalizeJobDocumentMediaType(input.mediaType);
  const decoded = decodeBase64Upload({
    dataBase64: input.dataBase64,
    maxBytes: MAX_JOB_DOCUMENT_BYTES,
    emptyMessage: "Document upload requires file data.",
    invalidMessage: "Document file data must be valid base64.",
    tooLargeMessage: "Documents must be 10 MB or smaller.",
  });

  const extension = extname(fileName).slice(0, 32);
  const blobKey = `${getTenantJobDocumentsKeyPrefix(input.jobId)}/${randomUUID()}${extension}`;

  await getBlobStore().put(blobKey, decoded, {
    contentType: mediaType,
  });

  const storagePath = join(getDataDir(), ...blobKey.split("/"));

  return {
    fileName,
    mediaType,
    byteSize: decoded.byteLength,
    storagePath,
  };
}

export async function removeStoredJobDocument(storagePath: string): Promise<void> {
  const blobKey = resolveBlobKeyFromStoragePath(storagePath);
  if (blobKey) {
    await getBlobStore().delete(blobKey);
    return;
  }
  await rm(storagePath, { force: true });
}

export async function removeStoredJobDocuments(jobId: string): Promise<void> {
  const prefix = `${getTenantJobDocumentsKeyPrefix(jobId)}/`;
  const blobStore = getBlobStore();
  const entries = await blobStore.list({ prefix });
  await Promise.all(entries.map((entry) => blobStore.delete(entry.key)));
  await rm(getTenantJobDocumentsDir(jobId), {
    recursive: true,
    force: true,
  });
}
