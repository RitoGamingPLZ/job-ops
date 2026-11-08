import type { FacetDiscovery } from "../types";
import { discoverLeverFacets } from "./lever";

export const facetDiscoverers: Partial<Record<string, FacetDiscovery>> = {
  lever: discoverLeverFacets,
  google: async (x) => (await import("./google")).discoverGoogleFacets(x),
};
