import { join } from "node:path";
import { getBlobStore } from "@infra/blob-store";
import { getDataDir } from "@server/config/dataDir";
import { getActiveTenantId } from "@server/tenancy/context";
import { getPrivateDataScope } from "@server/tenancy/private-scope";

export function getTenantPdfKeyPrefix(tenantId = getActiveTenantId()): string {
  const scope = getPrivateDataScope();
  if (
    scope.enforceUserIsolation &&
    scope.userId &&
    tenantId === scope.tenantId
  ) {
    return `pdfs/${tenantId}/users/${scope.userId}`;
  }
  return `pdfs/${tenantId}`;
}

export function getTenantPdfDir(tenantId = getActiveTenantId()): string {
  return join(getDataDir(), ...getTenantPdfKeyPrefix(tenantId).split("/"));
}

export function getLegacyPdfDir(): string {
  return join(getDataDir(), "pdfs");
}

export function getTenantJobPdfKey(jobId: string): string {
  return `${getTenantPdfKeyPrefix()}/resume_${jobId}.pdf`;
}

export function getLegacyJobPdfKey(jobId: string): string {
  return `pdfs/resume_${jobId}.pdf`;
}

export function getTenantDesignResumePdfKey(): string {
  return `${getTenantPdfKeyPrefix()}/design_resume_current.pdf`;
}

export function getTenantJobPdfPath(jobId: string): string {
  return join(getTenantPdfDir(), `resume_${jobId}.pdf`);
}

export async function removeStoredJobPdf(jobId: string): Promise<void> {
  const blobStore = getBlobStore();
  await blobStore.delete(getTenantJobPdfKey(jobId));
  await blobStore.delete(getLegacyJobPdfKey(jobId));
}

export async function storedJobPdfExists(jobId: string): Promise<boolean> {
  const blobStore = getBlobStore();
  if (await blobStore.exists(getTenantJobPdfKey(jobId))) {
    return true;
  }
  return blobStore.exists(getLegacyJobPdfKey(jobId));
}

export async function readStoredJobPdf(
  jobId: string,
): Promise<Uint8Array | null> {
  const blobStore = getBlobStore();
  const tenantObj = await blobStore.get(getTenantJobPdfKey(jobId));
  if (tenantObj) return tenantObj.body;
  const legacyObj = await blobStore.get(getLegacyJobPdfKey(jobId));
  return legacyObj?.body ?? null;
}

export async function writeStoredJobPdf(
  jobId: string,
  data: Uint8Array | Buffer,
): Promise<void> {
  const blobStore = getBlobStore();
  await blobStore.put(getTenantJobPdfKey(jobId), data, {
    contentType: "application/pdf",
  });
  await blobStore.delete(getLegacyJobPdfKey(jobId));
}

export function getLegacyJobPdfPath(jobId: string): string {
  return join(getLegacyPdfDir(), `resume_${jobId}.pdf`);
}

export function getTenantDesignResumePdfPath(): string {
  return join(getTenantPdfDir(), "design_resume_current.pdf");
}
