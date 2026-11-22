import { toTermProgress } from "@shared/extractor-progress";
import { resolveSearchCities } from "@shared/search-cities.js";
import type { ExtractorManifest } from "@shared/types/extractors";
import { runSeek } from "./src/run";

export const manifest: ExtractorManifest = {
  id: "seek",
  displayName: "Seek",
  providesSources: ["seek"],
  requiredEnvVars: ["APIFY_TOKEN"],
  runtime: "worker",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  locationCapabilities: {
    seek: { supportedCountryKeys: ["australia", "new zealand"] },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = context.settings.seekMaxJobsPerTerm
      ? parseInt(context.settings.seekMaxJobsPerTerm, 10)
      : 50;

    const countryLabel = context.selectedCountry === "new zealand" ? "New Zealand" : "Australia";

    const cities = resolveSearchCities({
      list: context.sourceLocationPlan?.requestedCities,
      single: context.settings.searchCities ?? context.settings.jobspyLocation,
    });
    const locations = cities.length > 0 ? cities : [`All ${countryLabel}`];

    const result = await runSeek({
      searchTerms: context.searchTerms,
      locations,
      country: context.selectedCountry,
      maxJobsPerTerm: Math.max(1, Math.ceil(maxJobsPerTerm / locations.length)),
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toTermProgress(event, { label: "Seek", completionStyle: "dash" }));
      },
    });

    if (!result.success) {
      return { success: false, jobs: [], error: result.error };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
