import type { ExtractorSourceId } from "@shared/extractors";
import type { ExtractorRunResult, LocationIntent, SourceLocationPlan } from "@shared/types";

export interface RemoteContainerExtractorRequest {
  manifestId: string;
  source: ExtractorSourceId;
  selectedSources: string[];
  searchTerms: string[];
  selectedCountry: string;
  settings: Record<string, string>;
  locationIntent?: LocationIntent;
  sourceLocationPlan?: SourceLocationPlan;
  runtime?: "container";
  requestId?: string;
}

// Runtime capability only: never retain tenant-specific payloads or credentials here.
export type RemoteContainerExtractorRunner = (
  request: RemoteContainerExtractorRequest,
) => Promise<ExtractorRunResult>;

let remoteContainerExtractorRunner: RemoteContainerExtractorRunner | null = null;

export function setRemoteContainerExtractorRunner(
  runner: RemoteContainerExtractorRunner | null,
): void {
  remoteContainerExtractorRunner = runner;
}

export function getRemoteContainerExtractorRunner(): RemoteContainerExtractorRunner | null {
  return remoteContainerExtractorRunner;
}

const CONTAINER_EXTRACTOR_SAFE_SETTING_KEYS: Record<string, readonly string[]> = {
  jobspy: [
    "jobspyResultsWanted",
    "jobspyLocation",
    "searchCities",
    "jobspyCountryIndeed",
    "workplaceTypes",
  ],
  hiringcafe: ["jobspyResultsWanted", "jobspyLocation", "searchCities", "workplaceTypes"],
  adzuna: ["adzunaMaxJobsPerTerm"],
  jobindex: ["jobindexMaxJobsPerTerm"],
};

const DEFAULT_SAFE_SETTING_KEYS = [
  "jobspyResultsWanted",
  "jobspyLocation",
  "searchCities",
  "jobspyCountryIndeed",
  "workplaceTypes",
  "adzunaMaxJobsPerTerm",
  "jobindexMaxJobsPerTerm",
] as const;

/**
 * Returns only non-secret extractor execution settings allowed across the DO ->
 * ScraperContainer boundary. Secrets (LLM keys, Gmail tokens, Adzuna keys, webhooks)
 * are never forwarded.
 */
export function pickSafeContainerExtractorSettings(
  manifestId: string,
  settings: Record<string, string | undefined>,
): Record<string, string> {
  const allowedKeys = CONTAINER_EXTRACTOR_SAFE_SETTING_KEYS[manifestId] ?? DEFAULT_SAFE_SETTING_KEYS;
  const safe: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) {
      safe[key] = value;
    }
  }
  return safe;
}
