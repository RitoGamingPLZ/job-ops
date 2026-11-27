import { useSqliteTestDb } from "../testing/sqlite-test-db";
import type { WatchlistSource } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const source = (id: string, label: string, sourceType: WatchlistSource["sourceType"]) =>
  ({
    id,
    label,
    sourceType,
    careersUrl: `https://example.com/${id}`,
    cxsJobsUrl: null,
  }) satisfies WatchlistSource;

describe("company ratings repository", () => {
  const database = useSqliteTestDb();
  let repo: typeof import("./company-ratings");

  beforeEach(async () => {
    await database.open();
    repo = await import("./company-ratings");
  });

  afterEach(async () => {
    await database.close();
  });

  it("seeds the bundled ratings into SQL and attaches one rating to every adapter", async () => {
    const sources = await repo.withCompanyRatings([
      source("gh-stripe", "Stripe", "greenhouse"),
      source("cs-stripe", "Stripe", "careers_site"),
      source("nobody", "Not A Rated Company", "lever"),
    ]);

    expect(sources[0]?.rating).toEqual({
      wlb: 6,
      salary: 10,
      source: "editorial",
      ratedAt: expect.any(String),
    });
    expect(sources[1]?.rating).toEqual(sources[0]?.rating);
    expect(sources[2]?.rating).toBeUndefined();

    const { db, schema } = await import("../db/index");
    expect(db.select().from(schema.companyRatings).all().length).toBeGreaterThan(50);
  });

  it("lets an edit survive reseeding and stores fractional ratings", async () => {
    await repo.upsertCompanyRating({
      label: "stripe",
      wlb: 7.5,
      salary: null,
      source: "manual",
      sourceUrl: "https://example.com/review",
    });

    repo.resetCompanyRatingsSeedState();
    const [stripe] = await repo.withCompanyRatings([source("gh-stripe", "Stripe", "greenhouse")]);

    expect(stripe?.rating).toMatchObject({ wlb: 7.5, salary: null, source: "manual" });
  });

  it("rejects ratings outside 0 to 10", async () => {
    await expect(repo.upsertCompanyRating({ label: "Stripe", wlb: 11, salary: 5 })).rejects.toThrow(
      RangeError,
    );
    await expect(repo.upsertCompanyRating({ label: "Stripe", wlb: 5, salary: -1 })).rejects.toThrow(
      RangeError,
    );
    await expect(repo.upsertCompanyRating({ label: "  ", wlb: 5, salary: 5 })).rejects.toThrow(
      RangeError,
    );
  });
});
