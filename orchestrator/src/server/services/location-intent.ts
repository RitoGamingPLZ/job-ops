import { parseLegacyWorkplaceTypes } from "@shared/settings-registry";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import type { SettingKey } from "@server/repositories/settings";

type RawSettings = Partial<Record<SettingKey, string>>;

export function resolveRawLocationProximity(settings: RawSettings) {
  return settings.locationSearchMode === "radius" &&
    settings.locationLatitude != null &&
    settings.locationLongitude != null
    ? {
        latitude: Number(settings.locationLatitude),
        longitude: Number(settings.locationLongitude),
        radiusMiles: Number(settings.locationRadiusMiles ?? 50),
      }
    : null;
}

export function resolveLocationIntentFromRawSettings(settings: RawSettings) {
  return createLocationIntentFromLegacyInputs({
    selectedCountry: settings.jobspyCountryIndeed ?? "",
    searchCities: settings.searchCities ?? settings.jobspyLocation ?? "",
    workplaceTypes: parseLegacyWorkplaceTypes(settings.workplaceTypes) ?? [],
    searchScope: settings.locationSearchScope,
    matchStrictness: settings.locationMatchStrictness,
    proximity: resolveRawLocationProximity(settings),
  });
}
