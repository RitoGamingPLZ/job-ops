import type { SearchTermProgressEvent } from "job-ops-shared/extractor-runtime";

export type FiveamsatProgressEvent = SearchTermProgressEvent;

export interface RunFiveamsatOptions {
  searchTerms?: string[];
  maxJobsPerTerm?: number;
  fetchImpl?: typeof fetch;
  shouldCancel?: () => boolean;
  onProgress?: (event: FiveamsatProgressEvent) => void;
}
