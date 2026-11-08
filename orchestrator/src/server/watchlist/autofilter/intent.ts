import * as settingsRepo from "@server/repositories/settings";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain";
import { settingsRegistry } from "@shared/settings-registry";
import type { FilterIntent } from "./types";

// Read on every invocation through the tenant/user-scoped repository. Never cache
// intent or include profile, credentials, proximity coordinates or unrelated settings.
export async function loadFilterIntent(): Promise<FilterIntent> {
  const settings = await settingsRepo.getAllSettings();
  const titles =
    settingsRegistry.searchTerms.parse(settings.searchTerms) ??
    settingsRegistry.searchTerms.default();
  const workplaceTypes =
    settingsRegistry.workplaceTypes.parse(settings.workplaceTypes) ??
    settingsRegistry.workplaceTypes.default();
  const location = createLocationIntentFromLegacyInputs({
    selectedCountry: settings.jobspyCountryIndeed ?? "",
    searchCities: settings.searchCities ?? settings.jobspyLocation ?? "",
    workplaceTypes,
    searchScope: settings.locationSearchScope,
    matchStrictness: settings.locationMatchStrictness,
  });
  return {
    titles: titles.slice(0, 100).map((title) => title.slice(0, 200)),
    country: location.selectedCountry ?? "",
    cities: location.cityLocations,
    workplaceTypes: location.workplaceTypes,
  };
}
