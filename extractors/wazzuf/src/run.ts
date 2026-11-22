import type { CreateJobInput } from "job-ops-shared/types/jobs";
import { toIntegerOrFallback } from "job-ops-shared/utils/type-conversion";
import { fetchWazzufSearchPage } from "./fetcher";
import { parseWazzufJobs } from "./parser";
import type { RunWazzufOptions } from "./types";

export interface WazzufResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

export async function runWazzuf(
  options: RunWazzufOptions = {},
): Promise<WazzufResult> {
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : ["software engineer"];
  const maxJobsPerTerm = toIntegerOrFallback(options.maxJobsPerTerm, 25, {
    parseStrings: false,
  });
  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();

  try {
    for (const [index, searchTerm] of searchTerms.entries()) {
      if (options.shouldCancel?.()) {
        return { success: true, jobs };
      }

      options.onProgress?.({
        type: "term_start",
        termIndex: index + 1,
        termTotal: searchTerms.length,
        searchTerm,
      });

      const html = await fetchWazzufSearchPage({
        query: searchTerm,
        fetchImpl: options.fetchImpl,
      });
      let jobsFoundTerm = 0;

      for (const job of parseWazzufJobs(html)) {
        if (options.shouldCancel?.()) {
          return { success: true, jobs };
        }
        if (jobsFoundTerm >= maxJobsPerTerm) break;

        const dedupeKey = job.sourceJobId ?? job.jobUrl;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        jobs.push(job);
        jobsFoundTerm += 1;
      }

      options.onProgress?.({
        type: "term_complete",
        termIndex: index + 1,
        termTotal: searchTerms.length,
        searchTerm,
        jobsFoundTerm,
      });
    }

    return { success: true, jobs };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected error while running WUZZUF extractor.";

    return { success: false, jobs: [], error: message };
  }
}
