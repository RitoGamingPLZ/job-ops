CREATE TABLE IF NOT EXISTS "account_subscriptions" (
  "user_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "stripe_subscription_id" text,
  "stripe_subscription_created_at" integer,
  "stripe_price_id" text,
  "stripe_status" text,
  "current_period_end" integer,
  "cancel_at_period_end" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_subscriptions_tenant_user_unique" ON "account_subscriptions" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_subscriptions_customer_unique" ON "account_subscriptions" ("stripe_customer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_subscriptions_subscription_unique" ON "account_subscriptions" ("stripe_subscription_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_install_state" (
  "id" text PRIMARY KEY NOT NULL,
  "distinct_id" text NOT NULL,
  "installed_at" text NOT NULL,
  "raw_event_replay_version" integer NOT NULL DEFAULT 0,
  "raw_event_replay_completed_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_milestones" (
  "milestone" text PRIMARY KEY NOT NULL,
  "first_seen_at" integer NOT NULL,
  "first_session_id" text,
  "reported_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_milestones_first_seen_at" ON "analytics_milestones" ("first_seen_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_server_event_replays" (
  "event_key" text PRIMARY KEY NOT NULL,
  "event_name" text NOT NULL,
  "occurred_at" integer NOT NULL,
  "payload" text NOT NULL,
  "claimed_at" integer,
  "reported_at" integer,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_server_event_replays_event_name" ON "analytics_server_event_replays" ("event_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_analytics_server_event_replays_occurred_at" ON "analytics_server_event_replays" ("occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text,
  "subject" text NOT NULL,
  "user_id" text,
  "expires_at" integer NOT NULL,
  "revoked_at" integer,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires_at" ON "auth_sessions" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_revoked_at" ON "auth_sessions" ("revoked_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "design_resume_assets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "document_id" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'picture',
  "original_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "storage_path" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("document_id") REFERENCES "design_resume_documents"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_design_resume_assets_document_id" ON "design_resume_assets" ("document_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "design_resume_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "title" text NOT NULL,
  "resume_json" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "source_resume_id" text,
  "source_mode" text,
  "imported_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experience_bullets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "kind" text NOT NULL DEFAULT 'bullet',
  "data" text,
  "parent_id" text,
  "position" integer NOT NULL DEFAULT 0,
  "text" text NOT NULL,
  "company" text,
  "role" text,
  "start_date" text,
  "end_date" text,
  "tags" text NOT NULL,
  "source" text NOT NULL DEFAULT 'manual',
  "source_experience_id" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_experience_bullets_scope" ON "experience_bullets" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hosted_usage_counters" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "period" text NOT NULL,
  "action" text NOT NULL,
  "used_units" integer NOT NULL DEFAULT 0,
  "reserved_units" integer NOT NULL DEFAULT 0,
  "limit_units" integer NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_hosted_usage_counters_tenant_user_period_action_unique" ON "hosted_usage_counters" ("tenant_id", "user_id", "period", "action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hosted_usage_counters_tenant_user_period" ON "hosted_usage_counters" ("tenant_id", "user_id", "period");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hosted_usage_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "period" text NOT NULL,
  "action" text NOT NULL,
  "reserved_units" integer NOT NULL,
  "used_units" integer NOT NULL DEFAULT 0,
  "refunded_units" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'reserved',
  "idempotency_key" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hosted_usage_reservations_tenant_user_period" ON "hosted_usage_reservations" ("tenant_id", "user_id", "period");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_hosted_usage_reservations_idempotency_unique" ON "hosted_usage_reservations" ("tenant_id", "user_id", "period", "action", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interviews" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "application_id" text NOT NULL,
  "scheduled_at" integer NOT NULL,
  "duration_mins" integer,
  "type" text NOT NULL,
  "outcome" text,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("application_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_chat_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "thread_id" text NOT NULL,
  "job_id" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'partial',
  "tokens_in" integer,
  "tokens_out" integer,
  "version" integer NOT NULL DEFAULT 1,
  "replaces_message_id" text,
  "parent_message_id" text,
  "active_child_id" text,
  "attachments" text NOT NULL DEFAULT '[]',
  "suggestions" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("thread_id") REFERENCES "job_chat_threads"("id") ON DELETE CASCADE,
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_chat_messages_thread_created" ON "job_chat_messages" ("thread_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_chat_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "thread_id" text NOT NULL,
  "job_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "model" text,
  "provider" text,
  "error_code" text,
  "error_message" text,
  "started_at" integer NOT NULL,
  "completed_at" integer,
  "request_id" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("thread_id") REFERENCES "job_chat_threads"("id") ON DELETE CASCADE,
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_chat_runs_thread_status" ON "job_chat_runs" ("thread_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_chat_threads" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "job_id" text NOT NULL,
  "title" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  "last_message_at" text,
  "active_root_message_id" text,
  "selected_note_ids" text NOT NULL DEFAULT '[]',
  "selected_email_ids" text NOT NULL DEFAULT '[]',
  "selected_document_ids" text NOT NULL DEFAULT '[]',
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_chat_threads_job_updated" ON "job_chat_threads" ("job_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "job_id" text NOT NULL,
  "file_name" text NOT NULL,
  "media_type" text,
  "byte_size" integer NOT NULL,
  "storage_path" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_documents_job_id" ON "job_documents" ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_documents_tenant_job_id" ON "job_documents" ("tenant_id", "job_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "job_id" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_notes_job_updated" ON "job_notes" ("job_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_resumes" (
  "job_id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "document" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_resumes_scope" ON "job_resumes" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "source" text NOT NULL DEFAULT 'gradcracker',
  "source_job_id" text,
  "posting_id" text,
  "job_url_direct" text,
  "date_posted" text,
  "title" text NOT NULL,
  "employer" text NOT NULL,
  "employer_url" text,
  "job_url" text NOT NULL,
  "application_link" text,
  "disciplines" text,
  "deadline" text,
  "salary" text,
  "location" text,
  "location_evidence" text,
  "degree_required" text,
  "starting" text,
  "job_description" text,
  "job_type" text,
  "salary_source" text,
  "salary_interval" text,
  "salary_min_amount" real,
  "salary_max_amount" real,
  "salary_currency" text,
  "is_remote" integer,
  "job_level" text,
  "job_function" text,
  "listing_type" text,
  "emails" text,
  "company_industry" text,
  "company_logo" text,
  "company_url_direct" text,
  "company_addresses" text,
  "company_num_employees" text,
  "company_revenue" text,
  "company_description" text,
  "skills" text,
  "experience_range" text,
  "company_rating" real,
  "company_reviews_count" integer,
  "vacancy_count" integer,
  "work_from_home_type" text,
  "status" text NOT NULL DEFAULT 'discovered',
  "outcome" text,
  "closed_at" integer,
  "generation_error" text,
  "suitability_score" real,
  "suitability_reason" text,
  "job_brief" text,
  "tailored_summary" text,
  "tailored_headline" text,
  "tailored_skills" text,
  "selected_project_ids" text,
  "pdf_path" text,
  "pdf_source" text,
  "pdf_regenerating" integer NOT NULL DEFAULT 0,
  "pdf_fingerprint" text,
  "pdf_generated_at" text,
  "discovered_at" text NOT NULL DEFAULT (datetime('now')),
  "processed_at" text,
  "ready_at" text,
  "applied_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_tenant_user_job_url_unique" ON "jobs" ("tenant_id", coalesce("user_id", ''), "job_url");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_tenant_user_posting_id_unique" ON "jobs" ("tenant_id", coalesce("user_id", ''), "posting_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_tenant_user_status" ON "jobs" ("tenant_id", "user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_tenant_discovered_at" ON "jobs" ("tenant_id", "discovered_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "started_at" text NOT NULL DEFAULT (datetime('now')),
  "completed_at" text,
  "status" text NOT NULL DEFAULT 'running',
  "jobs_discovered" integer NOT NULL DEFAULT 0,
  "jobs_processed" integer NOT NULL DEFAULT 0,
  "tasks_total" integer NOT NULL DEFAULT 0,
  "tasks_done" integer NOT NULL DEFAULT 0,
  "tasks_failed" integer NOT NULL DEFAULT 0,
  "tasks_cached" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "config_snapshot" text,
  "requested_config" text,
  "effective_config" text,
  "result_summary" text,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_search_presets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "config" text NOT NULL,
  "last_used_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pipeline_search_presets_tenant_user_name_unique" ON "pipeline_search_presets" ("tenant_id", "user_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pipeline_search_presets_tenant_user_updated" ON "pipeline_search_presets" ("tenant_id", "user_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_application_integrations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "provider" text NOT NULL,
  "account_key" text NOT NULL DEFAULT 'default',
  "display_name" text,
  "status" text NOT NULL DEFAULT 'disconnected',
  "credentials" text,
  "last_connected_at" integer,
  "last_synced_at" integer,
  "last_error" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_app_integrations_tenant_user_provider_account_unique" ON "post_application_integrations" ("tenant_id", coalesce("user_id", ''), "provider", "account_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_application_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "provider" text NOT NULL,
  "account_key" text NOT NULL DEFAULT 'default',
  "integration_id" text,
  "sync_run_id" text,
  "external_message_id" text NOT NULL,
  "external_thread_id" text,
  "from_address" text NOT NULL DEFAULT '',
  "from_domain" text,
  "sender_name" text,
  "subject" text NOT NULL DEFAULT '',
  "received_at" integer NOT NULL,
  "snippet" text NOT NULL DEFAULT '',
  "classification_label" text,
  "classification_confidence" real,
  "classification_payload" text,
  "relevance_llm_score" real,
  "relevance_decision" text NOT NULL DEFAULT 'needs_llm',
  "match_confidence" integer,
  "message_type" text NOT NULL DEFAULT 'other',
  "stage_event_payload" text,
  "processing_status" text NOT NULL DEFAULT 'pending_user',
  "matched_job_id" text,
  "decided_at" integer,
  "decided_by" text,
  "error_code" text,
  "error_message" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("integration_id") REFERENCES "post_application_integrations"("id") ON DELETE SET NULL,
  FOREIGN KEY ("sync_run_id") REFERENCES "post_application_sync_runs"("id") ON DELETE SET NULL,
  FOREIGN KEY ("matched_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_app_messages_tenant_user_provider_account_external_unique" ON "post_application_messages" ("tenant_id", coalesce("user_id", ''), "provider", "account_key", "external_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_app_messages_provider_account_processing_status" ON "post_application_messages" ("provider", "account_key", "processing_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_application_sync_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "provider" text NOT NULL,
  "account_key" text NOT NULL DEFAULT 'default',
  "integration_id" text,
  "status" text NOT NULL DEFAULT 'running',
  "started_at" integer NOT NULL,
  "completed_at" integer,
  "messages_discovered" integer NOT NULL DEFAULT 0,
  "messages_relevant" integer NOT NULL DEFAULT 0,
  "messages_classified" integer NOT NULL DEFAULT 0,
  "messages_matched" integer NOT NULL DEFAULT 0,
  "messages_approved" integer NOT NULL DEFAULT 0,
  "messages_denied" integer NOT NULL DEFAULT 0,
  "messages_errored" integer NOT NULL DEFAULT 0,
  "error_code" text,
  "error_message" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("integration_id") REFERENCES "post_application_integrations"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_app_sync_runs_provider_account_started_at" ON "post_application_sync_runs" ("provider", "account_key", "started_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "postings" (
  "id" text PRIMARY KEY NOT NULL,
  "url_norm" text NOT NULL,
  "source" text NOT NULL,
  "company" text NOT NULL,
  "title" text NOT NULL,
  "location" text,
  "description" text,
  "posted_at" text,
  "first_seen_at" text NOT NULL DEFAULT (datetime('now')),
  "last_seen_at" text NOT NULL DEFAULT (datetime('now')),
  "extracted" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_postings_url_norm_unique" ON "postings" ("url_norm");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_postings_last_seen_at" ON "postings" ("last_seen_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrape_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "scrape_key" text NOT NULL,
  "window_start" text NOT NULL,
  "source" text NOT NULL,
  "runtime" text NOT NULL DEFAULT 'container',
  "target" text NOT NULL DEFAULT '',
  "title_norm" text NOT NULL,
  "location" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "lease_until" text,
  "completed_at" text,
  "result_key" text,
  "postings_found" integer NOT NULL DEFAULT 0,
  "posting_ids" text,
  "error" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_scrape_tasks_key_window_unique" ON "scrape_tasks" ("scrape_key", "window_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scrape_tasks_status_lease" ON "scrape_tasks" ("status", "lease_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scrape_tasks_source_status" ON "scrape_tasks" ("source", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_settings_tenant_user_key_unique" ON "settings" ("tenant_id", coalesce("user_id", ''), "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_recipes" (
  "id" text PRIMARY KEY NOT NULL,
  "host" text NOT NULL UNIQUE,
  "tier" integer NOT NULL,
  "recipe" text,
  "version" integer NOT NULL DEFAULT 1,
  "learned_at" text NOT NULL,
  "last_success_at" text,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "blocked_reason" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_state" (
  "source" text PRIMARY KEY NOT NULL,
  "in_flight" integer NOT NULL DEFAULT 0,
  "last_dispatch_at" text,
  "requests_today" integer NOT NULL DEFAULT 0,
  "day" text,
  "cooldown_until" text,
  "cooldown_level" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_identities" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "provider" text NOT NULL,
  "issuer" text NOT NULL,
  "subject" text NOT NULL,
  "email" text,
  "display_name" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("provider", "issuer", "subject"),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sso_identities_user_id" ON "sso_identities" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "application_id" text NOT NULL,
  "title" text NOT NULL,
  "group_id" text,
  "from_stage" text,
  "to_stage" text NOT NULL,
  "occurred_at" integer NOT NULL,
  "metadata" text,
  "outcome" text,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("application_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_subscribers" (
  "task_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "run_id" text NOT NULL,
  "notified_at" text,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY ("task_id", "tenant_id", "run_id"),
  FOREIGN KEY ("task_id") REFERENCES "scrape_tasks"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_subscribers_run_id" ON "task_subscribers" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text,
  "application_id" text NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "due_date" integer,
  "is_completed" integer NOT NULL DEFAULT 0,
  "notes" text,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("application_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'owner',
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_memberships_user_tenant" ON "tenant_memberships" ("user_id", "tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_memberships_tenant_id" ON "tenant_memberships" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "display_name" text,
  "password_hash" text,
  "password_salt" text,
  "is_system_admin" integer NOT NULL DEFAULT 0,
  "is_disabled" integer NOT NULL DEFAULT 0,
  "must_change_password" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username_unique" ON "users" ("username");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "last_checked_at" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_checks_tenant_user_unique" ON "watchlist_checks" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_job_states" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "source" text NOT NULL,
  "source_job_id" text NOT NULL,
  "state" text NOT NULL DEFAULT 'ignored',
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_job_states_tenant_user_source_job_unique" ON "watchlist_job_states" ("tenant_id", "user_id", "source", "source_job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_watchlist_job_states_tenant_user_state" ON "watchlist_job_states" ("tenant_id", "user_id", "state");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_seen_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "source" text NOT NULL,
  "source_job_id" text NOT NULL,
  "first_seen_at" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_seen_jobs_tenant_user_source_job_unique" ON "watchlist_seen_jobs" ("tenant_id", "user_id", "source", "source_job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_watchlist_seen_jobs_tenant_user_last_seen" ON "watchlist_seen_jobs" ("tenant_id", "user_id", "last_seen_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlist_selected_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'tenant_default',
  "user_id" text NOT NULL,
  "catalog_source_id" text,
  "label" text NOT NULL,
  "careers_url" text NOT NULL,
  "cxs_jobs_url" text,
  "source_type" text NOT NULL,
  "is_custom" integer NOT NULL DEFAULT 0,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_selected_sources_tenant_user_sort_order" ON "watchlist_selected_sources" ("tenant_id", "user_id", "sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_selected_sources_tenant_user_careers_url" ON "watchlist_selected_sources" ("tenant_id", "user_id", "careers_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_watchlist_selected_sources_tenant_user" ON "watchlist_selected_sources" ("tenant_id", "user_id");
