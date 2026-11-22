/**
 * Main pipeline logic - orchestrates the daily job processing flow.
 *
 * Flow:
 * 1. Run crawler to discover new jobs
 * 2. Score jobs for suitability
 * 3. Leave all jobs in "discovered" for manual processing
 */

import { join } from "node:path";
import type { AppErrorCode } from "@infra/errors";
import { logger } from "@infra/logger";
import { trackServerProductEvent } from "@infra/product-analytics";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { parseWorkplaceTypes } from "@server/pipeline/settings-parsers";
import { getJobResume } from "@server/repositories/job-resumes";
import { ensureJobResume } from "@server/services/job-resume";
import { getPrivateDataScope } from "@server/tenancy/private-scope";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import { resolveResumeProjectSelection } from "@shared/resume-projects";
import type {
  CreateJobInput,
  Job,
  JobStatus,
  PipelineConfig,
  PipelineRunSavedDetails,
} from "@shared/types";
import { getDataDir } from "../config/dataDir";
import * as jobsRepo from "../repositories/jobs";
import * as pipelineRepo from "../repositories/pipeline";
import * as settingsRepo from "../repositories/settings";
import {
  refundHostedUsageReservation,
  reserveHostedUsage,
  settleHostedUsageReservation,
} from "../services/hosted-usage";
import { generatePdf } from "../services/pdf";
import {
  createJobPdfFingerprint,
  resolvePdfFingerprintContext,
} from "../services/pdf-fingerprint";
import { removeStoredJobPdf } from "../services/pdf-storage";
import { getProfile } from "../services/profile";
import { pickProjectIdsForJob } from "../services/projectSelection";
import {
  extractProjectsFromProfile,
  resolveResumeProjectsSettings,
} from "../services/resumeProjects";
import { LlmNotConfiguredError } from "../services/scorer";
import { generateTailoring } from "../services/summary";
import {
  type PendingChallenge,
  progressHelpers,
  resetProgress,
} from "./progress";
import {
  buildPipelineRunSavedDetails,
  createPipelineRunResultSummary,
  updatePipelineRunResultSummary,
} from "./run-details";
import {
  discoverJobsStep,
  importJobsStep,
  loadProfileStep,
  notifyPipelineWebhookStep,
  scoreJobsStep,
  selectJobsStep,
} from "./steps";

const DEFAULT_CONFIG: PipelineConfig = {
  topN: 10,
  minSuitabilityScore: 50,
  // Keep Glassdoor opt-in via source picker/settings; do not enable by default.
  sources: ["gradcracker", "indeed", "linkedin", "ukvisajobs"],
  outputDir: join(getDataDir(), "pdfs"),
  enableCrawling: true,
  enableScoring: true,
  enableImporting: true,
  enableAutoTailoring: true,
};

function parseProjectIdsCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawId of value.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

type TenantPipelineState = {
  isRunning: boolean;
  activePipelineRunId: string | null;
  cancelRequestedAt: string | null;
  activeChallengeState: ChallengeState | null;
  attemptedChallengeSearchStates: Set<string>;
  skippedChallengeSearchStates: Set<string>;
  activeLlmConfigState: LlmConfigState | null;
};

type ChallengeState = {
  challenges: Map<string, PendingChallenge>;
  solving: Set<string>;
  resolve: () => void;
};

type LlmConfigState = {
  resolve: () => void;
};

const pipelineStateByTenant = new Map<string, TenantPipelineState>();

function getPipelineScopeKey(): string {
  return getPrivateDataScope().scopeKey;
}

function getPipelineState(
  scopeKey = getPipelineScopeKey(),
): TenantPipelineState {
  let state = pipelineStateByTenant.get(scopeKey);
  if (!state) {
    state = {
      isRunning: false,
      activePipelineRunId: null,
      cancelRequestedAt: null,
      activeChallengeState: null,
      attemptedChallengeSearchStates: new Set(),
      skippedChallengeSearchStates: new Set(),
      activeLlmConfigState: null,
    };
    pipelineStateByTenant.set(scopeKey, state);
  }
  return state;
}

async function resolveLocationIntent(
  config: Partial<PipelineConfig>,
): Promise<NonNullable<PipelineConfig["locationIntent"]>> {
  if (config.locationIntent) {
    return createLocationIntentFromLegacyInputs(config.locationIntent);
  }

  const settings = await settingsRepo.getAllSettings();
  return createLocationIntentFromLegacyInputs({
    selectedCountry: settings.jobspyCountryIndeed ?? "",
    searchCities: settings.searchCities ?? settings.jobspyLocation ?? "",
    workplaceTypes: parseWorkplaceTypes(settings.workplaceTypes),
    searchScope: settings.locationSearchScope,
    matchStrictness: settings.locationMatchStrictness,
    proximity:
      settings.locationSearchMode === "radius" &&
      settings.locationLatitude != null &&
      settings.locationLongitude != null
        ? {
            latitude: Number(settings.locationLatitude),
            longitude: Number(settings.locationLongitude),
            radiusMiles: Number(settings.locationRadiusMiles ?? 50),
          }
        : null,
  });
}

