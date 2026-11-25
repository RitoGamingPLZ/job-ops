import type {
  ExperienceBullet,
  ExperienceBulletInput,
  JobResumeState,
  LibraryItemUsage,
  LibrarySyncResult,
  RankedBullet,
  ResumeV5Document,
  ResumeListItem,
  ScreeningReport,
} from "@shared/types";
import { fetchApi } from "./core";

const bulletPath = (id: string) => `/experience-bullets/${encodeURIComponent(id)}`;
const resumePath = (jobId: string) => `/jobs/${encodeURIComponent(jobId)}/resume`;
export function listExperienceBullets() {
  return fetchApi<{ bullets: ExperienceBullet[] }>("/experience-bullets");
}
export function createExperienceBullet(input: ExperienceBulletInput) {
  return fetchApi<{ bullet: ExperienceBullet }>("/experience-bullets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export function updateExperienceBullet(
  id: string,
  input: Partial<ExperienceBulletInput>,
  skipJobId?: string,
) {
  return fetchApi<{ bullet: ExperienceBullet }>(bulletPath(id) + skipQuery(skipJobId), {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function deleteExperienceBullet(id: string, skipJobId?: string) {
  return fetchApi<{ deleted: true }>(bulletPath(id) + skipQuery(skipJobId), {
    method: "DELETE",
  });
}
const skipQuery = (jobId?: string) => (jobId ? `?skipJobId=${encodeURIComponent(jobId)}` : "");
export function listCandidateLibrary() {
  return fetchApi<{ items: ExperienceBullet[] }>("/library");
}
export function getLibraryItemUsage(id: string) {
  return fetchApi<LibraryItemUsage>(`/library/${encodeURIComponent(id)}/usage`);
}
export function syncCandidateLibrary() {
  return fetchApi<LibrarySyncResult>("/library/sync", { method: "POST" });
}
export function extractExperienceBullets(text: string) {
  return fetchApi<{ drafts: ExperienceBulletInput[] }>("/experience-bullets/extract", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}
export function rankExperienceBullets(jobId: string) {
  return fetchApi<{ ranked: RankedBullet[] }>("/experience-bullets/rank", {
    method: "POST",
    body: JSON.stringify({ jobId }),
  });
}
export function getJobResume(jobId: string) {
  return fetchApi<JobResumeState>(resumePath(jobId));
}
export function saveJobResume(
  jobId: string,
  input: { baseRevision: number; document: ResumeV5Document },
) {
  return fetchApi<JobResumeState>(resumePath(jobId), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
export function deleteJobResume(jobId: string) {
  return fetchApi<{ deleted: true }>(resumePath(jobId), { method: "DELETE" });
}
export function listResumes() {
  return fetchApi<{ resumes: ResumeListItem[] }>("/resumes");
}
export function getScreeningReport(jobId: string, document: ResumeV5Document) {
  return fetchApi<ScreeningReport>(`${resumePath(jobId)}/screening`, {
    method: "POST",
    body: JSON.stringify({ document }),
  });
}
