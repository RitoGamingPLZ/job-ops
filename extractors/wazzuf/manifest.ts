import { toTermProgress } from "job-ops-shared/extractor-progress";
import { normalizeCountryKey } from "job-ops-shared/location-support";
import type { ExtractorManifest } from "job-ops-shared/types/extractors";
import { runWazzuf } from "./src/run";

export const manifest: ExtractorManifest = {
  id: "wazzuf",
  displayName: "WUZZUF",
  providesSources: ["wazzuf"],
  runtime: "worker",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 30_000 },
  locationCapabilities: {
    wazzuf: { supportedCountryKeys: ["egypt"] },
  },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    if (normalizeCountryKey(context.selectedCountry) !== "egypt") {
      return { success: true, jobs: [] };
    }

    const parsedMaxJobsPerTerm = context.settings.wazzufMaxJobsPerTerm
      ? Number.parseInt(context.settings.wazzufMaxJobsPerTerm, 10)
      : context.settings.jobspyResultsWanted
        ? Number.parseInt(context.settings.jobspyResultsWanted, 10)
        : Number.NaN;

    const result = await runWazzuf({
      searchTerms: context.searchTerms,
      maxJobsPerTerm: Number.isFinite(parsedMaxJobsPerTerm)
        ? parsedMaxJobsPerTerm
        : undefined,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toTermProgress(event, { label: "WUZZUF" }));
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
