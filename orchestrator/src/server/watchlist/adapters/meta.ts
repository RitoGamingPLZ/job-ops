import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md step 17. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Meta watchlist adapter is not implemented yet");
};

export const metaWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "meta",
  descriptor: {
    sourceType: "meta",
    label: "Meta",
    catalogLabel: "Meta careers",
    customSourceOptionLabel: "Custom Meta search URL",
    customSourceSearchText: "custom meta url",
    customSourceInputLabel: "Meta careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Meta sources found.",
    fetchingLabel: "Fetching from Meta...",
    invalidUrlMessage: "That is not a supported Meta careers URL.",
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
