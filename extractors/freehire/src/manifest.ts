import { toTermProgress } from "@shared/extractor-progress";
import { resolveSearchCities } from "@shared/search-cities.js";
import { parseLegacyWorkplaceTypes } from "@shared/settings-registry";
import type { ExtractorManifest } from "@shared/types/extractors";
import { runFreeHire } from "./run";

export const manifest: ExtractorManifest = {
  id: "freehire",
  displayName: "FreeHire",
  providesSources: ["freehire"],
  runtime: "worker",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  locationCapabilities: {
    freehire: { supportedCountryKeys: null },
  },
  async run(context) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const parsedLimit = context.settings.jobspyResultsWanted
      ? Number.parseInt(context.settings.jobspyResultsWanted, 10)
      : Number.NaN;
    const result = await runFreeHire({
      searchTerms: context.searchTerms,
      selectedCountry: context.selectedCountry,
      locations: resolveSearchCities({
        list: context.sourceLocationPlan?.requestedCities,
        single: context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
      workplaceTypes: parseLegacyWorkplaceTypes(context.settings.workplaceTypes),
      maxJobsPerTerm: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (!context.shouldCancel?.()) {
          context.onProgress?.(toTermProgress(event, { label: "FreeHire" }));
        }
      },
    });

    return result.success
      ? { success: true, jobs: result.jobs }
      : { success: false, jobs: [], error: result.error };
  },
};
