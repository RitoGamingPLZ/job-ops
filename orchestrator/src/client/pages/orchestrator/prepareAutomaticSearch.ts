import * as api from "@client/api";
import { createLocationIntent, planLocationSources } from "@shared/location-intelligence.js";
import { type JobSource, normalizePipelineRunBudget } from "@shared/types.js";
import { toast } from "sonner";
import type { AutomaticRunValues } from "./automatic-run";
import { deriveExtractorLimits, serializeCityLocationsSetting } from "./automatic-run";

/** Everything a search needs once the form is validated: what to run it with and over which sources. */
export type PreparedAutomaticSearch = AutomaticRunValues & { sources: JobSource[] };

/**
 * Validates the search form against the chosen sources, stores the search settings, and returns
 * the request to run or save. Returns null (after telling the user why) when the sources cannot
 * serve the chosen location.
 */
export async function prepareAutomaticSearch(args: {
  values: AutomaticRunValues;
  pipelineSources: JobSource[];
  watchlistSelectedSourceIds: string[] | undefined;
  refreshSettings: () => Promise<unknown>;
}): Promise<PreparedAutomaticSearch | null> {
  const { values, pipelineSources, watchlistSelectedSourceIds, refreshSettings } = args;
  const normalizedValues = {
    ...values,
    runBudget: normalizePipelineRunBudget(values.runBudget),
  };
  const locationIntent = createLocationIntent({
    selectedCountry: normalizedValues.country,
    cityLocations: normalizedValues.cityLocations,
    proximity: normalizedValues.locationMode === "radius" ? normalizedValues.proximity : null,
    workplaceTypes: normalizedValues.workplaceTypes,
    searchScope: normalizedValues.searchScope,
    matchStrictness: normalizedValues.matchStrictness,
  });
  const sourcePlan = planLocationSources({
    intent: locationIntent,
    sources: pipelineSources,
  });
  const incompatiblePlans = sourcePlan.plans.filter((plan) => !plan.canRun);
  const compatibleSources = sourcePlan.compatibleSources as JobSource[];

  if (incompatiblePlans.length > 0) {
    toast.error(
      incompatiblePlans[0]?.reasons[0] ??
        "Some selected sources do not support this location setup.",
    );
    return null;
  }

  if (compatibleSources.length === 0) {
    toast.error(
      "No compatible sources for the selected location setup. Choose another country, city, or source.",
    );
    return null;
  }

  const limits = deriveExtractorLimits({
    budget: normalizedValues.runBudget,
    searchTerms: normalizedValues.searchTerms,
    sources: compatibleSources,
  });
  const searchCities = serializeCityLocationsSetting(normalizedValues.cityLocations);
  await api.updateSettings({
    searchTerms: normalizedValues.searchTerms,
    workplaceTypes: normalizedValues.workplaceTypes,
    locationSearchScope: normalizedValues.searchScope,
    locationMatchStrictness: normalizedValues.matchStrictness,
    locationSearchMode: normalizedValues.locationMode,
    locationLatitude: normalizedValues.proximity?.latitude ?? null,
    locationLongitude: normalizedValues.proximity?.longitude ?? null,
    locationRadiusMiles: normalizedValues.proximity?.radiusMiles ?? 50,
    jobspyResultsWanted: limits.jobspyResultsWanted,
    adzunaMaxJobsPerTerm: limits.adzunaMaxJobsPerTerm,
    jobindexMaxJobsPerTerm: limits.jobindexMaxJobsPerTerm,
    jobspyCountryIndeed: normalizedValues.country,
    searchCities,
  });
  await refreshSettings();
  return {
    ...normalizedValues,
    sources: compatibleSources,
    topN: values.topN,
    minSuitabilityScore: values.minSuitabilityScore,
    watchlistSelectedSourceIds: values.watchlistSelectedSourceIds ?? watchlistSelectedSourceIds,
  };
}
