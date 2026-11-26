import { describe, expect, it } from "vitest";
import { toTermProgress } from "./extractor-progress";

const base = { termIndex: 0, termTotal: 3, searchTerm: "engineer" };

describe("toTermProgress", () => {
  it.each([
    [{ label: "FreeHire" }, "engineer", "with 7 jobs", "with 0 jobs"],
    [
      { label: "Hiring Cafe", completionNoun: "services" as const },
      "engineer",
      "with 7 services",
      "with 0 services",
    ],
    [{ label: "Adzuna", completionStyle: "dash" as const }, "engineer", "— 7 jobs", "— 0 jobs"],
    [
      { label: "Jobindex", scope: "engineer @ Copenhagen" },
      "engineer @ Copenhagen",
      "with 7 jobs",
      "with 0 jobs",
    ],
  ])("formats %o", (options, scope, completed, missing) => {
    const label = options.label;
    expect(toTermProgress({ ...base, type: "term_start" }, options)).toStrictEqual({
      phase: "list",
      termsProcessed: 0,
      termsTotal: 3,
      currentUrl: scope,
      detail: `${label}: term 0/3 (${scope})`,
    });
    expect(
      toTermProgress({ ...base, type: "term_complete", jobsFoundTerm: 7 }, options),
    ).toStrictEqual({
      phase: "list",
      termsProcessed: 0,
      termsTotal: 3,
      currentUrl: scope,
      jobPagesEnqueued: 7,
      jobPagesProcessed: 7,
      detail: `${label}: completed 0/3 (${scope}) ${completed}`,
    });
    // Any non-start event counts as completion; a missing count becomes 0.
    expect(toTermProgress({ ...base, type: "other" }, options)).toStrictEqual({
      phase: "list",
      termsProcessed: 0,
      termsTotal: 3,
      currentUrl: scope,
      jobPagesEnqueued: 0,
      jobPagesProcessed: 0,
      detail: `${label}: completed 0/3 (${scope}) ${missing}`,
    });
  });

  it("reports the previous term as processed on start", () => {
    expect(
      toTermProgress({ ...base, type: "term_start", termIndex: 2 }, { label: "X" }).termsProcessed,
    ).toBe(1);
  });
});
