import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import { deduplicateJobsByTitleAndEmployer } from "@shared/job-matching.js";
import type { CreateJobInput } from "@shared/types";
import { progressHelpers } from "../progress";

export async function importJobsStep(args: {
  discoveredJobs: CreateJobInput[];
  /** Jobs already imported earlier in this pipeline run. */
  priorRunJobs?: CreateJobInput[];
  emitProgress?: boolean;
}): Promise<{ created: number; skipped: number; fuzzyMerged: number }> {
  const emitProgress = args.emitProgress !== false;
  logger.info("Importing discovered jobs", {
    discovered: args.discoveredJobs.length,
  });

  // Dedup against jobs already imported earlier in this run (other sources),
  // then drop those prior entries: they are stored already.
  const priorRunJobs = args.priorRunJobs ?? [];
  const priorUrls = new Set(priorRunJobs.map((job) => job.jobUrl));
  const dedupedJobs = deduplicateJobsByTitleAndEmployer([
    ...priorRunJobs,
    ...args.discoveredJobs,
  ]).filter((job) => !priorUrls.has(job.jobUrl));
  const fuzzyMerged = args.discoveredJobs.length - dedupedJobs.length;

  if (fuzzyMerged > 0) {
    logger.info("Fuzzy-deduped discovered jobs before import", {
      original: args.discoveredJobs.length,
      dedupedCount: dedupedJobs.length,
      fuzzyMerged,
    });
  }

  const { created, skipped } = await jobsRepo.createJobs(
    dedupedJobs,
    emitProgress
      ? (job, index, total) =>
          progressHelpers.importingJob(index, total, {
            id: job.jobUrl,
            title: job.title,
            employer: job.employer,
          })
      : undefined,
  );
  logger.info("Import step complete", {
    discovered: args.discoveredJobs.length,
    fuzzyMerged,
    created,
    skipped,
  });

  if (emitProgress) {
    progressHelpers.importComplete(created, skipped + fuzzyMerged);
  }

  return { created, skipped, fuzzyMerged };
}
