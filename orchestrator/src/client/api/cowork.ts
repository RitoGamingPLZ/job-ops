import type {
  ExperienceBullet,
  ExperienceBulletInput,
  JobResumeState,
  RankedBullet,
  ReactiveResumeV5Document,
  ResumeListItem,
} from "@shared/types";
import { fetchApi } from "./core";

const bulletPath = (id: string) =>
  `/experience-bullets/${encodeURIComponent(id)}`;
const resumePath = (jobId: string) =>
  `/jobs/${encodeURIComponent(jobId)}/resume`;
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
) {
  return fetchApi<{ bullet: ExperienceBullet }>(bulletPath(id), {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export function deleteExperienceBullet(id: string) {
  return fetchApi<{ deleted: true }>(bulletPath(id), { method: "DELETE" });
}
export function importExperienceBulletsFromResume() {
  return fetchApi<{
    created: number;
    skipped: number;
    labeled?: number;
    bullets: ExperienceBullet[];
  }>("/experience-bullets/import-resume", { method: "POST" });
}
export function labelExperienceBullets(
  ids?: string[],
): Promise<{ bullets: ExperienceBullet[]; labeled: number }> {
  return fetchApi<{ bullets: ExperienceBullet[]; labeled: number }>(
    "/experience-bullets/label",
    { method: "POST", body: JSON.stringify(ids ? { ids } : {}) },
  );
}
export function extractExperienceBullets(text: string) {
  return fetchApi<{ drafts: ExperienceBulletInput[] }>(
    "/experience-bullets/extract",
    { method: "POST", body: JSON.stringify({ text }) },
  );
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
  input: { baseRevision: number; document: ReactiveResumeV5Document },
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
