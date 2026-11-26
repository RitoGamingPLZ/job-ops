import { describe, expect, it } from "vitest";
import {
  EXTRACTOR_SOURCE_IDS,
  EXTRACTOR_SOURCE_METADATA,
  extractorSourceEnum,
  isExtractorSourceId,
  sourceLabel,
} from "./index";

describe("extractor source catalog", () => {
  it("validates known source ids", () => {
    expect(EXTRACTOR_SOURCE_IDS).toEqual([
      "indeed",
      "linkedin",
      "adzuna",
      "hiringcafe",
      "jobindex",
      "freehire",
      "manual",
    ]);
    for (const source of EXTRACTOR_SOURCE_IDS) {
      expect(extractorSourceEnum.parse(source)).toBe(source);
      expect(isExtractorSourceId(source)).toBe(true);
    }
  });

  it("rejects unknown or retired source ids", () => {
    expect(isExtractorSourceId("unknown-source")).toBe(false);
    expect(isExtractorSourceId("gradcracker")).toBe(false);
    expect(() => extractorSourceEnum.parse("unknown-source")).toThrow();
    expect(() => extractorSourceEnum.parse("gradcracker")).toThrow();
  });

  it("provides metadata for every known source", () => {
    for (const source of EXTRACTOR_SOURCE_IDS) {
      expect(EXTRACTOR_SOURCE_METADATA[source]).toBeDefined();
      expect(EXTRACTOR_SOURCE_METADATA[source].label.length).toBeGreaterThan(0);
    }
  });

  it("falls back cleanly for retired source ids in historical records", () => {
    expect(sourceLabel("linkedin")).toBe("LinkedIn");
    expect(sourceLabel("gradcracker")).toBe("gradcracker");
  });
});
