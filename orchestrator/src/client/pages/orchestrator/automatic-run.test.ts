import { makeAuthToken } from "@client/test/auth-token";
import { parseTokenizedInput } from "@client/lib/tokenized-input";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTOMATIC_PRESETS,
  getRunMemoryStorageKey,
  inferAutomaticPresetSelection,
  loadAutomaticRunMemory,
  RUN_MEMORY_STORAGE_KEY,
  saveAutomaticRunMemory,
} from "./automatic-run";

describe("automatic-run utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("exposes the expected preset values", () => {
    expect(AUTOMATIC_PRESETS.fast).toEqual({
      topN: 5,
      minSuitabilityScore: 75,
      runBudget: 300,
    });

    expect(AUTOMATIC_PRESETS.detailed.topN).toBeGreaterThan(AUTOMATIC_PRESETS.fast.topN);
  });

  it("raises legacy custom budgets to the 300-job minimum", () => {
    localStorage.setItem(
      RUN_MEMORY_STORAGE_KEY,
      JSON.stringify({
        topN: 5,
        minSuitabilityScore: 65,
        runBudget: 25,
        presetId: "custom",
      }),
    );

    expect(loadAutomaticRunMemory()?.runBudget).toBe(300);
  });

  it("infers the balanced preset from legacy memory without an explicit preset id", () => {
    localStorage.setItem(
      RUN_MEMORY_STORAGE_KEY,
      JSON.stringify({
        topN: AUTOMATIC_PRESETS.balanced.topN,
        minSuitabilityScore: AUTOMATIC_PRESETS.balanced.minSuitabilityScore,
      }),
    );

    expect(loadAutomaticRunMemory()).toEqual({
      topN: AUTOMATIC_PRESETS.balanced.topN,
      minSuitabilityScore: AUTOMATIC_PRESETS.balanced.minSuitabilityScore,
      runBudget: AUTOMATIC_PRESETS.balanced.runBudget,
      presetId: "balanced",
    });
  });

  it("preserves explicit custom memory even when the numbers match a preset", () => {
    localStorage.setItem(
      RUN_MEMORY_STORAGE_KEY,
      JSON.stringify({
        topN: AUTOMATIC_PRESETS.balanced.topN,
        minSuitabilityScore: AUTOMATIC_PRESETS.balanced.minSuitabilityScore,
        runBudget: AUTOMATIC_PRESETS.balanced.runBudget,
        presetId: "custom",
      }),
    );

    expect(loadAutomaticRunMemory()).toEqual({
      topN: AUTOMATIC_PRESETS.balanced.topN,
      minSuitabilityScore: AUTOMATIC_PRESETS.balanced.minSuitabilityScore,
      runBudget: AUTOMATIC_PRESETS.balanced.runBudget,
      presetId: "custom",
    });
  });

  it("scopes run memory to the authenticated workspace", () => {
    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-one"));

    saveAutomaticRunMemory({
      topN: 6,
      minSuitabilityScore: 70,
      runBudget: 300,
      presetId: "custom",
    });

    expect(getRunMemoryStorageKey()).toBe(`${RUN_MEMORY_STORAGE_KEY}:workspace:tenant-one`);

    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-two"));
    expect(loadAutomaticRunMemory()).toBeNull();

    saveAutomaticRunMemory({
      topN: 12,
      minSuitabilityScore: 40,
      runBudget: 600,
      presetId: "custom",
    });

    expect(loadAutomaticRunMemory()).toMatchObject({
      topN: 12,
      minSuitabilityScore: 40,
    });

    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-one"));
    expect(loadAutomaticRunMemory()).toMatchObject({
      topN: 6,
      minSuitabilityScore: 70,
    });
  });

  it("migrates legacy run memory into the workspace-scoped key", () => {
    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-one"));
    localStorage.setItem(
      RUN_MEMORY_STORAGE_KEY,
      JSON.stringify({
        topN: 8,
        minSuitabilityScore: 65,
        runBudget: 350,
        presetId: "custom",
      }),
    );

    expect(loadAutomaticRunMemory()).toEqual({
      topN: 8,
      minSuitabilityScore: 65,
      runBudget: 350,
      presetId: "custom",
    });
    expect(localStorage.getItem(`${RUN_MEMORY_STORAGE_KEY}:workspace:tenant-one`)).toBe(
      localStorage.getItem(RUN_MEMORY_STORAGE_KEY),
    );
  });

  it("infers custom when legacy values do not match a preset", () => {
    expect(
      inferAutomaticPresetSelection({
        topN: 7,
        minSuitabilityScore: 60,
      }),
    ).toBe("custom");
  });

  it("parses comma and newline separated search terms", () => {
    expect(parseTokenizedInput("backend, platform\napi\n\n")).toEqual([
      "backend",
      "platform",
      "api",
    ]);
  });
});
