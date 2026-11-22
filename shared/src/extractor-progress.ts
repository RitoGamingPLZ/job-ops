import type { ExtractorProgressEvent } from "./types/extractors";

export interface ExtractorTermEvent {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

/** Maps term_start to a start event; any other event type counts as term completion. */
export function toTermProgress(
  event: ExtractorTermEvent,
  options: {
    label: string;
    scope?: string;
    completionNoun?: "jobs" | "services";
    completionStyle?: "with" | "dash";
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
    jobPagesEnqueued: jobs,
    jobPagesProcessed: jobs,
    detail: `${options.label}: completed ${position}${separator} ${jobs} ${options.completionNoun ?? "jobs"}`,
  };
}
