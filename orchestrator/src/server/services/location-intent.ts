import { parseLegacyWorkplaceTypes } from "@shared/settings-registry";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import { parseSearchCitiesSetting } from "@shared/search-cities.js";
import type { AppSettings, LocationWorkplaceType } from "@shared/types";
import type { SettingKey } from "@server/repositories/settings";

type RawSettings = Partial<Record<SettingKey, string>>;

function resolveRawLocationProximity(settings: RawSettings) {
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

export function resolveLocationIntentFromRawSettings(
  settings: RawSettings,
  options?: {
    includeProximity?: boolean;
    defaultWorkplaceTypes?: LocationWorkplaceType[];
  },
) {
  const workplaceTypes =
    parseLegacyWorkplaceTypes(settings.workplaceTypes) ?? options?.defaultWorkplaceTypes ?? [];
  return createLocationIntentFromLegacyInputs({
    selectedCountry: settings.jobspyCountryIndeed ?? "",
    searchCities: settings.searchCities ?? settings.jobspyLocation ?? "",
    workplaceTypes,
    searchScope: settings.locationSearchScope,
    matchStrictness: settings.locationMatchStrictness,
    ...(options?.includeProximity === false
      ? {}
      : { proximity: resolveRawLocationProximity(settings) }),
  });
}

export function resolveLocationIntentFromAppSettings(settings: AppSettings) {
  return createLocationIntentFromLegacyInputs({
    country: settings.jobspyCountryIndeed.value,
    searchCities: parseSearchCitiesSetting(settings.searchCities.value),
    workplaceTypes: settings.workplaceTypes.value,
    searchScope: settings.locationSearchScope.value,
    matchStrictness: settings.locationMatchStrictness.value,
    proximity:
      settings.locationSearchMode.value === "radius" &&
      settings.locationLatitude.value != null &&
      settings.locationLongitude.value != null
        ? {
            latitude: settings.locationLatitude.value,
            longitude: settings.locationLongitude.value,
            radiusMiles: settings.locationRadiusMiles.value,
          }
        : null,
  });
}
