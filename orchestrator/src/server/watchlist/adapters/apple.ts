import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md step 13. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Apple watchlist adapter is not implemented yet");
};

export const appleWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "apple",
  descriptor: {
    sourceType: "apple",
    label: "Apple",
    catalogLabel: "Apple careers",
    customSourceOptionLabel: "Custom Apple search URL",
    customSourceSearchText: "custom apple url",
    customSourceInputLabel: "Apple careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Apple sources found.",
    fetchingLabel: "Fetching from Apple...",
    invalidUrlMessage: "That is not a supported Apple careers URL.",
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
