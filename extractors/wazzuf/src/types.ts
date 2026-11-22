import type { SearchTermProgressEvent } from "job-ops-shared/extractor-runtime";

export type WazzufProgressEvent = SearchTermProgressEvent;

export interface RunWazzufOptions {
  searchTerms?: string[];
  maxJobsPerTerm?: number;
  fetchImpl?: typeof fetch;
  shouldCancel?: () => boolean;
  onProgress?: (event: WazzufProgressEvent) => void;
}
