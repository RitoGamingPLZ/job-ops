import ratingsFile from "./company-ratings.json";

export interface SeedCompanyRating {
  label: string;
  /** 0-10 work-life balance. */
  wlb: number;
  /** 0-10 pay relative to the company's industry. */
  salary: number;
}

/** Normalizes a company label so one rating covers the same company on every adapter. */
export function toCompanyKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Bundled starting ratings. They are copied into the `company_ratings` table when a company is
 * missing there and never overwrite what the database already holds.
 */
export function listSeedCompanyRatings(): SeedCompanyRating[] {
  return Object.entries(ratingsFile.companies).map(([label, rating]) => ({ label, ...rating }));
}

export function getSeedCompanyRating(label: string): SeedCompanyRating | null {
  const key = toCompanyKey(label);
  return listSeedCompanyRatings().find((seed) => toCompanyKey(seed.label) === key) ?? null;
}

export function getSeedRatingsReviewedAt(): string {
  return ratingsFile.reviewedAt;
}
