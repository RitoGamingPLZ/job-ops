import { toTermProgress } from "@shared/extractor-progress";
import { JOBSPY_SUPPORTED_COUNTRY_KEYS } from "@shared/location-support.js";
import { parseLegacyWorkplaceTypes } from "@shared/settings-registry";
import type { ExtractorManifest, ExtractorRuntimeContext } from "@shared/types/extractors";
import { runJobSpy } from "./src/run";

type JobSpySite = NonNullable<NonNullable<Parameters<typeof runJobSpy>[0]>["sites"]>[number];

const JOBSPY_SOURCES = new Set<JobSpySite>(["indeed", "linkedin"]);

function isJobSpySite(source: string): source is JobSpySite {
  return JOBSPY_SOURCES.has(source as JobSpySite);
}

export const manifest: ExtractorManifest = {
  id: "jobspy",
  displayName: "JobSpy",
  providesSources: ["indeed", "linkedin"],
  runtime: "container",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  capabilities: { locationEvidence: true },
  locationCapabilities: {
    indeed: { supportedCountryKeys: JOBSPY_SUPPORTED_COUNTRY_KEYS },
    linkedin: { supportedCountryKeys: JOBSPY_SUPPORTED_COUNTRY_KEYS },
  },
  async run(context: ExtractorRuntimeContext) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const sites = context.selectedSources.filter(isJobSpySite);
    const locations = context.sourceLocationPlan?.requestedCities;
    const configuredResultsWanted = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : undefined;
    const resultsWanted =
      configuredResultsWanted && context.locationIntent?.proximity
        ? Math.max(1, Math.ceil(configuredResultsWanted / Math.max(1, locations?.length ?? 0)))
        : configuredResultsWanted;

    const result = await runJobSpy({
      sites,
      searchTerms: context.searchTerms,
      locations,
      location: context.settings.searchCities ?? context.settings.jobspyLocation,
      resultsWanted,
      countryIndeed: context.settings.jobspyCountryIndeed,
      workplaceTypes: parseLegacyWorkplaceTypes(context.settings.workplaceTypes),
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;

        if (event.type === "source_error") {
          context.onProgress?.({
            phase: "list",
            currentUrl: event.searchTerm,
            detail: `JobSpy: ${event.source} failed for ${event.searchTerm}`,
          });
          return;
        }

        context.onProgress?.(
          toTermProgress(event, {
            label: "JobSpy",
            includeJobCounts: false,
          }),
        );
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
      sourceErrors: result.sourceErrors,
    };
  },
};
