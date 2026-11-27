import { describe, expect, it } from "vitest";
import { deriveExtractorLimits } from "./pipeline";

describe("deriveExtractorLimits", () => {
  it("keeps discovered cap under budget regardless of search-term count", () => {
    const limits = deriveExtractorLimits({
      budget: 750,
      searchTerms: ["a", "b", "c"],
      sources: ["indeed", "linkedin", "jobindex"],
    });

    const cap = 2 * limits.jobspyResultsWanted * 3 + limits.jobindexMaxJobsPerTerm * 3;

    expect(cap).toBeLessThanOrEqual(750);
  });

  it("assigns a dedicated Adzuna max-jobs limit", () => {
    const limits = deriveExtractorLimits({
      budget: 120,
      searchTerms: ["backend", "platform"],
      sources: ["adzuna"],
    });

    expect(limits.adzunaMaxJobsPerTerm).toBeGreaterThan(0);
    expect(limits.adzunaMaxJobsPerTerm).toBe(150);
  });

  it("assigns a dedicated Jobindex max-jobs limit", () => {
    const limits = deriveExtractorLimits({
      budget: 120,
      searchTerms: ["backend", "platform"],
      sources: ["jobindex"],
    });

    expect(limits.jobindexMaxJobsPerTerm).toBeGreaterThan(0);
    expect(limits.jobindexMaxJobsPerTerm).toBe(150);
  });
});
