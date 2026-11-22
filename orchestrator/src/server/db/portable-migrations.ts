/**
 * Portable ordered SQL migrations usable by both better-sqlite3 and Cloudflare Durable Object SqlStorage.
 * Zero Node-only imports so this module can run inside Workers/Durable Objects as well as Node.
 */

export interface PortableSqlExecutor {
  exec(sqlText: string): void;
  query<T = Record<string, unknown>>(sqlText: string, params?: unknown[]): T[];
  run(sqlText: string, params?: unknown[]): void;
}

export interface BetterSqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

export interface DoSqlStorageLike {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): Iterable<T> & { toArray?: () => T[] };
}

export type PortableMigrationTarget = PortableSqlExecutor | BetterSqliteLike | DoSqlStorageLike;

export interface PortableMigration {
  id: string;
  name: string;
  statements: readonly string[];
}

export interface PortableMigrationResult {
  applied: string[];
  skipped: string[];
  total: number;
}

export function createBetterSqliteExecutor(sqlite: BetterSqliteLike): PortableSqlExecutor {
  return {
    exec(sqlText: string) {
      sqlite.exec(sqlText);
    },
    query<T = Record<string, unknown>>(sqlText: string, params: unknown[] = []): T[] {
      return sqlite.prepare(sqlText).all(...params) as T[];
    },
    run(sqlText: string, params: unknown[] = []) {
      sqlite.prepare(sqlText).run(...params);
    },
  };
}

export function createDoSqlStorageExecutor(sqlStorage: DoSqlStorageLike): PortableSqlExecutor {
  return {
    exec(sqlText: string) {
      sqlStorage.exec(sqlText);
    },
    query<T = Record<string, unknown>>(sqlText: string, params: unknown[] = []): T[] {
      const cursor = sqlStorage.exec<T>(sqlText, ...params);
      if (typeof cursor.toArray === "function") {
        return cursor.toArray();
      }
      return Array.from(cursor);
    },
    run(sqlText: string, params: unknown[] = []) {
      sqlStorage.exec(sqlText, ...params);
    },
  };
}

