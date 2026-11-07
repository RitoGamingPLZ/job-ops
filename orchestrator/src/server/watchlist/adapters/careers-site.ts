import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md step 29. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("Careers site watchlist adapter is not implemented yet");
};

export const careersSiteWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "careers_site",
  descriptor: {
    sourceType: "careers_site",
    label: "Careers site",
    catalogLabel: "Company careers site",
    customSourceOptionLabel: "Custom Careers site search URL",
    customSourceSearchText: "custom careers site url",
    customSourceInputLabel: "Company careers site search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No Careers site sources found.",
    fetchingLabel: "Fetching from Careers site...",
    invalidUrlMessage: "That is not a supported Company careers site URL.",
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
