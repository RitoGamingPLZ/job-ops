import { toTermProgress } from "@shared/extractor-progress";
import { resolveSearchCities } from "@shared/search-cities.js";
import type { ExtractorManifest } from "@shared/types/extractors";
import { runWorkingNomads } from "./run";

export const manifest: ExtractorManifest = {
  id: "workingnomads",
  displayName: "Working Nomads",
  providesSources: ["workingnomads"],
  runtime: "worker",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  capabilities: { locationEvidence: true },
  locationCapabilities: {
    workingnomads: { supportedCountryKeys: null },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const parsedMaxJobsPerTerm = context.settings.jobspyResultsWanted
      ? Number.parseInt(context.settings.jobspyResultsWanted, 10)
      : Number.NaN;
    const maxJobsPerTerm = Number.isFinite(parsedMaxJobsPerTerm)
      ? Math.max(1, parsedMaxJobsPerTerm)
      : 50;

    const result = await runWorkingNomads({
      selectedCountry: context.selectedCountry,
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        list: context.sourceLocationPlan?.requestedCities,
        single: context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
      workplaceTypes: context.settings.workplaceTypes
        ? JSON.parse(context.settings.workplaceTypes)
        : undefined,
      maxJobsPerTerm,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toTermProgress(event, { label: "Working Nomads" }));
      },
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
      };
    }

    return {
      success: true,
      jobs: result.jobs,
    };
  },
};

export default manifest;
