import { toPaginatedTermProgress } from "@shared/extractor-progress";
import { ADZUNA_SUPPORTED_COUNTRY_KEYS, getAdzunaCountryCode } from "@shared/location-support.js";
import { resolveSearchCities } from "@shared/search-cities.js";
import type { ExtractorManifest } from "@shared/types/extractors";
import { runAdzuna } from "./src/run";

export const manifest: ExtractorManifest = {
  id: "adzuna",
  displayName: "Adzuna",
  providesSources: ["adzuna"],
  requiredEnvVars: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  runtime: "worker",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  capabilities: { locationEvidence: true },
  locationCapabilities: {
    adzuna: { supportedCountryKeys: ADZUNA_SUPPORTED_COUNTRY_KEYS },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const countryCode = getAdzunaCountryCode(context.selectedCountry);
    if (!countryCode) {
      return {
        success: false,
        jobs: [],
        error: `unsupported country ${context.selectedCountry}`,
      };
    }

    const configuredMaxJobsPerTerm = context.settings.adzunaMaxJobsPerTerm
      ? parseInt(context.settings.adzunaMaxJobsPerTerm, 10)
      : 50;
    const locationCount = Math.max(1, context.sourceLocationPlan?.requestedCities.length ?? 0);
    const maxJobsPerTerm = Math.max(1, Math.ceil(configuredMaxJobsPerTerm / locationCount));

    let result: Awaited<ReturnType<typeof runAdzuna>>;
    try {
      result = await runAdzuna({
        country: countryCode,
        countryKey: context.selectedCountry,
        searchTerms: context.searchTerms,
        locations: resolveSearchCities({
          list: context.sourceLocationPlan?.requestedCities,
          single: context.settings.searchCities ?? context.settings.jobspyLocation,
        }),
        maxJobsPerTerm,
        shouldCancel: context.shouldCancel,
        onProgress: (event) => {
          if (context.shouldCancel?.()) return;

          context.onProgress?.(
            toPaginatedTermProgress(event, { label: "Adzuna", pageIndexBase: 1 }),
          );
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unexpected error while running Adzuna extractor.";
      return {
        success: false,
        jobs: [],
        error: message,
      };
    }

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
