import { toPaginatedTermProgress } from "@shared/extractor-progress";
import { parseLegacyWorkplaceTypes } from "@shared/settings-registry";
import { resolveSearchCities } from "@shared/search-cities.js";
import type { ExtractorManifest } from "@shared/types/extractors";
import { type HiringCafeSearchResume, runHiringCafe } from "./src/run";

type HiringCafeContext = Parameters<ExtractorManifest["run"]>[0];

function resolveContextCountry(context: HiringCafeContext): string {
  return (
    context.sourceLocationPlan?.requestedCountry ??
    context.locationIntent?.selectedCountry ??
    context.selectedCountry
  );
}

function resolveContextLocations(context: HiringCafeContext): string[] {
  return resolveSearchCities({
    list: context.sourceLocationPlan?.requestedCities ?? context.locationIntent?.cityLocations,
    single: context.settings.searchCities ?? context.settings.jobspyLocation,
  });
}

function resolveContextWorkplaceTypes(
  context: HiringCafeContext,
): Array<"remote" | "hybrid" | "onsite"> | undefined {
  const intentTypes = context.locationIntent?.workplaceTypes;
  if (intentTypes && intentTypes.length > 0) {
    return [...intentTypes];
  }

  return parseLegacyWorkplaceTypes(context.settings.workplaceTypes);
}

export const manifest: ExtractorManifest = {
  id: "hiringcafe",
  displayName: "Hiring Cafe",
  providesSources: ["hiringcafe"],
  runtime: "container",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  capabilities: { locationEvidence: true },
  locationCapabilities: {
    hiringcafe: { supportedCountryKeys: null, supportsNativeRadius: true },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 200;

    const country = resolveContextCountry(context);

    const result = await runHiringCafe({
      country,
      countryKey: country,
      searchTerms: context.searchTerms,
      locations: resolveContextLocations(context),
      proximity: context.locationIntent?.proximity ?? undefined,
      workplaceTypes: resolveContextWorkplaceTypes(context),
      maxJobsPerTerm,
      retryChallengeUrl: context.retryChallengeUrl,
      searchResume: context.resumeState as HiringCafeSearchResume | undefined,
      skippedChallengeSearchStates: context.skippedChallengeSearchStates,
      cookieStorageDir: context.cookieStorageDir,
      pageReader: context.browserPageReader ? { read: context.browserPageReader } : undefined,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;

        context.onProgress?.(
          toPaginatedTermProgress(event, { label: "Hiring Cafe", pageIndexBase: 0 }),
        );
      },
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
        challengeRequired: result.challengeRequired,
        resumeState: result.searchResume,
      };
    }

    return {
      success: true,
      jobs: result.jobs,
      sourceErrors: result.sourceErrors,
      challengeRequired: result.challengeRequired,
      resumeState: result.searchResume,
    };
  },
};