// ---------- Challenge pause/resume state ----------

// The pipeline async function stays alive in memory while paused — there's no
// state serialization. A server restart kills a paused pipeline, same as it
// kills a running one. This is intentional: challenges happen at most once
// per day per extractor, and the user is actively present to solve them.

function hiringCafeSearchState(challenge: PendingChallenge): string | null {
  if (challenge.extractorId !== "hiringcafe") return null;
  try {
    const url = new URL(challenge.url);
    if (url.origin !== "https://hiringcafe.com" || url.pathname !== "/") {
      return null;
    }
    return url.searchParams.get("searchState");
  } catch {
    return null;
  }
}

/**
 * Returns the list of challenges currently blocking the pipeline, or empty if
 * the pipeline is not paused on challenges.
 */
export function getPendingChallenges(): PendingChallenge[] {
  const challengeState = getPipelineState().activeChallengeState;
  if (!challengeState) return [];
  return Array.from(challengeState.challenges.values());
}

/** Mark a browser solve attempt and prevent a concurrent skip. */
export function beginPipelineChallengeSolve(
  extractorId: string,
): (() => void) | null {
  const state = getPipelineState();
  const challengeState = state.activeChallengeState;
  const challenge = challengeState?.challenges.get(extractorId);
  if (!challengeState || !challenge || challengeState.solving.has(extractorId))
    return null;

  challengeState.solving.add(extractorId);
  const searchState = hiringCafeSearchState(challenge);
  if (searchState) {
    state.attemptedChallengeSearchStates.add(searchState);
    challenge.solveAttempted = true;
    progressHelpers.challengeRequired(
      Array.from(challengeState.challenges.values()),
    );
  }

  return () => challengeState.solving.delete(extractorId);
}

export function skipPipelineChallengeSearch(
  extractorId: string,
):
  | { status: "skipped"; remaining: number }
  | { status: "not_found" }
  | { status: "not_allowed" }
  | { status: "busy" } {
  const state = getPipelineState();
  const challengeState = state.activeChallengeState;
  const challenge = challengeState?.challenges.get(extractorId);
  if (!challengeState || !challenge) return { status: "not_found" };
  if (challengeState.solving.has(extractorId)) return { status: "busy" };

  const searchState = hiringCafeSearchState(challenge);
  if (!searchState || !state.attemptedChallengeSearchStates.has(searchState)) {
    return { status: "not_allowed" };
  }

  state.skippedChallengeSearchStates.add(searchState);
  const { remaining } = resolvePipelineChallenge(extractorId);
  return { status: "skipped", remaining };
}

/**
 * Mark a single challenge as resolved (called by the solve-challenge API after
 * the headed browser session succeeds).  When no challenges remain the blocked
 * pipeline Promise is resolved and discovery re-runs the affected extractors.
 */
export function resolvePipelineChallenge(extractorId: string): {
  resolved: boolean;
  remaining: number;
} {
  const state = getPipelineState();
  const challengeState = state.activeChallengeState;
  if (!challengeState) return { resolved: false, remaining: 0 };

  const deleted = challengeState.challenges.delete(extractorId);
  const remaining = challengeState.challenges.size;

  // Update progress so the UI reflects the change immediately
  progressHelpers.challengeResolved(
    Array.from(challengeState.challenges.values()),
  );

  if (remaining === 0) {
    challengeState.resolve();
  }

  return { resolved: deleted, remaining };
}

/**
 * Resume a pipeline that paused because the LLM was not configured.
 * Called by the POST /api/pipeline/resume-scoring endpoint after the user
 * configures an API key in Settings.
 */
export function resumePipelineScoring(): { resolved: boolean } {
  const state = getPipelineState();
  if (!state.activeLlmConfigState) return { resolved: false };
  state.activeLlmConfigState.resolve();
  state.activeLlmConfigState = null;
  return { resolved: true };
}

// ---------- Cancellation ----------

class PipelineCancelledError extends Error {
  constructor(message = "Pipeline cancellation requested") {
    super(message);
    this.name = "PipelineCancelledError";
  }
}

function ensureNotCancelled(scopeKey = getPipelineScopeKey()): void {
  if (getPipelineState(scopeKey).cancelRequestedAt) {
    throw new PipelineCancelledError();
  }
}

function mergeRetriedJobs(
  originalJobs: CreateJobInput[],
  retriedJobs: CreateJobInput[],
): CreateJobInput[] {
  const merged = [...originalJobs];
  for (const retried of retriedJobs) {
    const index = merged.findIndex(
      (original) =>
        original.source === retried.source &&
        ((original.sourceJobId &&
          retried.sourceJobId &&
          original.sourceJobId === retried.sourceJobId) ||
          original.jobUrl === retried.jobUrl),
    );
    if (index < 0) {
      merged.push(retried);
      continue;
    }

    const existing = merged[index];
    merged[index] = {
      ...existing,
      ...Object.fromEntries(
        Object.entries(retried).filter(([, value]) => value != null),
      ),
    };
  }
  return merged;
}

