import * as settingsRepo from "@server/repositories/settings";
import { resolveLocationIntentFromRawSettings } from "@server/services/location-intent";
import { matchJobLocationIntent } from "@shared/job-matching.js";
import type { PipelineConfig } from "@shared/types";
import type { ScoredJob } from "./types";

async function resolveLocationIntent(
  mergedConfig: PipelineConfig,
): Promise<NonNullable<PipelineConfig["locationIntent"]>> {
  if (mergedConfig.locationIntent) return mergedConfig.locationIntent;

  return resolveLocationIntentFromRawSettings(await settingsRepo.getAllSettings());
}

export async function selectJobsStep(args: {
  scoredJobs: ScoredJob[];
  mergedConfig: PipelineConfig;
}): Promise<ScoredJob[]> {
  const locationIntent = await resolveLocationIntent(args.mergedConfig);
  const prioritizeSelectedLocations =
    locationIntent.geoScope === "remote_worldwide_prioritize_selected";

  return args.scoredJobs
    .filter((job) => (job.suitabilityScore ?? 0) >= args.mergedConfig.minSuitabilityScore)
    .sort((left, right) => {
      const scoreDelta = (right.suitabilityScore ?? 0) - (left.suitabilityScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      if (!prioritizeSelectedLocations) return 0;

      const leftPriority = matchJobLocationIntent(left, locationIntent).priority;
      const rightPriority = matchJobLocationIntent(right, locationIntent).priority;
      return rightPriority - leftPriority;
    })
    .slice(0, args.mergedConfig.topN);
}
