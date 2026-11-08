import type { FacetDiscovery } from "../types";
import { discoverGreenhouseFacets } from "./greenhouse";
import { discoverLeverFacets } from "./lever";

export const facetDiscoverers: Partial<Record<string, FacetDiscovery>> = {
  greenhouse: discoverGreenhouseFacets,
  lever: discoverLeverFacets,
};
