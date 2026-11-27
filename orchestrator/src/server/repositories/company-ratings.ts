import { randomUUID } from "node:crypto";
import {
  getSeedRatingsReviewedAt,
  listSeedCompanyRatings,
  toCompanyKey,
} from "@server/config/company-ratings";
import type { WatchlistCompanyRating, WatchlistSource } from "@shared/types";
import { db, schema } from "../db/index";
import { chunk, insertRowsPerStatement } from "../utils/sql-chunks";

// Explicitly global: these are public reference ratings shared across tenants.
const { companyRatings } = schema;

const COMPANY_RATING_MIN = 0;
const COMPANY_RATING_MAX = 10;

interface CompanyRatingInput {
  label: string;
  wlb: number | null;
  salary: number | null;
  source?: string;
  sourceUrl?: string | null;
}

let seeded = false;

/** Inserts bundled ratings for companies that have no row yet. Never overwrites existing rows. */
async function ensureCompanyRatingsSeeded(): Promise<void> {
  if (seeded) return;

  const ratedAt = getSeedRatingsReviewedAt();
  const now = new Date().toISOString();
  const rows = listSeedCompanyRatings().map((seed) => ({
    id: randomUUID(),
    companyKey: toCompanyKey(seed.label),
    label: seed.label,
    wlbRating: seed.wlb,
    salaryRating: seed.salary,
    source: "editorial",
    sourceUrl: null,
    ratedAt,
    createdAt: now,
    updatedAt: now,
  }));

  if (rows.length > 0) {
    // Cloudflare's SQLite rejects statements binding more than 100 parameters.
    const rowsPerStatement = insertRowsPerStatement(Object.keys(rows[0] ?? {}).length);
    for (const batch of chunk(rows, rowsPerStatement)) {
      db.insert(companyRatings).values(batch).onConflictDoNothing().run();
    }
  }
  seeded = true;
}

/** Test hook: forget that seeding already ran for the current database. */
/** @lintignore Repository tests call this through their isolated SQLite fixture. */
export function resetCompanyRatingsSeedState(): void {
  seeded = false;
}

async function listCompanyRatings(): Promise<Map<string, WatchlistCompanyRating>> {
  await ensureCompanyRatingsSeeded();
  const rows = db.select().from(companyRatings).all();

  return new Map(
    rows.map((row) => [
      row.companyKey,
      {
        wlb: row.wlbRating,
        salary: row.salaryRating,
        source: row.source,
        ratedAt: row.ratedAt,
      },
    ]),
  );
}

export async function withCompanyRatings(sources: WatchlistSource[]): Promise<WatchlistSource[]> {
  const ratings = await listCompanyRatings();

  return sources.map((source) => {
    const rating = ratings.get(toCompanyKey(source.label));
    return rating ? { ...source, rating } : source;
  });
}

function assertRatingInRange(name: string, value: number | null): void {
  if (value === null) return;
  if (!Number.isFinite(value) || value < COMPANY_RATING_MIN || value > COMPANY_RATING_MAX) {
    throw new RangeError(
      `${name} rating must be between ${COMPANY_RATING_MIN} and ${COMPANY_RATING_MAX}`,
    );
  }
}

/** Creates or replaces one company's rating. A later edit wins over the bundled seed. */
export async function upsertCompanyRating(
  input: CompanyRatingInput,
): Promise<WatchlistCompanyRating> {
  const label = input.label.trim();
  if (!label) throw new RangeError("Company label is required");
  assertRatingInRange("wlb", input.wlb);
  assertRatingInRange("salary", input.salary);

  const now = new Date().toISOString();
  const values = {
    label,
    wlbRating: input.wlb,
    salaryRating: input.salary,
    source: input.source?.trim() || "manual",
    sourceUrl: input.sourceUrl ?? null,
    ratedAt: now,
    updatedAt: now,
  };

  db.insert(companyRatings)
    .values({ id: randomUUID(), companyKey: toCompanyKey(label), ...values, createdAt: now })
    .onConflictDoUpdate({ target: companyRatings.companyKey, set: values })
    .run();

  return {
    wlb: values.wlbRating,
    salary: values.salaryRating,
    source: values.source,
    ratedAt: now,
  };
}
