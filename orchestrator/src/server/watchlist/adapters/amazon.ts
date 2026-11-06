import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md step 11. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Amazon watchlist adapter is not implemented yet");
};

export const amazonWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "amazon",
  descriptor: {
    sourceType: "amazon",
    label: "Amazon",
    catalogLabel: "Amazon careers",
    customSourceOptionLabel: "Custom Amazon search URL",
    customSourceSearchText: "custom amazon url",
    customSourceInputLabel: "Amazon careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Amazon sources found.",
    fetchingLabel: "Fetching from Amazon...",
    invalidUrlMessage: "That is not a supported Amazon careers URL.",
    supportsCustomSource: false,
    supportsBranding: false,
  },
  catalogSchema: z.unknown(),
  parseCatalogSources: () => [],
  hydrateSelectedSource: (source) => source,
  normalizeCustomSelection: notImplemented,
  fetchJobs: async () => notImplemented(),
  fetchJobDetails: async () => notImplemented(),
  prepareImportDraft: async () => notImplemented(),
};
