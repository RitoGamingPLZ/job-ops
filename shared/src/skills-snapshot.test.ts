import { describe, expect, it } from "vitest";
import { skillsSnapshot } from "./skills-snapshot";

describe("skillsSnapshot", () => {
  it("serializes visible names and keywords in order without row metadata", () => {
    expect(
      skillsSnapshot([
        {
          id: "one",
          name: " Languages ",
          keywords: [" TS ", "", "  ", "JS"],
          libraryId: "linked",
        },
        { name: "Secret", keywords: ["Hidden"], hidden: true },
        { name: " Tools ", keywords: [" Git "] },
      ]),
    ).toBe("Languages: TS, JS\nTools: Git");
  });

  it("handles empty groups and missing values", () => {
    expect(skillsSnapshot([])).toBe("");
    expect(skillsSnapshot([{ name: "Empty", keywords: [] }, {}])).toBe("Empty: \n: ");
  });
});