export function toPortableSqlExecutor(target: PortableMigrationTarget): PortableSqlExecutor {
  if (
    "query" in target &&
    typeof target.query === "function" &&
    "run" in target &&
    typeof target.run === "function"
  ) {
    return target;
  }
  if ("prepare" in target && typeof target.prepare === "function") {
    return createBetterSqliteExecutor(target);
  }
  return createDoSqlStorageExecutor(target as DoSqlStorageLike);
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function computeMigrationChecksum(statements: readonly string[]): string {
  return fnv1aHex(statements.join("\n"));
}

export const PORTABLE_MIGRATIONS: readonly PortableMigration[] = [
  {
    id: "0001",
    name: "0001_baseline",
    statements: [
      'CREATE TABLE IF NOT EXISTS "account_subscriptions" (\n  "user_id" text NOT NULL,\n  "tenant_id" text NOT NULL,\n  "stripe_customer_id" text NOT NULL,\n  "stripe_subscription_id" text,\n  "stripe_subscription_created_at" integer,\n  "stripe_price_id" text,\n  "stripe_status" text,\n  "current_period_end" integer,\n  "cancel_at_period_end" integer NOT NULL DEFAULT 0,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_subscriptions_tenant_user_unique" ON "account_subscriptions" ("tenant_id", "user_id");',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_subscriptions_customer_unique" ON "account_subscriptions" ("stripe_customer_id");',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_subscriptions_subscription_unique" ON "account_subscriptions" ("stripe_subscription_id");',
      'CREATE TABLE IF NOT EXISTS "analytics_install_state" (\n  "id" text PRIMARY KEY NOT NULL,\n  "distinct_id" text NOT NULL,\n  "installed_at" text NOT NULL,\n  "raw_event_replay_version" integer NOT NULL DEFAULT 0,\n  "raw_event_replay_completed_at" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE TABLE IF NOT EXISTS "analytics_milestones" (\n  "milestone" text PRIMARY KEY NOT NULL,\n  "first_seen_at" integer NOT NULL,\n  "first_session_id" text,\n  "reported_at" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE INDEX IF NOT EXISTS "idx_analytics_milestones_first_seen_at" ON "analytics_milestones" ("first_seen_at");',
      'CREATE TABLE IF NOT EXISTS "analytics_server_event_replays" (\n  "event_key" text PRIMARY KEY NOT NULL,\n  "event_name" text NOT NULL,\n  "occurred_at" integer NOT NULL,\n  "payload" text NOT NULL,\n  "claimed_at" integer,\n  "reported_at" integer,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE INDEX IF NOT EXISTS "idx_analytics_server_event_replays_event_name" ON "analytics_server_event_replays" ("event_name");',
      'CREATE INDEX IF NOT EXISTS "idx_analytics_server_event_replays_occurred_at" ON "analytics_server_event_replays" ("occurred_at");',
      'CREATE TABLE IF NOT EXISTS "auth_sessions" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text,\n  "subject" text NOT NULL,\n  "user_id" text,\n  "expires_at" integer NOT NULL,\n  "revoked_at" integer,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_auth_sessions_expires_at" ON "auth_sessions" ("expires_at");',
      'CREATE INDEX IF NOT EXISTS "idx_auth_sessions_revoked_at" ON "auth_sessions" ("revoked_at");',
      'CREATE TABLE IF NOT EXISTS "design_resume_assets" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "document_id" text NOT NULL,\n  "kind" text NOT NULL DEFAULT \'picture\',\n  "original_name" text NOT NULL,\n  "mime_type" text NOT NULL,\n  "byte_size" integer NOT NULL,\n  "storage_path" text NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("document_id") REFERENCES "design_resume_documents"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_design_resume_assets_document_id" ON "design_resume_assets" ("document_id");',
      'CREATE TABLE IF NOT EXISTS "design_resume_documents" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "title" text NOT NULL,\n  "resume_json" text NOT NULL,\n  "revision" integer NOT NULL DEFAULT 1,\n  "source_resume_id" text,\n  "source_mode" text,\n  "imported_at" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE TABLE IF NOT EXISTS "experience_bullets" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "kind" text NOT NULL DEFAULT \'bullet\',\n  "data" text,\n  "parent_id" text,\n  "position" integer NOT NULL DEFAULT 0,\n  "text" text NOT NULL,\n  "company" text,\n  "role" text,\n  "start_date" text,\n  "end_date" text,\n  "tags" text NOT NULL,\n  "source" text NOT NULL DEFAULT \'manual\',\n  "source_experience_id" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_experience_bullets_scope" ON "experience_bullets" ("tenant_id", "user_id");',
      'CREATE TABLE IF NOT EXISTS "hosted_usage_counters" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL,\n  "user_id" text NOT NULL,\n  "period" text NOT NULL,\n  "action" text NOT NULL,\n  "used_units" integer NOT NULL DEFAULT 0,\n  "reserved_units" integer NOT NULL DEFAULT 0,\n  "limit_units" integer NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_hosted_usage_counters_tenant_user_period_action_unique" ON "hosted_usage_counters" ("tenant_id", "user_id", "period", "action");',
      'CREATE INDEX IF NOT EXISTS "idx_hosted_usage_counters_tenant_user_period" ON "hosted_usage_counters" ("tenant_id", "user_id", "period");',
      'CREATE TABLE IF NOT EXISTS "hosted_usage_reservations" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL,\n  "user_id" text NOT NULL,\n  "period" text NOT NULL,\n  "action" text NOT NULL,\n  "reserved_units" integer NOT NULL,\n  "used_units" integer NOT NULL DEFAULT 0,\n  "refunded_units" integer NOT NULL DEFAULT 0,\n  "status" text NOT NULL DEFAULT \'reserved\',\n  "idempotency_key" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_hosted_usage_reservations_tenant_user_period" ON "hosted_usage_reservations" ("tenant_id", "user_id", "period");',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_hosted_usage_reservations_idempotency_unique" ON "hosted_usage_reservations" ("tenant_id", "user_id", "period", "action", "idempotency_key");',
      'CREATE TABLE IF NOT EXISTS "interviews" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "application_id" text NOT NULL,\n  "scheduled_at" integer NOT NULL,\n  "duration_mins" integer,\n  "type" text NOT NULL,\n  "outcome" text,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("application_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE TABLE IF NOT EXISTS "job_chat_messages" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "thread_id" text NOT NULL,\n  "job_id" text NOT NULL,\n  "role" text NOT NULL,\n  "content" text NOT NULL DEFAULT \'\',\n  "status" text NOT NULL DEFAULT \'partial\',\n  "tokens_in" integer,\n  "tokens_out" integer,\n  "version" integer NOT NULL DEFAULT 1,\n  "replaces_message_id" text,\n  "parent_message_id" text,\n  "active_child_id" text,\n  "attachments" text NOT NULL DEFAULT \'[]\',\n  "suggestions" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("thread_id") REFERENCES "job_chat_threads"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_job_chat_messages_thread_created" ON "job_chat_messages" ("thread_id", "created_at");',
      'CREATE TABLE IF NOT EXISTS "job_chat_runs" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "thread_id" text NOT NULL,\n  "job_id" text NOT NULL,\n  "status" text NOT NULL DEFAULT \'running\',\n  "model" text,\n  "provider" text,\n  "error_code" text,\n  "error_message" text,\n  "started_at" integer NOT NULL,\n  "completed_at" integer,\n  "request_id" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("thread_id") REFERENCES "job_chat_threads"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_job_chat_runs_thread_status" ON "job_chat_runs" ("thread_id", "status");',
      'CREATE TABLE IF NOT EXISTS "job_chat_threads" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "job_id" text NOT NULL,\n  "title" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "last_message_at" text,\n  "active_root_message_id" text,\n  "selected_note_ids" text NOT NULL DEFAULT \'[]\',\n  "selected_email_ids" text NOT NULL DEFAULT \'[]\',\n  "selected_document_ids" text NOT NULL DEFAULT \'[]\',\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_job_chat_threads_job_updated" ON "job_chat_threads" ("job_id", "updated_at");',
      'CREATE TABLE IF NOT EXISTS "job_documents" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "job_id" text NOT NULL,\n  "file_name" text NOT NULL,\n  "media_type" text,\n  "byte_size" integer NOT NULL,\n  "storage_path" text NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_job_documents_job_id" ON "job_documents" ("job_id");',
      'CREATE INDEX IF NOT EXISTS "idx_job_documents_tenant_job_id" ON "job_documents" ("tenant_id", "job_id");',
      'CREATE TABLE IF NOT EXISTS "job_notes" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "job_id" text NOT NULL,\n  "title" text NOT NULL,\n  "content" text NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_job_notes_job_updated" ON "job_notes" ("job_id", "updated_at");',
      'CREATE TABLE IF NOT EXISTS "job_resumes" (\n  "job_id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "document" text NOT NULL,\n  "revision" integer NOT NULL DEFAULT 1,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_job_resumes_scope" ON "job_resumes" ("tenant_id", "user_id");',
      'CREATE TABLE IF NOT EXISTS "jobs" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "source" text NOT NULL DEFAULT \'gradcracker\',\n  "source_job_id" text,\n  "posting_id" text,\n  "job_url_direct" text,\n  "date_posted" text,\n  "title" text NOT NULL,\n  "employer" text NOT NULL,\n  "employer_url" text,\n  "job_url" text NOT NULL,\n  "application_link" text,\n  "disciplines" text,\n  "deadline" text,\n  "salary" text,\n  "location" text,\n  "location_evidence" text,\n  "degree_required" text,\n  "starting" text,\n  "job_description" text,\n  "job_type" text,\n  "salary_source" text,\n  "salary_interval" text,\n  "salary_min_amount" real,\n  "salary_max_amount" real,\n  "salary_currency" text,\n  "is_remote" integer,\n  "job_level" text,\n  "job_function" text,\n  "listing_type" text,\n  "emails" text,\n  "company_industry" text,\n  "company_logo" text,\n  "company_url_direct" text,\n  "company_addresses" text,\n  "company_num_employees" text,\n  "company_revenue" text,\n  "company_description" text,\n  "skills" text,\n  "experience_range" text,\n  "company_rating" real,\n  "company_reviews_count" integer,\n  "vacancy_count" integer,\n  "work_from_home_type" text,\n  "status" text NOT NULL DEFAULT \'discovered\',\n  "outcome" text,\n  "closed_at" integer,\n  "generation_error" text,\n  "suitability_score" real,\n  "suitability_reason" text,\n  "job_brief" text,\n  "tailored_summary" text,\n  "tailored_headline" text,\n  "tailored_skills" text,\n  "selected_project_ids" text,\n  "pdf_path" text,\n  "pdf_source" text,\n  "pdf_regenerating" integer NOT NULL DEFAULT 0,\n  "pdf_fingerprint" text,\n  "pdf_generated_at" text,\n  "discovered_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "processed_at" text,\n  "ready_at" text,\n  "applied_at" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_tenant_user_job_url_unique" ON "jobs" ("tenant_id", coalesce("user_id", \'\'), "job_url");',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_tenant_user_posting_id_unique" ON "jobs" ("tenant_id", coalesce("user_id", \'\'), "posting_id");',
      'CREATE INDEX IF NOT EXISTS "idx_jobs_tenant_user_status" ON "jobs" ("tenant_id", "user_id", "status");',
      'CREATE INDEX IF NOT EXISTS "idx_jobs_tenant_discovered_at" ON "jobs" ("tenant_id", "discovered_at");',
      'CREATE TABLE IF NOT EXISTS "pipeline_runs" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "started_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "completed_at" text,\n  "status" text NOT NULL DEFAULT \'running\',\n  "jobs_discovered" integer NOT NULL DEFAULT 0,\n  "jobs_processed" integer NOT NULL DEFAULT 0,\n  "tasks_total" integer NOT NULL DEFAULT 0,\n  "tasks_done" integer NOT NULL DEFAULT 0,\n  "tasks_failed" integer NOT NULL DEFAULT 0,\n  "tasks_cached" integer NOT NULL DEFAULT 0,\n  "error_message" text,\n  "config_snapshot" text,\n  "requested_config" text,\n  "effective_config" text,\n  "result_summary" text,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE TABLE IF NOT EXISTS "pipeline_search_presets" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text NOT NULL,\n  "name" text NOT NULL,\n  "config" text NOT NULL,\n  "last_used_at" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_pipeline_search_presets_tenant_user_name_unique" ON "pipeline_search_presets" ("tenant_id", "user_id", "name");',
      'CREATE INDEX IF NOT EXISTS "idx_pipeline_search_presets_tenant_user_updated" ON "pipeline_search_presets" ("tenant_id", "user_id", "updated_at");',
      'CREATE TABLE IF NOT EXISTS "post_application_integrations" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "provider" text NOT NULL,\n  "account_key" text NOT NULL DEFAULT \'default\',\n  "display_name" text,\n  "status" text NOT NULL DEFAULT \'disconnected\',\n  "credentials" text,\n  "last_connected_at" integer,\n  "last_synced_at" integer,\n  "last_error" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_app_integrations_tenant_user_provider_account_unique" ON "post_application_integrations" ("tenant_id", coalesce("user_id", \'\'), "provider", "account_key");',
      'CREATE TABLE IF NOT EXISTS "post_application_messages" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "provider" text NOT NULL,\n  "account_key" text NOT NULL DEFAULT \'default\',\n  "integration_id" text,\n  "sync_run_id" text,\n  "external_message_id" text NOT NULL,\n  "external_thread_id" text,\n  "from_address" text NOT NULL DEFAULT \'\',\n  "from_domain" text,\n  "sender_name" text,\n  "subject" text NOT NULL DEFAULT \'\',\n  "received_at" integer NOT NULL,\n  "snippet" text NOT NULL DEFAULT \'\',\n  "classification_label" text,\n  "classification_confidence" real,\n  "classification_payload" text,\n  "relevance_llm_score" real,\n  "relevance_decision" text NOT NULL DEFAULT \'needs_llm\',\n  "match_confidence" integer,\n  "message_type" text NOT NULL DEFAULT \'other\',\n  "stage_event_payload" text,\n  "processing_status" text NOT NULL DEFAULT \'pending_user\',\n  "matched_job_id" text,\n  "decided_at" integer,\n  "decided_by" text,\n  "error_code" text,\n  "error_message" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("integration_id") REFERENCES "post_application_integrations"("id") ON DELETE SET NULL,\n  FOREIGN KEY ("sync_run_id") REFERENCES "post_application_sync_runs"("id") ON DELETE SET NULL,\n  FOREIGN KEY ("matched_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_app_messages_tenant_user_provider_account_external_unique" ON "post_application_messages" ("tenant_id", coalesce("user_id", \'\'), "provider", "account_key", "external_message_id");',
      'CREATE INDEX IF NOT EXISTS "idx_post_app_messages_provider_account_processing_status" ON "post_application_messages" ("provider", "account_key", "processing_status");',
      'CREATE TABLE IF NOT EXISTS "post_application_sync_runs" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "provider" text NOT NULL,\n  "account_key" text NOT NULL DEFAULT \'default\',\n  "integration_id" text,\n  "status" text NOT NULL DEFAULT \'running\',\n  "started_at" integer NOT NULL,\n  "completed_at" integer,\n  "messages_discovered" integer NOT NULL DEFAULT 0,\n  "messages_relevant" integer NOT NULL DEFAULT 0,\n  "messages_classified" integer NOT NULL DEFAULT 0,\n  "messages_matched" integer NOT NULL DEFAULT 0,\n  "messages_approved" integer NOT NULL DEFAULT 0,\n  "messages_denied" integer NOT NULL DEFAULT 0,\n  "messages_errored" integer NOT NULL DEFAULT 0,\n  "error_code" text,\n  "error_message" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("integration_id") REFERENCES "post_application_integrations"("id") ON DELETE SET NULL\n);',
      'CREATE INDEX IF NOT EXISTS "idx_post_app_sync_runs_provider_account_started_at" ON "post_application_sync_runs" ("provider", "account_key", "started_at");',
      'CREATE TABLE IF NOT EXISTS "postings" (\n  "id" text PRIMARY KEY NOT NULL,\n  "url_norm" text NOT NULL,\n  "source" text NOT NULL,\n  "company" text NOT NULL,\n  "title" text NOT NULL,\n  "location" text,\n  "description" text,\n  "posted_at" text,\n  "first_seen_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "last_seen_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "extracted" text\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_postings_url_norm_unique" ON "postings" ("url_norm");',
      'CREATE INDEX IF NOT EXISTS "idx_postings_last_seen_at" ON "postings" ("last_seen_at");',
      'CREATE TABLE IF NOT EXISTS "scrape_tasks" (\n  "id" text PRIMARY KEY NOT NULL,\n  "scrape_key" text NOT NULL,\n  "window_start" text NOT NULL,\n  "source" text NOT NULL,\n  "runtime" text NOT NULL DEFAULT \'container\',\n  "target" text NOT NULL DEFAULT \'\',\n  "title_norm" text NOT NULL,\n  "location" text NOT NULL DEFAULT \'\',\n  "status" text NOT NULL DEFAULT \'pending\',\n  "attempts" integer NOT NULL DEFAULT 0,\n  "lease_until" text,\n  "completed_at" text,\n  "result_key" text,\n  "postings_found" integer NOT NULL DEFAULT 0,\n  "posting_ids" text,\n  "error" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_scrape_tasks_key_window_unique" ON "scrape_tasks" ("scrape_key", "window_start");',
      'CREATE INDEX IF NOT EXISTS "idx_scrape_tasks_status_lease" ON "scrape_tasks" ("status", "lease_until");',
      'CREATE INDEX IF NOT EXISTS "idx_scrape_tasks_source_status" ON "scrape_tasks" ("source", "status");',
      'CREATE TABLE IF NOT EXISTS "settings" (\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "key" text NOT NULL,\n  "value" text NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_settings_tenant_user_key_unique" ON "settings" ("tenant_id", coalesce("user_id", \'\'), "key");',
      'CREATE TABLE IF NOT EXISTS "site_recipes" (\n  "id" text PRIMARY KEY NOT NULL,\n  "host" text NOT NULL UNIQUE,\n  "tier" integer NOT NULL,\n  "recipe" text,\n  "version" integer NOT NULL DEFAULT 1,\n  "learned_at" text NOT NULL,\n  "last_success_at" text,\n  "consecutive_failures" integer NOT NULL DEFAULT 0,\n  "blocked_reason" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE TABLE IF NOT EXISTS "source_state" (\n  "source" text PRIMARY KEY NOT NULL,\n  "in_flight" integer NOT NULL DEFAULT 0,\n  "last_dispatch_at" text,\n  "requests_today" integer NOT NULL DEFAULT 0,\n  "day" text,\n  "cooldown_until" text,\n  "cooldown_level" integer NOT NULL DEFAULT 0\n);',
      'CREATE TABLE IF NOT EXISTS "sso_identities" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text NOT NULL,\n  "provider" text NOT NULL,\n  "issuer" text NOT NULL,\n  "subject" text NOT NULL,\n  "email" text,\n  "display_name" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  UNIQUE ("provider", "issuer", "subject"),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_sso_identities_user_id" ON "sso_identities" ("user_id");',
      'CREATE TABLE IF NOT EXISTS "stage_events" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "application_id" text NOT NULL,\n  "title" text NOT NULL,\n  "group_id" text,\n  "from_stage" text,\n  "to_stage" text NOT NULL,\n  "occurred_at" integer NOT NULL,\n  "metadata" text,\n  "outcome" text,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("application_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE TABLE IF NOT EXISTS "task_subscribers" (\n  "task_id" text NOT NULL,\n  "tenant_id" text NOT NULL,\n  "run_id" text NOT NULL,\n  "notified_at" text,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  PRIMARY KEY ("task_id", "tenant_id", "run_id"),\n  FOREIGN KEY ("task_id") REFERENCES "scrape_tasks"("id") ON DELETE CASCADE\n);',
      'CREATE INDEX IF NOT EXISTS "idx_task_subscribers_run_id" ON "task_subscribers" ("run_id");',
      'CREATE TABLE IF NOT EXISTS "tasks" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text,\n  "application_id" text NOT NULL,\n  "type" text NOT NULL,\n  "title" text NOT NULL,\n  "due_date" integer,\n  "is_completed" integer NOT NULL DEFAULT 0,\n  "notes" text,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("application_id") REFERENCES "jobs"("id") ON DELETE CASCADE\n);',
      'CREATE TABLE IF NOT EXISTS "tenant_memberships" (\n  "id" text PRIMARY KEY NOT NULL,\n  "user_id" text NOT NULL,\n  "tenant_id" text NOT NULL,\n  "role" text NOT NULL DEFAULT \'owner\',\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_memberships_user_tenant" ON "tenant_memberships" ("user_id", "tenant_id");',
      'CREATE INDEX IF NOT EXISTS "idx_tenant_memberships_tenant_id" ON "tenant_memberships" ("tenant_id");',
      'CREATE TABLE IF NOT EXISTS "tenants" (\n  "id" text PRIMARY KEY NOT NULL,\n  "name" text NOT NULL,\n  "slug" text NOT NULL UNIQUE,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE TABLE IF NOT EXISTS "users" (\n  "id" text PRIMARY KEY NOT NULL,\n  "username" text NOT NULL,\n  "display_name" text,\n  "password_hash" text,\n  "password_salt" text,\n  "is_system_admin" integer NOT NULL DEFAULT 0,\n  "is_disabled" integer NOT NULL DEFAULT 0,\n  "must_change_password" integer NOT NULL DEFAULT 0,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\'))\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username_unique" ON "users" ("username");',
      'CREATE TABLE IF NOT EXISTS "watchlist_checks" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text NOT NULL,\n  "last_checked_at" text NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_checks_tenant_user_unique" ON "watchlist_checks" ("tenant_id", "user_id");',
      'CREATE TABLE IF NOT EXISTS "watchlist_job_states" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text NOT NULL,\n  "source" text NOT NULL,\n  "source_job_id" text NOT NULL,\n  "state" text NOT NULL DEFAULT \'ignored\',\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_job_states_tenant_user_source_job_unique" ON "watchlist_job_states" ("tenant_id", "user_id", "source", "source_job_id");',
      'CREATE INDEX IF NOT EXISTS "idx_watchlist_job_states_tenant_user_state" ON "watchlist_job_states" ("tenant_id", "user_id", "state");',
      'CREATE TABLE IF NOT EXISTS "watchlist_seen_jobs" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text NOT NULL,\n  "source" text NOT NULL,\n  "source_job_id" text NOT NULL,\n  "first_seen_at" text NOT NULL,\n  "last_seen_at" text NOT NULL,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_seen_jobs_tenant_user_source_job_unique" ON "watchlist_seen_jobs" ("tenant_id", "user_id", "source", "source_job_id");',
      'CREATE INDEX IF NOT EXISTS "idx_watchlist_seen_jobs_tenant_user_last_seen" ON "watchlist_seen_jobs" ("tenant_id", "user_id", "last_seen_at");',
      'CREATE TABLE IF NOT EXISTS "watchlist_selected_sources" (\n  "id" text PRIMARY KEY NOT NULL,\n  "tenant_id" text NOT NULL DEFAULT \'tenant_default\',\n  "user_id" text NOT NULL,\n  "catalog_source_id" text,\n  "label" text NOT NULL,\n  "careers_url" text NOT NULL,\n  "cxs_jobs_url" text,\n  "source_type" text NOT NULL,\n  "is_custom" integer NOT NULL DEFAULT 0,\n  "sort_order" integer NOT NULL DEFAULT 0,\n  "created_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  "updated_at" text NOT NULL DEFAULT (datetime(\'now\')),\n  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE\n);',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_selected_sources_tenant_user_sort_order" ON "watchlist_selected_sources" ("tenant_id", "user_id", "sort_order");',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_watchlist_selected_sources_tenant_user_careers_url" ON "watchlist_selected_sources" ("tenant_id", "user_id", "careers_url");',
      'CREATE INDEX IF NOT EXISTS "idx_watchlist_selected_sources_tenant_user" ON "watchlist_selected_sources" ("tenant_id", "user_id");',
    ],
  },
  {
    id: "0002",
    name: "0002_default_tenant",
    statements: [
      'INSERT OR IGNORE INTO "tenants" ("id", "name", "slug") VALUES (\'tenant_default\', \'JobOps\', \'default\');',
    ],
  },
];

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "_portable_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" text NOT NULL DEFAULT (datetime('now'))
);`;

/**
 * Runs ordered portable SQL migrations against better-sqlite3 or Cloudflare DO SqlStorage.
 * Tracks applied migrations in `_portable_migrations` and is idempotent across repeated runs.
 */
export function runPortableMigrations(
  target: PortableMigrationTarget,
  migrations: readonly PortableMigration[] = PORTABLE_MIGRATIONS,
): PortableMigrationResult {
  const executor = toPortableSqlExecutor(target);
  executor.exec(MIGRATIONS_TABLE_SQL);

  const existingRows = executor.query<{ id: string; checksum: string }>(
    'SELECT "id", "checksum" FROM "_portable_migrations"',
  );
  const appliedMap = new Map(existingRows.map((row) => [row.id, row.checksum]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const checksum = computeMigrationChecksum(migration.statements);
    const existingChecksum = appliedMap.get(migration.id);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${migration.id} (${migration.name})`);
      }
      skipped.push(migration.id);
      continue;
    }

    for (const statement of migration.statements) {
      executor.exec(statement);
    }

    executor.run('INSERT INTO "_portable_migrations" ("id", "name", "checksum") VALUES (?, ?, ?)', [
      migration.id,
      migration.name,
      checksum,
    ]);
    appliedMap.set(migration.id, checksum);
    applied.push(migration.id);
  }

  return {
    applied,
    skipped,
    total: migrations.length,
  };
}
