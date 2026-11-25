import { describe, expect, it } from "vitest";
import {
  getCoveredCatalogSourceIds,
  getNormalizedWatchlistCareersUrl,
  getWatchlistPreviewLabel,
  getWatchlistSelectionIdentityKey,
  getWatchlistSourceKey,
} from "./utils";

describe("getCoveredCatalogSourceIds", () => {
  const catalog = [
    {
      id: "gh-stripe",
      label: "Stripe",
      sourceType: "greenhouse",
      careersUrl: "https://job-boards.greenhouse.io/stripe",
      cxsJobsUrl: null,
    },
    {
      id: "cs-stripe",
      label: "Stripe",
      sourceType: "careers_site",
      careersUrl: "https://stripe.com/jobs",
      cxsJobsUrl: null,
    },
    {
      id: "gh-ramp",
      label: "Ramp",
      sourceType: "greenhouse",
      careersUrl: "https://job-boards.greenhouse.io/ramp",
      cxsJobsUrl: null,
    },
  ] satisfies Parameters<typeof getCoveredCatalogSourceIds>[1];

  const draft = (overrides: {
    catalogSourceId?: string | null;
    sourceType?: "greenhouse" | "careers_site";
    customUrl?: string;
  }) => ({
    catalogSourceId: null,
    sourceType: "greenhouse" as const,
    customUrl: "",
    ...overrides,
  });

  it("covers the same company listed under another adapter", () => {
    const covered = getCoveredCatalogSourceIds([draft({ catalogSourceId: "gh-stripe" })], catalog);
    expect([...covered].sort()).toEqual(["cs-stripe", "gh-stripe"]);
  });

  it("matches a custom URL to its catalog entry, ignoring scheme, www, query and slash", () => {
    const covered = getCoveredCatalogSourceIds(
      [draft({ customUrl: "http://www.job-boards.greenhouse.io/stripe/?gh_src=x" })],
      catalog,
    );
    expect([...covered].sort()).toEqual(["cs-stripe", "gh-stripe"]);
  });

  it("leaves unrelated companies and blank drafts uncovered", () => {
    const covered = getCoveredCatalogSourceIds(
      [draft({ customUrl: "" }), draft({ customUrl: "https://example.com/careers" })],
      catalog,
    );
    expect(covered.size).toBe(0);
  });
});

describe("getWatchlistSourceKey", () => {
  it("uses parsed tenant and site for myworkdaysite URLs", () => {
    expect(getWatchlistSourceKey("https://wd5.myworkdaysite.com/recruiting/acme/Careers")).toBe(
      "workday:acme:careers",
    );
  });

  it("distinguishes sources that share the same myworkdaysite host", () => {
    const acme = getWatchlistSourceKey("https://wd5.myworkdaysite.com/recruiting/acme/Careers");
    const globex = getWatchlistSourceKey("https://wd5.myworkdaysite.com/recruiting/globex/Jobs");

    expect(acme).toBe("workday:acme:careers");
    expect(globex).toBe("workday:globex:jobs");
    expect(acme).not.toBe(globex);
  });

  it("uses the same key for equivalent CXS endpoints", () => {
    expect(getWatchlistSourceKey("https://wd5.myworkdaysite.com/wday/cxs/acme/Careers/jobs")).toBe(
      "workday:acme:careers",
    );
  });

  it("normalizes BambooHR preview URLs to the careers root", () => {
    expect(
      getNormalizedWatchlistCareersUrl(
        "bamboohr",
        "https://ashteadtechnology.bamboohr.com/careers/134/detail",
      ),
    ).toBe("https://ashteadtechnology.bamboohr.com/careers");
  });

  it("derives a source-aware BambooHR preview label", () => {
    expect(
      getWatchlistPreviewLabel(
        "bamboohr",
        "https://ashteadtechnology.bamboohr.com/careers/134/detail",
      ),
    ).toBe("Ashteadtechnology");
  });

  it("matches equivalent BambooHR selections even when labels differ", () => {
    const saved = getWatchlistSelectionIdentityKey({
      catalogSourceId: null,
      sourceType: "bamboohr",
      careersUrl: "https://ashteadtechnology.bamboohr.com/careers",
    });
    const draft = getWatchlistSelectionIdentityKey({
      catalogSourceId: null,
      sourceType: "bamboohr",
      careersUrl: "https://ashteadtechnology.bamboohr.com/careers/134/detail",
    });

    expect(saved).toBe(draft);
  });
});
