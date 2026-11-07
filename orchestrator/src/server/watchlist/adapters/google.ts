import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md step 16. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Google watchlist adapter is not implemented yet");
};

export const googleWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "google",
  descriptor: {
    sourceType: "google",
    label: "Google",
    catalogLabel: "Google careers",
    customSourceOptionLabel: "Custom Google search URL",
    customSourceSearchText: "custom google url",
    customSourceInputLabel: "Google careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Google sources found.",
    fetchingLabel: "Fetching from Google...",
    invalidUrlMessage: "That is not a supported Google careers URL.",
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
