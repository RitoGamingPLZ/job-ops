import type {
  ManualJobDraft,
  WatchedSourceType,
  WatchlistJobDetailsResponse,
  WatchlistJobResult,
  WatchlistSelectedSource,
  WatchlistSource,
  WatchlistSourceBrandingResponse,
  WatchlistSourceTypeDescriptor,
} from "@shared/types";
import type { Facets } from "../autofilter/types";

export interface WatchlistCatalogSourceAdapter {
  sourceType: WatchedSourceType;
  descriptor: WatchlistSourceTypeDescriptor;
  parseCatalogSources(entries: unknown[]): WatchlistSource[];
  hydrateSelectedSource(source: WatchlistSelectedSource): WatchlistSelectedSource;
  normalizeCustomSelection(input: { label: string | null | undefined; careersUrl: string }):
    | {
        label: string;
        careersUrl: string;
      }
    | Promise<{
        label: string;
        careersUrl: string;
      }>;
  fetchJobs(input: {
    source: WatchlistSelectedSource;
    signal?: AbortSignal;
    useLastCrawl?: boolean;
    preview?: boolean;
  }): Promise<WatchlistAdapterJobsResult>;
  fetchJobDetails(input: {
    source: WatchlistSelectedSource;
    jobRef: string;
    signal?: AbortSignal;
  }): Promise<WatchlistJobDetailsResponse>;
  prepareImportDraft(input: {
    source: WatchlistSelectedSource;
    jobRef: string;
    signal?: AbortSignal;
  }): Promise<WatchlistAdapterImportDraftResult>;
  /**
   * Public filter controls this source can offer beyond what facet discovery scrapes, such as a
   * learned keyword box. Read from public data only; must not make a model call.
   */
  discoverSearchFacets?(input: { careersUrl: string }): Promise<Facets["params"]>;
  fetchBranding?(input: {
    source: Pick<WatchlistSelectedSource, "careersUrl" | "sourceType">;
    signal?: AbortSignal;
  }): Promise<WatchlistSourceBrandingResponse>;
}

interface WatchlistAdapterJobsResult {
  total: number;
  fetched: number;
  jobs: Array<Omit<WatchlistJobResult, "rowState" | "isNewSinceLastCheck" | "workspaceJob">>;
}

interface WatchlistAdapterImportDraftResult {
  draft: ManualJobDraft;
  source: string | null;
  sourceHost: string | null;
}
