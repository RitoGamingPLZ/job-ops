import { runSearchTermJobs } from "job-ops-shared/extractor-runtime";
import type { ExtractorRunResult } from "job-ops-shared/types/extractors";
import { fetchFiveamsatSearchPage } from "./fetcher";
import { parseFiveamsatServices } from "./parser";
import type { RunFiveamsatOptions } from "./types";

export type FiveamsatResult = ExtractorRunResult;

export function runFiveamsat(
  options: RunFiveamsatOptions = {},
): Promise<FiveamsatResult> {
  return runSearchTermJobs(
    options,
    async (searchTerm) =>
      parseFiveamsatServices(
        await fetchFiveamsatSearchPage({
          query: searchTerm,
          fetchImpl: options.fetchImpl,
        }),
      ),
    "Unexpected error while running Khamsat extractor.",
  );
}
