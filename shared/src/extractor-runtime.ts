import type { ExtractorRunResult } from "./types/extractors";
import type { CreateJobInput } from "./types/jobs";
import { toIntegerOrFallback } from "./utils/type-conversion";

export type SearchTermProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

/**
 * Runs search terms in order, capping jobs per term and deduping across terms
 * by `sourceJobId ?? jobUrl`. Any failure discards collected jobs.
 */
export async function runSearchTermJobs(
  options: {
    searchTerms?: string[];
    maxJobsPerTerm?: number;
    shouldCancel?: () => boolean;
    onProgress?: (event: SearchTermProgressEvent) => void;
  },
  loadJobs: (searchTerm: string) => Promise<CreateJobInput[]>,
  unexpectedErrorMessage: string,
): Promise<ExtractorRunResult> {
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

      let jobsFoundTerm = 0;

      for (const job of await loadJobs(searchTerm)) {
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
          : unexpectedErrorMessage;

    return { success: false, jobs: [], error: message };
  }
}