/**
 * Run the full job discovery and processing pipeline.
 */
export async function runPipeline(
  config: Partial<PipelineConfig> = {},
  options?: { hostedUsageReservationId?: string | null },
): Promise<{
  success: boolean;
  jobsDiscovered: number;
  jobsProcessed: number;
  error?: string;
}> {
  const scopeKey = getPipelineScopeKey();
  const tenantState = getPipelineState(scopeKey);
  if (tenantState.isRunning) {
    if (options?.hostedUsageReservationId) {
      await settleHostedUsageReservation({
        reservationId: options.hostedUsageReservationId,
        usedUnits: 0,
      });
    }
    return {
      success: false,
      jobsDiscovered: 0,
      jobsProcessed: 0,
      error: "Pipeline is already running",
    };
  }

  tenantState.isRunning = true;
  tenantState.activePipelineRunId = "pending";
  tenantState.cancelRequestedAt = null;
  tenantState.attemptedChallengeSearchStates.clear();
  tenantState.skippedChallengeSearchStates.clear();
  resetProgress();
  const locationIntent = await resolveLocationIntent(config);
  const mergedConfig = { ...DEFAULT_CONFIG, ...config, locationIntent };
  const configSnapshot = {
    topN: mergedConfig.topN,
    minSuitabilityScore: mergedConfig.minSuitabilityScore,
    sources: mergedConfig.sources,
    locationIntent,
  } as const;

  let savedDetails: PipelineRunSavedDetails | null = null;
  try {
    savedDetails = await buildPipelineRunSavedDetails(mergedConfig);
  } catch (error) {
    logger.warn("Failed to capture pipeline run settings snapshot", { error });
  }

  const pipelineRun = await pipelineRepo.createPipelineRun({
    configSnapshot,
    savedDetails,
  });
  tenantState.activePipelineRunId = pipelineRun.id;

  return runWithRequestContext({ pipelineRunId: pipelineRun.id }, async () => {
    const pipelineLogger = logger.child({ pipelineRunId: pipelineRun.id });
    let jobsDiscovered = 0;
    let jobsProcessed = 0;
    let pipelineUsageUnits = 0;
    let resultSummary =
      savedDetails?.resultSummary ?? createPipelineRunResultSummary();
    const persistResultSummary = async (
      update: Parameters<typeof updatePipelineRunResultSummary>[1],
    ) => {
      resultSummary = updatePipelineRunResultSummary(resultSummary, update);
      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        resultSummary,
      });
    };
    pipelineLogger.info("Starting pipeline run", {
      topN: mergedConfig.topN,
      minSuitabilityScore: mergedConfig.minSuitabilityScore,
      sources: mergedConfig.sources,
      locationIntent: {
        selectedCountry: locationIntent.selectedCountry,
        cityCount: locationIntent.cityLocations.length,
        radiusMiles: locationIntent.proximity?.radiusMiles ?? null,
        hasProximity: Boolean(locationIntent.proximity),
      },
    });

    try {
      ensureNotCancelled(scopeKey);
      await persistResultSummary({ stage: "started" });
      const profile = await loadProfileStep();
      await persistResultSummary({ stage: "profile_loaded" });

      ensureNotCancelled(scopeKey);
      await persistResultSummary({ stage: "discovery" });
      const incrementalImportTotals = {
        created: 0,
        skipped: 0,
        fuzzyMerged: 0,
      };
      const incrementallyImportedUrls = new Set<string>();
      // Jobs imported so far in this run; later batches fuzzy-dedup against them.
      const runJobs: CreateJobInput[] = [];
      const importSourceBatch = async (
        sourceJobs: CreateJobInput[],
        source: string,
      ) => {
        if (sourceJobs.length === 0) return;
        try {
          const batch = await importJobsStep({
            discoveredJobs: sourceJobs,
            priorRunJobs: runJobs,
            emitProgress: false,
          });
          incrementalImportTotals.created += batch.created;
          incrementalImportTotals.skipped += batch.skipped;
          incrementalImportTotals.fuzzyMerged += batch.fuzzyMerged;
          runJobs.push(...sourceJobs);
          for (const job of sourceJobs) {
            incrementallyImportedUrls.add(job.jobUrl);
          }
        } catch (error) {
          pipelineLogger.warn(
            "Incremental per-source import failed; will retry after discovery",
            {
              source,
              jobCount: sourceJobs.length,
              error: sanitizeUnknown(error),
            },
          );
        }
      };
      // Sources finish concurrently; serialise imports so each batch sees the
      // jobs every earlier batch imported.
      let importChain = Promise.resolve();
      const handleSourceDiscovered = (
        sourceJobs: CreateJobInput[],
        source: string,
      ) => {
        importChain = importChain.then(() =>
          importSourceBatch(sourceJobs, source),
        );
        return importChain;
      };

      let { discoveredJobs, sourceErrors, pendingChallenges } =
        await discoverJobsStep({
          mergedConfig,
          watchlistSelectedSourceIds: mergedConfig.watchlistSelectedSourceIds,
          shouldCancel: () =>
            getPipelineState(scopeKey).cancelRequestedAt !== null,
          onSourceDiscovered: handleSourceDiscovered,
        });
      await persistResultSummary({
        stage: "discovery",
        sourceErrors,
      });

      // ---------- Challenge pause/resume ----------
      while (pendingChallenges.length > 0) {
        pendingChallenges = pendingChallenges.map((challenge) => {
          const searchState = hiringCafeSearchState(challenge);
          return searchState
            ? {
                ...challenge,
                canSkipSearch: true,
                solveAttempted:
                  tenantState.attemptedChallengeSearchStates.has(searchState),
              }
            : challenge;
        });
        pipelineLogger.info("Challenges detected, pausing pipeline", {
          challenges: pendingChallenges.map((c) => ({
            extractorId: c.extractorId,
            url: c.url,
          })),
        });

        progressHelpers.challengeRequired(pendingChallenges);

        // Block until all challenges are resolved by the solve-challenge API.
        // The Promise is resolved by `resolvePipelineChallenge()`, which is
        // called from the POST /api/pipeline/solve-challenge endpoint (4d).
        // Cancellation still works: the cancel endpoint sets cancelRequestedAt,
        // and ensureNotCancelled() fires after the Promise resolves.
        const challengedSources = pendingChallenges.flatMap((c) => c.sources);
        const retryChallengeUrls = Object.fromEntries(
          pendingChallenges.map((challenge) => [
            challenge.extractorId,
            challenge.url,
          ]),
        );
        const resumeStates = Object.fromEntries(
          pendingChallenges.flatMap((challenge) =>
            challenge.resumeState !== undefined
              ? [[challenge.extractorId, challenge.resumeState]]
              : [],
          ),
        );

        await new Promise<void>((resolve) => {
          tenantState.activeChallengeState = {
            challenges: new Map(
              pendingChallenges.map((c) => [c.extractorId, c]),
            ),
            solving: new Set(),
            resolve,
          };
        });
        tenantState.activeChallengeState = null;

        ensureNotCancelled(scopeKey);

        // Re-run only the extractors that had challenges
        pipelineLogger.info("Challenges resolved, re-running extractors", {
          sources: challengedSources,
        });

        const retryConfig = { ...mergedConfig, sources: challengedSources };
        const retryResult = await discoverJobsStep({
          mergedConfig: retryConfig,
          includeWatchlist: false,
          preserveFanout: true,
          fanoutSeedJobs: discoveredJobs,
          retryChallengeUrls,
          resumeStates,
          skippedChallengeSearchStates: Array.from(
            tenantState.skippedChallengeSearchStates,
          ),
          shouldCancel: () =>
            getPipelineState(scopeKey).cancelRequestedAt !== null,
          onSourceDiscovered: handleSourceDiscovered,
        });

        discoveredJobs = mergeRetriedJobs(
          discoveredJobs,
          retryResult.discoveredJobs,
        );
        sourceErrors = [...sourceErrors, ...retryResult.sourceErrors];

        // Keep the run paused until every challenged source finishes a retry
        // without another challenge. Jobs collected so far stay in memory and
        // are imported only after discovery is complete.
        pendingChallenges = retryResult.pendingChallenges;
        if (pendingChallenges.length > 0) {
          pipelineLogger.warn("Challenge persists; pausing again", {
            retryPendingChallenges: pendingChallenges.map(
              (challenge) => challenge.extractorId,
            ),
          });
        }
      }

      progressHelpers.crawlingComplete(discoveredJobs.length);

      ensureNotCancelled(scopeKey);
      jobsDiscovered = discoveredJobs.length;
      const remainingJobs =
        incrementallyImportedUrls.size === 0
          ? discoveredJobs
          : discoveredJobs.filter(
              (job) => !incrementallyImportedUrls.has(job.jobUrl),
            );
      let created = incrementalImportTotals.created;
      let skipped = incrementalImportTotals.skipped;
      let fuzzyMerged = incrementalImportTotals.fuzzyMerged;
      if (remainingJobs.length > 0 || incrementallyImportedUrls.size === 0) {
        const finalBatch = await importJobsStep({
          discoveredJobs: remainingJobs,
          priorRunJobs: runJobs,
        });
        created += finalBatch.created;
        skipped += finalBatch.skipped;
        fuzzyMerged += finalBatch.fuzzyMerged;
      } else {
        progressHelpers.importComplete(created, skipped + fuzzyMerged);
      }

      await persistResultSummary({ stage: "import" });
      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        jobsDiscovered,
      });

      let scoredJobs: import("./steps/types").ScoredJob[] = [];

      ensureNotCancelled(scopeKey);
      await persistResultSummary({ stage: "scoring" });
      while (true) {
        try {
          ({ scoredJobs } = await scoreJobsStep({
            profile,
            scoringInstructions: mergedConfig.scoringInstructions,
            hostedUsageReserved: true,
            shouldCancel: () =>
              getPipelineState(scopeKey).cancelRequestedAt !== null,
          }));
          break;
        } catch (error) {
          if (!(error instanceof LlmNotConfiguredError)) {
            throw error;
          }

          const message = error.message;
          progressHelpers.configurationRequired(message);
          pipelineLogger.warn("Pipeline paused — LLM not configured", error);

          await new Promise<void>((resolve) => {
            tenantState.activeLlmConfigState = { resolve };
          });
          tenantState.activeLlmConfigState = null;

          ensureNotCancelled(scopeKey);

          pipelineLogger.info("LLM configured, resuming scoring");
        }
      }
      await persistResultSummary({
        stage: "scoring",
        jobsScored: scoredJobs.length,
      });

      ensureNotCancelled(scopeKey);
      await persistResultSummary({ stage: "selection" });
      const jobsToProcess = await selectJobsStep({
        scoredJobs,
        mergedConfig,
      });
      await persistResultSummary({
        stage: "selection",
        jobsScored: scoredJobs.length,
        jobsSelected: jobsToProcess.length,
      });

      pipelineLogger.info("Selected jobs for processing", {
        candidates: jobsToProcess.length,
      });

      await persistResultSummary({
        stage: "processing",
        jobsScored: scoredJobs.length,
        jobsSelected: jobsToProcess.length,
      });
      const processedCount = 0;
      jobsProcessed = processedCount;

      resultSummary = updatePipelineRunResultSummary(resultSummary, {
        stage: "completed",
        jobsScored: scoredJobs.length,
        jobsSelected: jobsToProcess.length,
      });
      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        jobsProcessed: processedCount,
        resultSummary,
      });

      progressHelpers.complete(jobsDiscovered, processedCount);
      pipelineLogger.info("Pipeline run completed", {
        jobsDiscovered,
        jobsFuzzyMerged: fuzzyMerged,
        jobsImported: created,
        jobsSkipped: skipped,
        jobsProcessed: processedCount,
      });

      await notifyPipelineWebhookStep("pipeline.completed", {
        pipelineRunId: pipelineRun.id,
        jobsDiscovered,
        jobsScored: scoredJobs.length,
        jobsProcessed: processedCount,
      });

      pipelineUsageUnits = 1;
      return {
        success: true,
        jobsDiscovered,
        jobsProcessed: processedCount,
      };
    } catch (error) {
      if (error instanceof PipelineCancelledError) {
        const message = "Cancelled by user request";
        await pipelineRepo.updatePipelineRun(pipelineRun.id, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          jobsDiscovered,
          jobsProcessed,
          errorMessage: message,
          resultSummary,
        });
        progressHelpers.cancelled(message);
        pipelineLogger.info("Pipeline run cancelled", {
          jobsDiscovered,
          jobsProcessed,
        });
        return {
          success: false,
          jobsDiscovered,
          jobsProcessed,
          error: message,
        };
      }

      const message = error instanceof Error ? error.message : "Unknown error";

      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message,
        resultSummary,
      });

      progressHelpers.failed(message);
      pipelineLogger.error("Pipeline run failed", error);

      await notifyPipelineWebhookStep("pipeline.failed", {
        pipelineRunId: pipelineRun.id,
        error: message,
      });

      return {
        success: false,
        jobsDiscovered,
        jobsProcessed,
        error: message,
      };
    } finally {
      tenantState.isRunning = false;
      tenantState.activePipelineRunId = null;
      tenantState.cancelRequestedAt = null;
      tenantState.activeChallengeState = null;
      tenantState.attemptedChallengeSearchStates.clear();
      tenantState.skippedChallengeSearchStates.clear();
      tenantState.activeLlmConfigState = null;
      if (options?.hostedUsageReservationId) {
        await settleHostedUsageReservation({
          reservationId: options.hostedUsageReservationId,
          usedUnits: pipelineUsageUnits,
        });
      }
    }
  });
}

