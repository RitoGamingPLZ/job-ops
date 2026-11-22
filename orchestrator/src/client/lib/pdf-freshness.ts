import type { Job, JobListItem } from "@shared/types";
import { isTargeted } from "@shared/types.js";

type PdfFreshnessCarrier = Pick<Job | JobListItem, "pdfFreshness" | "pdfRegenerating">;

export const STALE_PDF_MESSAGE =
  "PDF is out of date. Preview or download renders a fresh one from the editor resume.";

export const PDF_REGENERATING_MESSAGE =
  "PDF is being regenerated after recent changes. You can view or download it again when regeneration finishes.";

export function getPdfFreshness(
  job: PdfFreshnessCarrier | null | undefined,
): PdfFreshnessCarrier["pdfFreshness"] {
  if (job?.pdfRegenerating) return "regenerating";
  return job?.pdfFreshness ?? "missing";
}

export function isPdfStale(job: PdfFreshnessCarrier | null | undefined) {
  return getPdfFreshness(job) === "stale";
}

export function isPdfRegenerating(job: PdfFreshnessCarrier | null | undefined) {
  return getPdfFreshness(job) === "regenerating";
}

/** True when Preview/Download must render the editor resume first. */
export function needsRender(job: PdfFreshnessCarrier | null | undefined) {
  const freshness = getPdfFreshness(job);
  return freshness === "missing" || freshness === "stale";
}

export type ResumeState = "preparing" | "untargeted" | "unprepared" | "available";

/**
 * What a job's resume entry may offer. Opening the editor or previewing
 * before preparation finishes would create an untailored resume, so only
 * "available" shows Open resume / Preview / Download.
 */
export function getResumeState(job: Pick<JobListItem, "status" | "readyAt">): ResumeState {
  if (job.status === "processing") return "preparing";
  if (job.status !== "discovered") return "available";
  return isTargeted(job) ? "unprepared" : "untargeted";
}
