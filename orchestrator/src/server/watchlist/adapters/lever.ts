import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md Phase 4b. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Lever watchlist adapter is not implemented yet");
};

export const leverWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "lever",
  descriptor: {
    sourceType: "lever",
    label: "Lever",
    catalogLabel: "Lever careers",
    customSourceOptionLabel: "Custom Lever search URL",
    customSourceSearchText: "custom lever url",
    customSourceInputLabel: "Lever careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Lever sources found.",
    fetchingLabel: "Fetching from Lever...",
    invalidUrlMessage: "That is not a supported Lever careers URL.",
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
