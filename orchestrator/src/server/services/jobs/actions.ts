import {
  AppError,
  type AppErrorCode,
  badRequest,
  conflict,
  notFound,
} from "@infra/errors";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { isDemoMode } from "@server/config/demo";
import { generateFinalPdf, processJob } from "@server/pipeline/index";
import { getJobResume } from "@server/repositories/job-resumes";
import * as jobsRepo from "@server/repositories/jobs";
import {
  simulateProcessJob,
  simulateRescoreJob,
} from "@server/services/demo-simulator";
import { regenerateJobResume } from "@server/services/job-resume";
import {
  getJobPdfFreshness,
  resolvePdfFingerprintContext,
} from "@server/services/pdf-fingerprint";
import { getProfile } from "@server/services/profile";
import { scoreJobSuitability } from "@server/services/scorer";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import {
  isTargeted,
  type JobAction,
  type JobActionResult,
  type JobStatus,
} from "@shared/types";

const SKIPPABLE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "discovered",
  "ready",
]);

function mapErrorForResult(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message || "Unknown error",
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Unknown error",
  };
}

const STATUS_BY_APP_ERROR_CODE: Record<AppErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  SERVICE_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export type JobActionExecutionOptions = {
  getProfileForRescore?: () => Promise<Record<string, unknown>>;
  requestOrigin?: string | null;
  analyticsOrigin?:
    | "move_to_ready"
    | "generate_pdf"
    | "pipeline"
    | "manual_job_create";
};

export function createSharedRescoreProfileLoader(): () => Promise<
  Record<string, unknown>
> {
  let profilePromise: Promise<Record<string, unknown>> | null = null;

  return async () => {
    if (!profilePromise) {
      profilePromise = (async () => {
        const rawProfile = await getProfile();
        if (
          !rawProfile ||
          typeof rawProfile !== "object" ||
          Array.isArray(rawProfile)
        ) {
          throw badRequest("Invalid resume profile format");
        }
        return rawProfile as Record<string, unknown>;
      })();
    }
    return profilePromise;
  };
}

export function buildJobActionExecutionOptions(
  action: JobAction,
  options?: { requestOrigin?: string | null },
): JobActionExecutionOptions {
  return {
    ...(action === "rescore" && !isDemoMode()
      ? { getProfileForRescore: createSharedRescoreProfileLoader() }
      : {}),
    ...(action === "move_to_ready"
      ? { requestOrigin: options?.requestOrigin ?? null }
      : {}),
  };
}

const pendingTargets = new Set<string>();

/** Start in the caller's async tenant/request context; never hold the HTTP response for rendering. */
export async function targetJobInBackground(
  jobId: string,
  options?: JobActionExecutionOptions,
) {
  const job = await jobsRepo.getJobById(jobId);
  if (!job)
    throw new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: "Job not found",
    });
  const updated = await jobsRepo.setJobTargeted(jobId, true);
  if (!updated)
    throw badRequest(
      "Only discovered, processing, or ready jobs can be targeted",
    );
  const scopeKey = getPrivateDataScope().scopeKey;
  const key = `${scopeKey}:${jobId}`;
  // In-memory only, so a job left in "processing" by a restart is retryable.
  if (
    pendingTargets.has(key) ||
    pendingRegenerations.has(key) ||
    pendingResumeBatches.get(scopeKey)?.has(jobId)
  )
    return updated;
  pendingTargets.add(key);
  let response = updated;
  try {
    // Show "processing" in this response and the next list fetch; ready jobs stay visible.
    if (updated.status === "discovered")
      response =
        (await jobsRepo.updateJob(jobId, { status: "processing" })) ?? updated;
  } catch (error) {
    pendingTargets.delete(key);
    throw error;
  }
  setImmediate(() => {
    void (
      isDemoMode()
        ? simulateProcessJob(jobId)
        : processJob(jobId, {
            requestOrigin: options?.requestOrigin ?? null,
            analyticsOrigin: options?.analyticsOrigin ?? "move_to_ready",
          })
    )
      .then((result) => {
        if (!result.success)
          logger.warn("Targeted job generation failed", {
            jobId,
            error: result.error,
          });
      })
      .catch((error) =>
        logger.error("Targeted job generation failed", { jobId, error }),
      )
      .finally(() => pendingTargets.delete(key));
  });
  return response;
}

// Per-process locks, scoped exactly like the private repositories.
const pendingRegenerations = new Set<string>();
const pendingResumeBatches = new Map<string, Set<string>>();

export async function regenerateJobResumeInBackground(
  jobId: string,
  options?: JobActionExecutionOptions,
) {
  const scopeKey = getPrivateDataScope().scopeKey;
  const key = `${scopeKey}:${jobId}`;
  const job = await jobsRepo.getJobById(jobId);
  if (!job) throw notFound("Job not found");
  if (
    job.status === "processing" ||
    job.pdfRegenerating ||
    pendingRegenerations.has(key) ||
    pendingTargets.has(key) ||
    pendingResumeBatches.get(scopeKey)?.has(jobId)
  )
    throw conflict("Resume generation is already running");
  if (!isTargeted(job))
    throw badRequest("Only targeted jobs can regenerate resumes");
  pendingRegenerations.add(key);
  let response = job;
  try {
    const updated = await jobsRepo.updateJob(jobId, { status: "processing" });
    if (!updated) throw notFound("Job not found");
    response = updated;
  } catch (error) {
    pendingRegenerations.delete(key);
    throw error;
  }
  setImmediate(() => {
    void runWithRequestContext({ jobId }, async () => {
      try {
        const result = await (async () => {
          if (isDemoMode()) return simulateProcessJob(jobId);
          await regenerateJobResume(jobId, {
            requestOrigin: options?.requestOrigin ?? null,
          });
          return generateFinalPdf(jobId, options);
        })();
        if (!result.success) throw new Error("Resume PDF generation failed");
      } catch (error) {
        logger.error("Resume regeneration failed", { jobId, error });
        const current = await jobsRepo.getJobById(jobId);
        if (current?.status === "processing")
          await jobsRepo.updateJob(jobId, { status: job.status });
      } finally {
        pendingRegenerations.delete(key);
      }
    }).catch((error) =>
      logger.error("Failed to restore regenerated job", { jobId, error }),
    );
  });
  return response;
}

