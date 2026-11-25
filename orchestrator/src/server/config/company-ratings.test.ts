import { describe, expect, it } from "vitest";
import { listCareerBoardSources } from "./career-boards";
import { getCompanyRating, listRatedCompanyLabels, withCompanyRatings } from "./company-ratings";
import { listWatchlistGroupDefinitions } from "./watchlist-groups";

describe("company ratings", () => {
  it("keeps every rating an integer from 1 to 5", () => {
    for (const label of listRatedCompanyLabels()) {
      const rating = getCompanyRating(label);
      expect(rating, label).not.toBeNull();
      for (const value of [rating?.wlb, rating?.salary]) {
        expect(Number.isInteger(value) && (value ?? 0) >= 1 && (value ?? 0) <= 5, label).toBe(true);
      }
    }
  });

  it("rates every company that appears in a group", () => {
    const unrated = listWatchlistGroupDefinitions().flatMap((group) =>
      group.members
        .filter((member) => getCompanyRating(member.label) === null)
        .map((member) => `${group.id}: ${member.label}`),
    );

    expect(unrated).toEqual([]);
  });

  it("only puts companies rated 4 or 5 for work-life balance in the WLB group", () => {
    const wlbGroup = listWatchlistGroupDefinitions().find((group) => group.id === "wlb-tech");
    expect(wlbGroup).toBeDefined();

    const low = (wlbGroup?.members ?? []).filter(
      (member) => (getCompanyRating(member.label)?.wlb ?? 0) < 4,
    );
    expect(low.map((member) => member.label)).toEqual([]);
  });

  it("has no rating for a company that is missing from the catalog", async () => {
    const catalogLabels = new Set((await listCareerBoardSources()).map((source) => source.label));
    const stale = listRatedCompanyLabels().filter((label) => !catalogLabels.has(label));

    expect(stale).toEqual([]);
  });

  it("attaches one rating to the same company on every adapter", async () => {
    const stripe = withCompanyRatings(await listCareerBoardSources()).filter(
      (source) => source.label === "Stripe",
    );

    expect(stripe.length).toBeGreaterThan(1);
    for (const source of stripe) {
      expect(source.rating).toEqual({ wlb: 3, salary: 5 });
    }
  });
});