export type ProcessJobOptions = {
  force?: boolean;
  fields?: Array<"summary" | "headline" | "skills" | "projects">;
  requestOrigin?: string | null;
  analyticsOrigin?:
    | "move_to_ready"
    | "generate_pdf"
    | "auto_pdf_regeneration"
    | "pipeline"
    | "manual_job_create";
};

/**
 * Step 1: Generate AI summary and suggest projects.
 */
export async function summarizeJob(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  return runWithRequestContext({ jobId }, async () => {
    const jobLogger = logger.child({ jobId });
    jobLogger.info("Summarizing job");
    let tailoringReservationId: string | null | undefined;
    let tailoringUsageSucceeded = false;
    const reserveTailoringUsage = async () => {
      if (tailoringReservationId !== undefined) return;
      const reserved = await reserveHostedUsage({ action: "tailoring" });
      tailoringReservationId = reserved.reservation?.id ?? null;
    };
    const settleTailoringUsage = async () => {
      if (!tailoringReservationId) return;
      await settleHostedUsageReservation({
        reservationId: tailoringReservationId,
        usedUnits: tailoringUsageSucceeded ? 1 : 0,
      });
      tailoringReservationId = null;
    };
    const refundTailoringUsage = async () => {
      if (!tailoringReservationId) return;
      await refundHostedUsageReservation(tailoringReservationId);
      tailoringReservationId = null;
    };

    try {
      const job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };

      const profile = await getProfile();

      // 1. Generate Summary & Tailoring
      let tailoredSummary = job.tailoredSummary;
      let tailoredHeadline = job.tailoredHeadline;
      let tailoredSkills = job.tailoredSkills;
      const requestedFields = options?.fields;
      const shouldUpdateAllTailoring = !requestedFields?.length;
      const shouldUpdateSummary =
        shouldUpdateAllTailoring || requestedFields.includes("summary");
      const shouldUpdateHeadline =
        shouldUpdateAllTailoring || requestedFields.includes("headline");
      const shouldUpdateSkills =
        shouldUpdateAllTailoring || requestedFields.includes("skills");
      const shouldUpdateProjects =
        shouldUpdateAllTailoring || requestedFields.includes("projects");
      const shouldGenerateTailoring =
        shouldUpdateSummary || shouldUpdateHeadline || shouldUpdateSkills;

      if (
        shouldGenerateTailoring &&
        (!tailoredSummary || !tailoredHeadline || options?.force)
      ) {
        jobLogger.info("Generating tailoring content");
        await reserveTailoringUsage();
        const tailoringResult = await generateTailoring(
          job.jobDescription || "",
          profile,
        );
        if (tailoringResult.success && tailoringResult.data) {
          tailoringUsageSucceeded = true;
          if (shouldUpdateSummary) {
            tailoredSummary = tailoringResult.data.summary;
          }
          if (shouldUpdateHeadline) {
            tailoredHeadline = tailoringResult.data.headline;
          }
          if (shouldUpdateSkills) {
            tailoredSkills = JSON.stringify(tailoringResult.data.skills);
          }
        } else if (
          options?.force ||
          (shouldUpdateSummary && !tailoredSummary) ||
          (shouldUpdateHeadline && !tailoredHeadline)
        ) {
          await settleTailoringUsage();
          return {
            success: false,
            error: `Tailoring failed: ${tailoringResult.error || "unknown error"}`,
          };
        }
      }

      // 2. Suggest Projects
      let selectedProjectIds = job.selectedProjectIds;
      if (shouldUpdateProjects) {
        try {
          const existingSelectedProjectIds =
            parseProjectIdsCsv(selectedProjectIds);
          const { catalog, selectionItems } =
            extractProjectsFromProfile(profile);
          const overrideResumeProjectsRaw =
            await settingsRepo.getSetting("resumeProjects");
          const { resumeProjects } = resolveResumeProjectsSettings({
            catalog,
            overrideRaw: overrideResumeProjectsRaw,
          });

          const currentSelection = resolveResumeProjectSelection({
            catalog,
            resumeProjects,
            selectedProjectIds: existingSelectedProjectIds,
          });
          const mustIncludeSet = new Set(currentSelection.mustIncludeIds);
          const currentAiIds = currentSelection.effectiveSelectedIds.filter(
            (id) => !mustIncludeSet.has(id),
          );
          const storedSelectionIsValid =
            existingSelectedProjectIds.length > 0 &&
            existingSelectedProjectIds.length === currentAiIds.length &&
            existingSelectedProjectIds.every(
              (id, index) => id === currentAiIds[index],
            );
          const emptySelection = resolveResumeProjectSelection({
            catalog,
            resumeProjects,
          });
          const eligibleSet = new Set(emptySelection.aiSelectableIds);
          const eligibleProjects = selectionItems.filter((p) =>
            eligibleSet.has(p.id),
          );
          if (storedSelectionIsValid && !options?.force) {
            selectedProjectIds = currentAiIds.join(",");
          } else {
            if (
              emptySelection.remainingSlots > 0 &&
              eligibleProjects.length > 0
            ) {
              await reserveTailoringUsage();
              const picked = await pickProjectIdsForJob({
                jobDescription: job.jobDescription || "",
                eligibleProjects,
                desiredCount: emptySelection.remainingSlots,
              });
              tailoringUsageSucceeded = true;
              selectedProjectIds = picked.join(",");
            } else {
              selectedProjectIds = "";
            }
          }
        } catch (error) {
          jobLogger.warn("Failed to suggest projects", { error });
        }
      }

      await jobsRepo.updateJob(job.id, {
        ...(shouldUpdateSummary
          ? { tailoredSummary: tailoredSummary ?? undefined }
          : {}),
        ...(shouldUpdateHeadline
          ? { tailoredHeadline: tailoredHeadline ?? undefined }
          : {}),
        ...(shouldUpdateSkills
          ? { tailoredSkills: tailoredSkills ?? undefined }
          : {}),
        ...(shouldUpdateProjects
          ? { selectedProjectIds: selectedProjectIds ?? undefined }
          : {}),
      });

      await settleTailoringUsage();
      return { success: true };
    } catch (error) {
      await refundTailoringUsage();
      const message = error instanceof Error ? error.message : "Unknown error";
      jobLogger.error("Summarization failed", error);
      return { success: false, error: message };
    }
  });
}

