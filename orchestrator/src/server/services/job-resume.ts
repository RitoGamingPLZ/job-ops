import { AppError, conflict, notFound } from "@infra/errors";
import { listExperienceBullets } from "@server/repositories/experience-bullets";
import { getJobResume, saveJobResume } from "@server/repositories/job-resumes";
import { getJobById, updateJob } from "@server/repositories/jobs";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import {
  isTargeted,
  type JobResumeState,
  type ReactiveResumeV5Document,
} from "@shared/types";
import { syncCandidateLibrary } from "./candidate-library";
import { loadBaseResumeSource, resolvePdfRenderer } from "./pdf";
import { generateResumeFromLibrary } from "./resume-from-library";
import { prepareTailoredResumeForPdf } from "./rxresume";

export type JobResume = JobResumeState;

// ponytail: per-process map; multiple server processes would need a DB lock instead.
const inFlight = new Map<
  string,
  { tailor: boolean; run: Promise<JobResume> }
>();

/** Materialize once, in the active private data scope. Existing editor edits always win. */
export async function ensureJobResume(
  jobId: string,
  opts?: { tailor?: boolean; requestOrigin?: string | null },
): Promise<JobResume> {
  const existing = await getJobResume(jobId);
  if (existing) return existing;
  // Concurrent callers share the running materialization, including its failure.
  const key = `${getPrivateDataScope().scopeKey}:${jobId}`;
  const running = inFlight.get(key);
  if (running && (running.tailor || !opts?.tailor)) return running.run;
  if (running) {
    // A plain run may not tailor: let it finish, then tailor its row unless it was edited.
    const plain = await running.run.catch(() => null);
    if (!plain) return ensureJobResume(jobId, opts);
    if (plain.revision !== 1) return plain;
    // A targeted job's plain run already tailored; saving it again is a no-op revision bump.
    const job = await getJobById(jobId);
    if (
      job &&
      isTargeted(job) &&
      job.tailoredSummary &&
      job.tailoredHeadline &&
      job.tailoredSkills
    )
      return plain;
    return materializeJobResume(jobId, opts, 1);
  }
  const run = materializeJobResume(jobId, opts).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, { tailor: !!opts?.tailor, run });
  return run;
}

/** Explicitly re-tailor, retaining the saved document until generation succeeds. */
export async function regenerateJobResume(
  jobId: string,
  opts?: { requestOrigin?: string | null },
): Promise<JobResume> {
  const existing = await getJobResume(jobId);
  return materializeJobResume(
    jobId,
    { ...opts, tailor: true },
    existing?.revision ?? 0,
    false,
  );
}

async function materializeJobResume(
  jobId: string,
  opts?: { tailor?: boolean; requestOrigin?: string | null },
  baseRevision = 0,
  acceptConcurrentWinner = true,
): Promise<JobResume> {
  const job = await getJobById(jobId);
  if (!job) throw notFound("Job not found");
  const base = await loadBaseResumeSource({
    renderer: await resolvePdfRenderer(),
    requestOrigin: opts?.requestOrigin ?? null,
  });
  let document: ReactiveResumeV5Document;
  if (opts?.tailor || isTargeted(job)) {
    // B's sync imports the base only on the scope's first build. Subsequent
    // syncs add unlinked job facts without resurrecting deleted library facts.
    if (!acceptConcurrentWinner) {
      // Start both reads without yielding around synchronous sync, so only
      // this call's stamping can advance the revision we use for generation.
      const beforeSync = getJobResume(jobId);
      syncCandidateLibrary(base.data as ReactiveResumeV5Document);
      const afterSync = getJobResume(jobId);
      if (((await beforeSync)?.revision ?? 0) !== baseRevision)
        throw conflict("Resume changed. Reload before saving.");
      baseRevision = (await afterSync)?.revision ?? 0;
    } else {
      syncCandidateLibrary(base.data as ReactiveResumeV5Document);
    }
    document = await generateResumeFromLibrary(
      base.data as ReactiveResumeV5Document,
      job,
      await listExperienceBullets(true),
    );
  } else {
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
    document = prepared.data as ReactiveResumeV5Document;
  }
  let saved: JobResume;
  try {
    saved = await saveJobResume(jobId, baseRevision, document);
  } catch (error) {
    if (
      acceptConcurrentWinner &&
      error instanceof AppError &&
      error.code === "CONFLICT"
    ) {
      const winner = await getJobResume(jobId);
      if (winner) return winner;
    }
    throw error;
  }
  if (opts?.tailor || isTargeted(job)) {
    await updateJob(jobId, {
      tailoredHeadline: document.basics.headline,
      tailoredSummary: document.summary.content,
      tailoredSkills: JSON.stringify(
        document.sections.skills.items.map((item) => ({
          name: item.name,
          keywords: item.keywords,
        })),
      ),
    });
  }
  return saved;
}
