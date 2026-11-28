/** How the last background scan ended. Reasons are bounded, page-free messages. */
export interface WatchlistScanOutcome {
  outcome: "found" | "none" | "failed" | "unavailable" | "blocked";
  reason?: string;
}