/**
 * Step 2: Generate PDF using current summary and project selection.
 */
export async function generateFinalPdf(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
  errorCode?: AppErrorCode;
}> {
  return runWithRequestContext({ jobId }, async () => {
    const jobLogger = logger.child({ jobId });
    jobLogger.info("Generating final PDF");
    let jobStatusToRestore: JobStatus | null = null;
    let pdfRegeneratingMarked = false;
    let pdfReservationId: string | null | undefined;
    const reservePdfUsage = async () => {
      if (pdfReservationId !== undefined) return;
      const reserved = await reserveHostedUsage({ action: "pdf_export" });
      pdfReservationId = reserved.reservation?.id ?? null;
    };
    const settlePdfUsage = async (usedUnits: number) => {
      if (!pdfReservationId) return;
      await settleHostedUsageReservation({
        reservationId: pdfReservationId,
        usedUnits,
      });
      pdfReservationId = null;
    };
    const refundPdfUsage = async () => {
      if (!pdfReservationId) return;
      await refundHostedUsageReservation(pdfReservationId);
      pdfReservationId = null;
    };

    try {
      const job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };
      if (job.pdfRegenerating) {
        return {
          success: false,
          error:
            "PDF regeneration is already in progress for this job. Please wait for it to finish.",
          errorCode: "CONFLICT",
        };
      }
      jobStatusToRestore = job.status;
      await reservePdfUsage();

      // Only an unprepared job moves through processing -> ready. Every other
      // status (ready, applied, in_progress, ...) keeps its status while rendering.
      const movesToReady =
        job.status === "discovered" || job.status === "processing";
      const claimedJob = await jobsRepo.updateJob(job.id, {
        ...(movesToReady ? { status: "processing" } : {}),
        pdfRegenerating: true,
      });
      if (!claimedJob) {
        await settlePdfUsage(0);
        return { success: false, error: "Job not found" };
      }
      pdfRegeneratingMarked = true;

      // Capture freshness before rendering so an autosave during rendering stays stale.
      await ensureJobResume(job.id, {
        requestOrigin: options?.requestOrigin ?? null,
      });
      const fingerprintContext = await resolvePdfFingerprintContext();
      const pdfResult = await generatePdf(job.id, job.jobDescription || "", {
        requestOrigin: options?.requestOrigin ?? null,
      });

      if (!pdfResult.success) {
        await jobsRepo.updateJob(job.id, {
          status: job.status,
          pdfRegenerating: false,
        });
        pdfRegeneratingMarked = false;
        await settlePdfUsage(0);
        const preservedPdfMessage =
          !movesToReady && job.pdfPath
            ? " Your previous resume PDF is still available."
            : "";
        return {
          success: false,
          error: `PDF generation failed.${preservedPdfMessage}${
            pdfResult.error ? ` ${pdfResult.error}` : ""
          }`,
          errorCode: pdfResult.errorCode,
        };
      }
      if (!pdfResult.pdfPath) {
        throw new Error("PDF generation succeeded without an output path.");
      }

      const pdfFingerprint = createJobPdfFingerprint(job, fingerprintContext);
      const expectedStatusAtCommit: JobStatus = movesToReady
        ? "processing"
        : job.status;

      const updatedJob = await jobsRepo.finalizeGeneratedPdfIfCurrent({
        id: job.id,
        expectedStatus: expectedStatusAtCommit,
        requireGeneratedSource: !movesToReady,
        pdfPath: pdfResult.pdfPath,
        pdfFingerprint,
        pdfGeneratedAt: new Date().toISOString(),
      });
      if (!updatedJob) {
        const latestJob = await jobsRepo.getJobById(job.id);
        if (!latestJob) {
          await removeStoredJobPdf(job.id).catch((error) => {
            jobLogger.warn("Failed to remove PDF generated for a deleted job", {
              error,
            });
          });
        }
        if (
          latestJob?.pdfRegenerating &&
          (latestJob.status !== expectedStatusAtCommit ||
            (!movesToReady && latestJob.pdfSource !== "generated"))
        ) {
          await jobsRepo.updateJob(job.id, { pdfRegenerating: false });
        }
        pdfRegeneratingMarked = false;
        await settlePdfUsage(0);
        return {
          success: false,
          error: "PDF generation was superseded by newer job changes.",
          errorCode: "CONFLICT",
        };
      }
      pdfRegeneratingMarked = false;

      const analyticsOrigin = options?.analyticsOrigin ?? "move_to_ready";
      const generationKind = movesToReady ? "initial" : "regenerate";
      void trackServerProductEvent(
        "resume_generated",
        {
          origin: analyticsOrigin,
          generation_kind: generationKind,
          renderer: fingerprintContext.pdfRenderer,
          theme:
            fingerprintContext.pdfRenderer === "typst"
              ? fingerprintContext.typstTheme
              : null,
          has_tailored_summary: Boolean(job.tailoredSummary),
          has_tailored_skills: Boolean(job.tailoredSkills),
        },
        {
          requestOrigin: options?.requestOrigin ?? null,
          urlPath: "/jobs",
        },
      );

      if (movesToReady) {
        void trackServerProductEvent(
          "job_moved_to_ready",
          {
            origin: analyticsOrigin,
          },
          {
            requestOrigin: options?.requestOrigin ?? null,
            urlPath: "/jobs",
          },
        );
      }

      await settlePdfUsage(1);
      return { success: true };
    } catch (error) {
      await refundPdfUsage();
      const message = error instanceof Error ? error.message : "Unknown error";
      if (jobStatusToRestore || pdfRegeneratingMarked) {
        try {
          await jobsRepo.updateJob(jobId, {
            ...(jobStatusToRestore ? { status: jobStatusToRestore } : {}),
            pdfRegenerating: false,
          });
        } catch (restoreError) {
          jobLogger.warn("Failed to restore job status after PDF error", {
            restoreStatus: jobStatusToRestore,
            error: restoreError,
          });
        }
      }
      jobLogger.error("PDF generation failed", error);
      return { success: false, error: message };
    }
  });
}