export async function generateMissingResumesInBackground(
  options?: JobActionExecutionOptions,
): Promise<{ jobIds: string[]; alreadyRunning: boolean }> {
  const key = getPrivateDataScope().scopeKey;
  if (pendingResumeBatches.has(key))
    return { jobIds: [], alreadyRunning: true };
  // Claim before any asynchronous selection so simultaneous requests cannot race.
  const queuedJobs = new Set<string>();
  pendingResumeBatches.set(key, queuedJobs);
  let jobIds: string[];
  try {
    const context = await resolvePdfFingerprintContext();
    const jobs = await jobsRepo.getAllJobs([
      "discovered",
      "processing",
      "ready",
    ]);
    jobIds = [];
    for (const job of jobs) {
      if (
        !isTargeted(job) ||
        job.status === "processing" ||
        job.pdfRegenerating ||
        job.pdfSource === "uploaded"
      )
        continue;
      const needsResume =
        !job.pdfPath ||
        getJobPdfFreshness(job, context) === "stale" ||
        !(await getJobResume(job.id));
      // Check after the document lookup: regenerate may start during that await.
      if (needsResume && !pendingRegenerations.has(`${key}:${job.id}`)) {
        jobIds.push(job.id);
        queuedJobs.add(job.id);
      }
    }
  } catch (error) {
    pendingResumeBatches.delete(key);
    throw error;
  }
  setImmediate(() => {
    void (async () => {
      try {
        for (const jobId of jobIds) {
          await runWithRequestContext({ jobId }, async () => {
            try {
              // Recheck jobs that changed while waiting for earlier renders.
              const job = await jobsRepo.getJobById(jobId);
              if (
                !job ||
                !isTargeted(job) ||
                job.status === "processing" ||
                job.pdfRegenerating ||
                job.pdfSource === "uploaded" ||
                pendingTargets.has(`${key}:${jobId}`)
              )
                return;
              const result = await (isDemoMode()
                ? simulateProcessJob(jobId)
                : processJob(jobId, options));
              if (!result.success)
                logger.warn("Batch resume generation failed", {
                  jobId,
                  error: result.error,
                });
            } catch (error) {
              logger.error("Batch resume generation failed", { jobId, error });
            } finally {
              queuedJobs.delete(jobId);
            }
          });
        }
      } finally {
        pendingResumeBatches.delete(key);
      }
    })().catch((error) => logger.error("Resume batch failed", { error }));
  });
  return { jobIds, alreadyRunning: false };
}

export async function executeJobActionForJob(
  action: JobAction,
  jobId: string,
  options?: JobActionExecutionOptions,
): Promise<JobActionResult> {
  try {
    const job = await jobsRepo.getJobById(jobId);
    if (!job) {
      throw new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
    }

    if (action === "skip") {
      if (!SKIPPABLE_STATUSES.has(job.status)) {
        throw badRequest(`Job is not skippable from status "${job.status}"`, {
          jobId,
          status: job.status,
          allowedStatuses: ["discovered", "ready"],
        });
      }

      const updated = await jobsRepo.updateJob(jobId, { status: "skipped" });
      if (!updated) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      return { jobId, ok: true, job: updated };
    }

    if (action === "move_to_ready") {
      const updated = await targetJobInBackground(jobId, options);
      return { jobId, ok: true, job: updated };
    }

    if (job.status === "processing") {
      throw badRequest(`Job is not rescorable from status "${job.status}"`, {
        jobId,
        status: job.status,
        disallowedStatus: "processing",
      });
    }

    if (isDemoMode()) {
      const simulated = await simulateRescoreJob(job.id);
      return { jobId, ok: true, job: simulated };
    }

    const profile = options?.getProfileForRescore
      ? await options.getProfileForRescore()
      : await (async () => {
          const rawProfile = await getProfile();
          if (
            !rawProfile ||
            typeof rawProfile !== "object" ||
            Array.isArray(rawProfile)
          ) {
            throw badRequest("Invalid resume profile format");
          }
          return rawProfile as Record<string, unknown>;
        })();

    const {
      score,
      reason,
      jobBrief,
      jobUpdates = {},
    } = await scoreJobSuitability(job, profile);

    const updated = await jobsRepo.updateJob(job.id, {
      ...jobUpdates,
      suitabilityScore: score,
      suitabilityReason: reason,
      jobBrief,
    });
    if (!updated) {
      throw new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
    }

    return { jobId, ok: true, job: updated };
  } catch (error) {
    const mapped = mapErrorForResult(error);
    return {
      jobId,
      ok: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    };
  }
}

export function mapJobActionFailure(
  failure: Extract<JobActionResult, { ok: false }>,
): AppError {
  const code = (
    failure.error.code in STATUS_BY_APP_ERROR_CODE
      ? failure.error.code
      : "INTERNAL_ERROR"
  ) as AppErrorCode;

  return new AppError({
    status: STATUS_BY_APP_ERROR_CODE[code],
    code,
    message: failure.error.message,
  });
}
