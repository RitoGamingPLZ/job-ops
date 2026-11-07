import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

// Stub: replaced by PLAN.md Phase 4b. Interface fixed in PLAN.md "Phase 3 interfaces".
const notImplemented = (): never => {
  throw new Error("SmartRecruiters watchlist adapter is not implemented yet");
};

export const smartrecruitersWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "smartrecruiters",
  descriptor: {
    sourceType: "smartrecruiters",
    label: "SmartRecruiters",
    catalogLabel: "SmartRecruiters careers",
    customSourceOptionLabel: "Custom SmartRecruiters search URL",
    customSourceSearchText: "custom smartrecruiters url",
    customSourceInputLabel: "SmartRecruiters careers search URL",
    customSourcePlaceholder: "",
    customSourceHelpText: "",
    emptyCatalogText: "No SmartRecruiters sources found.",
    fetchingLabel: "Fetching from SmartRecruiters...",
    invalidUrlMessage: "That is not a supported SmartRecruiters careers URL.",
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