/**
 * Process a single job (runs both steps in sequence).
 */
export async function processJob(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  return runWithRequestContext({ jobId }, async () => {
    let job: Job | null = null;
    const restore = async (generationError: string | null = null) => {
      // A throw before the first read leaves the job unknown; read it again.
      const before = job ?? (await jobsRepo.getJobById(jobId));
      if (!before || before.status === "ready") return null;
      // "processing" means the target route already claimed it, or a run died mid-flight.
      return jobsRepo.updateJob(jobId, {
        status: before.status === "processing" ? "discovered" : before.status,
        generationError,
      });
    };
    try {
      job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };
      await jobsRepo.setJobTargeted(jobId, true);
      const status = job.status;
      // Resume + usable PDF already exist: a targeted job belongs in Ready.
      const markReady = () =>
        status === "ready"
          ? Promise.resolve(null)
          : jobsRepo.updateJob(jobId, {
              status: "ready",
              generationError: null,
            });
      const resume = await getJobResume(jobId);
      if (
        resume &&
        job.pdfPath &&
        (job.pdfSource === "uploaded" ||
          createJobPdfFingerprint(job, await resolvePdfFingerprintContext()) ===
            job.pdfFingerprint)
      ) {
        await markReady();
        return { success: true };
      }
      // A ready job stays in Ready while its PDF re-renders.
      if (job.status !== "ready")
        await jobsRepo.updateJob(jobId, {
          status: "processing",
          generationError: null,
        });
      await ensureJobResume(jobId, {
        tailor: true,
        requestOrigin: options?.requestOrigin ?? null,
      });
      if (job.pdfSource === "uploaded" && job.pdfPath) {
        await markReady();
        return { success: true };
      }
      const result = await generateFinalPdf(jobId, options);
      if (!result.success) {
        logger.warn("Targeted job generation failed", {
          jobId,
          error: result.error,
        });
        await restore(result.error ?? "Resume generation failed");
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Resume generation failed";
      await restore(message).catch((restoreError) =>
        logger.warn("Failed to restore job status after generation error", {
          jobId,
          error: restoreError,
        }),
      );
      logger.error("Targeted job generation failed", { jobId, error });
      return { success: false, error: message };
    }
  });
}

