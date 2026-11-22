import type { ExtractorRegistry } from "@server/extractors/registry";
import type { PipelineSearchPresetConfig } from "@shared/types";
import { describe, expect, it, vi } from "vitest";

vi.mock("@server/extractors/registry", () => ({
  getExtractorRegistry: vi.fn(),
}));
vi.mock("@server/services/hosted-usage", () => ({
  withHostedUsageReservation: vi.fn(),
}));
vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: vi.fn(),
  resolveLlmModel: vi.fn(),
}));
vi.mock("@server/services/profile", () => ({ getProfile: vi.fn() }));

import { normalizePipelineSearchPlanConfig } from "./pipeline-search-plan";

const registry = {
  manifestBySource: new Map([["linkedin", {}]]),
  locationCapabilitiesBySource: {},
} as unknown as ExtractorRegistry;

const currentConfig: PipelineSearchPresetConfig = {
  searchTerms: ["Backend Engineer"],
  sources: ["linkedin"],
  country: "united kingdom",
  cityLocations: [],
  locationMode: "radius",
  proximity: { latitude: 54.5, longitude: -3, radiusMiles: 50 },
  workplaceTypes: ["hybrid"],
  searchScope: "selected_only",
  matchStrictness: "exact_only",
  topN: 10,
  minSuitabilityScore: 50,
  runBudget: 300,
  scoringInstructions: "",
};

describe("search plan location review", () => {
  it("uses generated cities instead of a previous map area", () => {
    const { config } = normalizePipelineSearchPlanConfig({
      currentConfig,
      registry,
      candidate: { cityLocations: ["Manchester"] },
    });
    expect(config).toMatchObject({
      locationMode: "cities",
      cityLocations: ["Manchester"],
      proximity: null,
    });
    expect(currentConfig.proximity).not.toBeNull();
  });

  it("keeps the current radius when no city was requested", () => {
    const { config } = normalizePipelineSearchPlanConfig({
      currentConfig,
      registry,
      candidate: { searchTerms: ["Platform Engineer"] },
    });
    expect(config.locationMode).toBe("radius");
    expect(config.proximity).toEqual(currentConfig.proximity);
  });

  it("does not carry search details between workspaces", () => {
    const secondWorkspace = {
      ...currentConfig,
      country: "united states",
      searchTerms: ["Data Analyst"],
      scoringInstructions: "Prefer healthcare",
    };
    const first = normalizePipelineSearchPlanConfig({
      currentConfig,
      registry,
      candidate: { cityLocations: ["Manchester"] },
    });
    const second = normalizePipelineSearchPlanConfig({
      currentConfig: secondWorkspace,
      registry,
      candidate: null,
    });
    expect(first.config.country).toBe("united kingdom");
    expect(second.config).toMatchObject({
      country: "united states",
      searchTerms: ["Data Analyst"],
      cityLocations: [],
      scoringInstructions: "Prefer healthcare",
      locationMode: "radius",
    });
    expect(secondWorkspace.cityLocations).toEqual([]);
  });
});

describe("search plan string normalization", () => {
  const normalize = (candidate: Record<string, unknown>) =>
    normalizePipelineSearchPlanConfig({
      currentConfig: { ...currentConfig, cityLocations: ["Leeds", "York"] },
      registry,
      candidate: candidate as Partial<PipelineSearchPresetConfig>,
    }).config;

  it("drops non-strings, truncates before deduping, and caps search terms", () => {
    const long = "x".repeat(200);
    const terms = normalize({
      searchTerms: [
        7,
        ` ${long}A`,
        `${long}b`,
        " Go ",
        "go",
        ...Array.from({ length: 20 }, (_, i) => `t${i}`),
      ],
    }).searchTerms;
    expect(terms).toEqual([
      long,
      "Go",
      ...Array.from({ length: 10 }, (_, i) => `t${i}`),
    ]);
  });

  it("falls back to current search terms when nothing usable remains", () => {
    expect(normalize({ searchTerms: [" ", 5] }).searchTerms).toEqual([
      "Backend Engineer",
    ]);
    expect(normalize({ searchTerms: "nope" }).searchTerms).toEqual([
      "Backend Engineer",
    ]);
  });

  it("keeps an explicitly empty city list but falls back for non-arrays", () => {
    expect(normalize({ cityLocations: [" ", 3] }).cityLocations).toEqual([]);
    expect(normalize({ cityLocations: "Leeds" }).cityLocations).toEqual([
      "Leeds",
      "York",
    ]);
    const long = "c".repeat(100);
    const cities = normalize({
      cityLocations: [
        `${long}1`,
        `${long.toUpperCase()}2`,
        ...Array.from({ length: 30 }, (_, i) => `c${i}`),
      ],
    }).cityLocations;
    expect(cities).toEqual([
      long,
      ...Array.from({ length: 24 }, (_, i) => `c${i}`),
    ]);
  });
});
