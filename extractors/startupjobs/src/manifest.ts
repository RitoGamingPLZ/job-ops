import {
  type ExtractorTermEvent,
  toTermProgress,
} from "@shared/extractor-progress";
import { resolveSearchCities } from "@shared/search-cities.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runStartupJobs } from "./run";

function toProgress(
  event: ExtractorTermEvent & { location?: string },
): ExtractorProgressEvent {
  return toTermProgress(event, {
    label: "startup.jobs",
    scope: event.location
      ? `${event.searchTerm} @ ${event.location}`
      : event.searchTerm,
  });
}

export const manifest: ExtractorManifest = {
  id: "startupjobs",
  displayName: "startup.jobs",
  providesSources: ["startupjobs"],
  runtime: "worker",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  locationCapabilities: {
    startupjobs: { supportedCountryKeys: null },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const parsedMaxJobsPerTerm = context.settings.startupjobsMaxJobsPerTerm
      ? Number.parseInt(context.settings.startupjobsMaxJobsPerTerm, 10)
      : context.settings.jobspyResultsWanted
        ? Number.parseInt(context.settings.jobspyResultsWanted, 10)
        : Number.NaN;
    const configuredMaxJobsPerTerm = Number.isFinite(parsedMaxJobsPerTerm)
      ? Math.max(1, parsedMaxJobsPerTerm)
      : 50;
    const locationCount = Math.max(
      1,
      context.sourceLocationPlan?.requestedCities.length ?? 0,
    );
    const maxJobsPerTerm = Math.max(
      1,
      Math.ceil(configuredMaxJobsPerTerm / locationCount),
    );

    const result = await runStartupJobs({
      selectedCountry: context.selectedCountry,
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        list: context.sourceLocationPlan?.requestedCities,
        single:
          context.settings.searchCities ?? context.settings.jobspyLocation,
      }),
      workplaceTypes: context.settings.workplaceTypes
        ? JSON.parse(context.settings.workplaceTypes)
        : undefined,
      maxJobsPerTerm,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
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
