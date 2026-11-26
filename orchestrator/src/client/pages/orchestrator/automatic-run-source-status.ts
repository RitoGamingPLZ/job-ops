import { EXTRACTOR_SOURCE_METADATA, type ExtractorSourceId } from "@shared/extractors";
import type { LocationSourcePlan } from "@shared/location-intelligence.js";
import { formatCountryLabel } from "@shared/location-support.js";
import { sourceLabel } from "@/lib/utils";

export interface AutomaticSourceStatus {
  badgeLabel: string;
  detail: string;
  available: boolean;
}

function getKnownJobSource(source: LocationSourcePlan["source"]): ExtractorSourceId | null {
  return source in EXTRACTOR_SOURCE_METADATA ? (source as ExtractorSourceId) : null;
}

export function getSourceStatus(args: {
  countrySelected: boolean;
  plan: LocationSourcePlan;
}): AutomaticSourceStatus {
  const { countrySelected, plan } = args;
  const { source, requestedCountry } = plan;
  const knownSource = getKnownJobSource(source);
  const countryLabel = requestedCountry ? formatCountryLabel(requestedCountry) : "";
  const sourceName = knownSource ? sourceLabel[knownSource] : source;
  const hasCountryRestriction =
    plan.capabilities.requiresSelectedCountry || plan.capabilities.supportedCountryKeys !== null;

  if (!countrySelected) {
    if (hasCountryRestriction) {
      return {
        badgeLabel: "Select country",
        detail: "Pick a country first to check whether this source is available.",
        available: false,
      };
    }

    return {
      badgeLabel: "Available",
      detail: "This source is available without a country selection.",
      available: true,
    };
  }

  if (!plan.canRun) {
    return {
      badgeLabel: "Blocked",
      detail: `${sourceName} is not available for ${countryLabel || "the selected country"}.`,
      available: false,
    };
  }

  return {
    badgeLabel: "Available",
    detail: "Available for this location intent.",
    available: true,
  };
}
