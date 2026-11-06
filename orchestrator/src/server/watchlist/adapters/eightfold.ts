import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md step 12. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Eightfold watchlist adapter is not implemented yet");
};

export const eightfoldWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "eightfold",
  descriptor: {
    sourceType: "eightfold",
    label: "Eightfold",
    catalogLabel: "Eightfold careers",
    customSourceOptionLabel: "Custom Eightfold search URL",
    customSourceSearchText: "custom eightfold url",
    customSourceInputLabel: "Eightfold careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Eightfold sources found.",
    fetchingLabel: "Fetching from Eightfold...",
    invalidUrlMessage: "That is not a supported Eightfold careers URL.",
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