/**
 * Check if pipeline is currently running.
 */
export function getPipelineStatus(): { isRunning: boolean } {
  return { isRunning: getPipelineState().isRunning };
}

export function requestPipelineCancel(): {
  accepted: boolean;
  pipelineRunId: string | null;
  alreadyRequested: boolean;
} {
  const state = getPipelineState();
  if (!state.isRunning) {
    return { accepted: false, pipelineRunId: null, alreadyRequested: false };
  }

  const pipelineRunId =
    state.activePipelineRunId && state.activePipelineRunId !== "pending"
      ? state.activePipelineRunId
      : null;

  if (state.cancelRequestedAt) {
    return {
      accepted: true,
      pipelineRunId,
      alreadyRequested: true,
    };
  }

  state.cancelRequestedAt = new Date().toISOString();

  // Unblock any pause so cancellation can proceed. Without this the pipeline
  // would stay stuck in memory until the pause resolves or the server restarts.
  // ensureNotCancelled() runs immediately after the paused Promise resolves.
  if (state.activeChallengeState) {
    state.activeChallengeState.resolve();
    state.activeChallengeState = null;
  }
  if (state.activeLlmConfigState) {
    state.activeLlmConfigState.resolve();
    state.activeLlmConfigState = null;
  }

  return {
    accepted: true,
    pipelineRunId,
    alreadyRequested: false,
  };
}

export function isPipelineCancelRequested(): boolean {
  return getPipelineState().cancelRequestedAt !== null;
}
