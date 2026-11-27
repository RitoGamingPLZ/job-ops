import type { ExtractorProgressEvent } from "./types/extractors";

export interface ExtractorTermEvent {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface ExtractorPaginatedTermEvent {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  pageNo?: number;
  totalCollected?: number;
}

/** Maps term_start to a start event; any other event type counts as term completion. */
export function toTermProgress(
  event: ExtractorTermEvent,
  options: {
    label: string;
    scope?: string;
    completionNoun?: "jobs" | "services";
    completionStyle?: "with" | "dash";
    includeJobCounts?: boolean;
  },
): ExtractorProgressEvent {
  const scope = options.scope ?? event.searchTerm;
  const position = `${event.termIndex}/${event.termTotal} (${scope})`;

  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: scope,
      detail: `${options.label}: term ${position}`,
    };
  }

  const jobs = event.jobsFoundTerm ?? 0;
  const separator = options.completionStyle === "dash" ? " —" : " with";
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: scope,
    ...(options.includeJobCounts === false
      ? {}
      : {
          jobPagesEnqueued: jobs,
          jobPagesProcessed: jobs,
        }),
    detail: `${options.label}: completed ${position}${separator} ${jobs} ${options.completionNoun ?? "jobs"}`,
  };
}

/** Maps term_start, page_fetched, and term_complete events for paginated extractors. */
export function toPaginatedTermProgress(
  event: ExtractorPaginatedTermEvent,
  options: {
    label: string;
    pageIndexBase?: 0 | 1;
  },
): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `${options.label}: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  if (event.type === "page_fetched") {
    const rawPageNo = event.pageNo ?? 0;
    const pageNo = options.pageIndexBase === 0 ? rawPageNo + 1 : rawPageNo;
    const totalCollected = event.totalCollected ?? 0;
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: pageNo,
      jobPagesEnqueued: totalCollected,
      jobPagesProcessed: totalCollected,
      currentUrl: `page ${pageNo}`,
      detail: `${options.label}: term ${event.termIndex}/${event.termTotal}, page ${pageNo} (${totalCollected} collected)`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `${options.label}: completed term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
  };
}
