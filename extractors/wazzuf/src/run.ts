import { runSearchTermJobs } from "job-ops-shared/extractor-runtime";
import type { ExtractorRunResult } from "job-ops-shared/types/extractors";
import { fetchWazzufSearchPage } from "./fetcher";
import { parseWazzufJobs } from "./parser";
import type { RunWazzufOptions } from "./types";

export type WazzufResult = ExtractorRunResult;

export function runWazzuf(options: RunWazzufOptions = {}): Promise<WazzufResult> {
  return runSearchTermJobs(
    options,
    async (searchTerm) =>
      parseWazzufJobs(
        await fetchWazzufSearchPage({
          query: searchTerm,
          fetchImpl: options.fetchImpl,
        }),
      ),
    "Unexpected error while running WUZZUF extractor.",
  );
}
