import { describe, expect, it } from "vitest";
import { listCareerBoardSources } from "./career-boards";
import { listSeedCompanyRatings, toCompanyKey } from "./company-ratings";
import groupDefinitions from "./watchlist-groups.json";

describe("seed company ratings", () => {
  const seedByKey = new Map(
    listSeedCompanyRatings().map((seed) => [toCompanyKey(seed.label), seed]),
  );

  it("keeps every rating a number from 0 to 10", () => {
    for (const seed of listSeedCompanyRatings()) {
      for (const value of [seed.wlb, seed.salary]) {
        expect(Number.isFinite(value) && value >= 0 && value <= 10, seed.label).toBe(true);
      }
    }
  });

  it("has one seed per company", () => {
    const keys = listSeedCompanyRatings().map((seed) => toCompanyKey(seed.label));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("rates every company that appears in a group", () => {
    const unrated = groupDefinitions.flatMap((group) =>
      group.members
        .filter((member) => !seedByKey.has(toCompanyKey(member.label)))
        .map((member) => `${group.id}: ${member.label}`),
    );

    expect(unrated).toEqual([]);
  });

  it("only puts companies rated 8 or higher for work-life balance in the WLB group", () => {
    const wlbGroup = groupDefinitions.find((group) => group.id === "wlb-tech");
    expect(wlbGroup).toBeDefined();

    const low = (wlbGroup?.members ?? []).filter(
      (member) => (seedByKey.get(toCompanyKey(member.label))?.wlb ?? 0) < 8,
    );
    expect(low.map((member) => member.label)).toEqual([]);
  });

  it("has no seed for a company that is missing from the catalog", async () => {
    const catalogLabels = new Set((await listCareerBoardSources()).map((source) => source.label));
    const stale = listSeedCompanyRatings()
      .map((seed) => seed.label)
      .filter((label) => !catalogLabels.has(label));

    expect(stale).toEqual([]);
  });
});
