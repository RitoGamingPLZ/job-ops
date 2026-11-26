ALTER TABLE "watchlist_selected_sources" ADD COLUMN "description" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_shared_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "url_key" text NOT NULL UNIQUE,
  "source_type" text NOT NULL,
  "name" text NOT NULL,
  "careers_url" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "discovered_facets_json" text,
  "facets_scanned_at" text,
  "default_filter_plan_json" text,
  "filter_plan_updated_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_watchlist_shared_sources_source_type" ON "watchlist_shared_sources" ("source_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_filter_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "url_key" text NOT NULL,
  "source_type" text NOT NULL,
  "intent_hash" text NOT NULL,
  "plan_json" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_filter_plans_url_intent_unique" ON "watchlist_filter_plans" ("url_key", "intent_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_watchlist_filter_plans_url_key" ON "watchlist_filter_plans" ("url_key");
