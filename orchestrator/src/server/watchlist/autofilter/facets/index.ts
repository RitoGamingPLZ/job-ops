import type { FacetDiscovery } from "../types";
import { discoverGreenhouseFacets } from "./greenhouse";
import { discoverLeverFacets } from "./lever";

export const facetDiscoverers: Partial<Record<string, FacetDiscovery>> = {
  greenhouse: discoverGreenhouseFacets,
  lever: discoverLeverFacets,
  eightfold: async (input) =>
    (await import("./eightfold")).discoverEightfoldFacets(input),
  google: async (x) => (await import("./google")).discoverGoogleFacets(x),
  careers_site: async (input) =>
    (await import("./careers-site")).discoverCareersSiteFacets(input),
};
