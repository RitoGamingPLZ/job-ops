CREATE TABLE IF NOT EXISTS "company_ratings" (
  "id" text PRIMARY KEY NOT NULL,
  "company_key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "wlb_rating" real,
  "salary_rating" real,
  "source" text NOT NULL DEFAULT 'editorial',
  "source_url" text,
  "rated_at" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
