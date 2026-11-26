CREATE TABLE IF NOT EXISTS "watchlist_source_results" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "source_key" text NOT NULL,
  "status" text NOT NULL,
  "result_json" text NOT NULL,
  "checked_at" text NOT NULL,
  "previous_checked_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_source_results_tenant_user_source_unique" ON "watchlist_source_results" ("tenant_id", "user_id", "source_key");
