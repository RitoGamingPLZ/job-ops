import { describe, expect, it } from "vitest";
import {
  formatCountryLabel,
  getAdzunaCountryCode,
  getCountryIso2Code,
  getCountryNameVariants,
  normalizeCountryKey,
  SUPPORTED_COUNTRY_KEYS,
} from "./location-support";

describe("location-support", () => {
  it("normalizes country aliases", () => {
    expect(normalizeCountryKey("UK")).toBe("united kingdom");
    expect(normalizeCountryKey("us")).toBe("united states");
    expect(normalizeCountryKey("usa")).toBe("united states");
    expect(normalizeCountryKey("czech republic")).toBe("czechia");
    expect(normalizeCountryKey("the netherlands")).toBe("netherlands");
    expect(normalizeCountryKey("netherland")).toBe("netherlands");
  });

  it("resolves ISO-2 codes and localized country names", () => {
    expect(getCountryIso2Code("netherlands")).toBe("NL");
    expect(getCountryIso2Code("NL")).toBe("NL");
    expect(getCountryIso2Code("united kingdom")).toBe("GB");
    expect(getCountryIso2Code("USA")).toBe("US");
    expect(getCountryNameVariants("netherlands")).toContain("Nederland");
    expect(getCountryNameVariants("germany")).toContain("Deutschland");
    expect(getCountryNameVariants("spain")).toContain("España");
  });

  it("formats country labels", () => {
    expect(formatCountryLabel("united kingdom")).toBe("United Kingdom");
    expect(formatCountryLabel("usa/ca")).toBe("USA/CA");
    expect(formatCountryLabel("south korea")).toBe("South Korea");
  });

  it("keeps supported country keys unique and canonical", () => {
    expect(SUPPORTED_COUNTRY_KEYS).toContain("united kingdom");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("united states");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("russia");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("worldwide");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("uk");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("us");
  });

  it("maps adzuna country keys to adzuna api country codes", () => {
    expect(getAdzunaCountryCode("united states")).toBe("us");
    expect(getAdzunaCountryCode("UK")).toBe("gb");
    expect(getAdzunaCountryCode("japan")).toBeNull();
  });
});
