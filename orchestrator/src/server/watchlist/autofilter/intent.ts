import * as settingsRepo from "@server/repositories/settings";
import { resolveLocationIntentFromRawSettings } from "@server/services/location-intent";
import { settingsRegistry } from "@shared/settings-registry";
import type { FilterIntent } from "./types";

// Read on every invocation through the tenant/user-scoped repository. Never cache
// intent or include profile, credentials, proximity coordinates or unrelated settings.
export async function loadFilterIntent(): Promise<FilterIntent> {
  const settings = await settingsRepo.getAllSettings();
  const titles =
    settingsRegistry.searchTerms.parse(settings.searchTerms) ??
    settingsRegistry.searchTerms.default();
  const location = resolveLocationIntentFromRawSettings(settings, {
    includeProximity: false,
    defaultWorkplaceTypes: settingsRegistry.workplaceTypes.default(),
  });
  return {
    titles: titles.slice(0, 100).map((title) => title.slice(0, 200)),
    country: location.selectedCountry ?? "",
    cities: location.cityLocations,
    workplaceTypes: location.workplaceTypes,
  };
}
