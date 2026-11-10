import { AppError, notFound } from "@infra/errors";
import { getJobResume, saveJobResume } from "@server/repositories/job-resumes";
import { getJobById } from "@server/repositories/jobs";
import type { JobResumeState, ReactiveResumeV5Document } from "@shared/types";
import { loadBaseResumeSource, resolvePdfRenderer } from "./pdf";
import { prepareTailoredResumeForPdf } from "./rxresume";

export type JobResume = JobResumeState;

/** Materialize once, in the active private data scope. Existing editor edits always win. */
export async function ensureJobResume(
  jobId: string,
  opts?: { tailor?: boolean },
): Promise<JobResume> {
  const existing = await getJobResume(jobId);
  if (existing) return existing;
  let job = await getJobById(jobId);
  if (!job) throw notFound("Job not found");
  if (
    opts?.tailor &&
    !(job.tailoredSummary && job.tailoredHeadline && job.tailoredSkills)
  ) {
    const { summarizeJob } = await import("@server/pipeline/orchestrator");
    const result = await summarizeJob(jobId);
    if (!result.success) throw new Error(result.error || "Tailoring failed");
    job = await getJobById(jobId);
    if (!job) throw notFound("Job not found");
  }
  const base = await loadBaseResumeSource({
    renderer: await resolvePdfRenderer(),
  });
  const prepared = await prepareTailoredResumeForPdf({
    resumeData: base.data,
    tailoredContent: {
      summary: job.tailoredSummary,
      headline: job.tailoredHeadline,
      skills: job.tailoredSkills,
    },
    jobDescription: job.jobDescription ?? "",
    selectedProjectIds: job.selectedProjectIds,
  });
  try {
    return await saveJobResume(
      jobId,
      0,
      prepared.data as ReactiveResumeV5Document,
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "CONFLICT") {
      const winner = await getJobResume(jobId);
      if (winner) return winner;
    }
    throw error;
  }
}
