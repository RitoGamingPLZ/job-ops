import type { WatchlistCompanyRating, WatchlistSource } from "@shared/types";
import ratingsFile from "./company-ratings.json";

const ratingsByCompany = new Map<string, WatchlistCompanyRating>(
  Object.entries(ratingsFile.companies).map(([label, rating]) => [toCompanyKey(label), rating]),
);

/** Normalizes a company label so one rating covers the same company on every adapter. */
function toCompanyKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function getCompanyRating(label: string): WatchlistCompanyRating | null {
  return ratingsByCompany.get(toCompanyKey(label)) ?? null;
}

export function withCompanyRatings(sources: WatchlistSource[]): WatchlistSource[] {
  return sources.map((source) => {
    const rating = getCompanyRating(source.label);
    return rating ? { ...source, rating } : source;
  });
}

export function listRatedCompanyLabels(): string[] {
  return Object.keys(ratingsFile.companies);
}

export function getCompanyRatingsReviewedAt(): string {
  return ratingsFile.reviewedAt;
}
