import type { FacetDiscovery } from "../types";
import { discoverLeverFacets } from "./lever";

export const facetDiscoverers: Partial<Record<string, FacetDiscovery>> = {
  lever: discoverLeverFacets,
  careers_site: async (input) =>
    (await import("./careers-site")).discoverCareersSiteFacets(input),
};
