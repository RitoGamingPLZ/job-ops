/**
 * Database schema using Drizzle ORM with SQLite.
 */

import {
  APPLICATION_OUTCOMES,
  APPLICATION_STAGES,
  type CandidateItemKind,
  type ExperienceBulletSource,
  HOSTED_USAGE_ACTIONS,
  JOB_CHAT_MESSAGE_ROLES,
  JOB_CHAT_MESSAGE_STATUSES,
  JOB_CHAT_RUN_STATUSES,
  POST_APPLICATION_INTEGRATION_STATUSES,
  POST_APPLICATION_MESSAGE_TYPES,
  POST_APPLICATION_PROCESSING_STATUSES,
  POST_APPLICATION_PROVIDERS,
  POST_APPLICATION_RELEVANCE_DECISIONS,
  POST_APPLICATION_SYNC_RUN_STATUSES,
  type ResumeV5Document,
  type ResumeSuggestionV2,
  SSO_PROVIDERS,
} from "@shared/types";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    isSystemAdmin: integer("is_system_admin", { mode: "boolean" }).notNull().default(false),
    isDisabled: integer("is_disabled", { mode: "boolean" }).notNull().default(false),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(false),
    // JSON object of per-user permission overrides; absent keys fall back to the defaults.
    permissions: text("permissions"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    usernameUnique: uniqueIndex("idx_users_username_unique").on(table.username),
  }),
);

// Explicitly global: invitations exist before the invited user has a workspace, and are
// only ever read or written by system admins or by presenting the secret token.
// The SHA-256 of the token is the lookup key. The raw token is also kept while the invitation is
// pending so an admin can copy the link again, and is cleared once the invitation is used.
export const userInvitations = sqliteTable("user_invitations", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  token: text("token"),
  label: text("label").notNull(),
  permissions: text("permissions").notNull().default("{}"),
  expiresAt: text("expires_at").notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  usedAt: text("used_at"),
  usedByUserId: text("used_by_user_id"),
  revokedAt: text("revoked_at"),
});

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const tenantMemberships = sqliteTable(
  "tenant_memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("owner"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    userTenantUnique: uniqueIndex("idx_tenant_memberships_user_tenant").on(
      table.userId,
      table.tenantId,
    ),
    tenantIndex: index("idx_tenant_memberships_tenant_id").on(table.tenantId),
  }),
);

export const accountSubscriptions = sqliteTable(
  "account_subscriptions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSubscriptionCreatedAt: integer("stripe_subscription_created_at", {
      mode: "number",
    }),
    stripePriceId: text("stripe_price_id"),
    stripeStatus: text("stripe_status"),
    currentPeriodEnd: integer("current_period_end", { mode: "number" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex("idx_account_subscriptions_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
    customerUnique: uniqueIndex("idx_account_subscriptions_customer_unique").on(
      table.stripeCustomerId,
    ),
    subscriptionUnique: uniqueIndex("idx_account_subscriptions_subscription_unique").on(
      table.stripeSubscriptionId,
    ),
  }),
);

const HOSTED_USAGE_RESERVATION_STATUSES = ["reserved", "settled", "refunded"] as const;

export const hostedUsageCounters = sqliteTable(
  "hosted_usage_counters",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    action: text("action", { enum: HOSTED_USAGE_ACTIONS }).notNull(),
    usedUnits: integer("used_units").notNull().default(0),
    reservedUnits: integer("reserved_units").notNull().default(0),
    limitUnits: integer("limit_units").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserPeriodActionUnique: uniqueIndex(
      "idx_hosted_usage_counters_tenant_user_period_action_unique",
    ).on(table.tenantId, table.userId, table.period, table.action),
    tenantUserPeriodIndex: index("idx_hosted_usage_counters_tenant_user_period").on(
      table.tenantId,
      table.userId,
      table.period,
    ),
  }),
);

export const hostedUsageReservations = sqliteTable(
  "hosted_usage_reservations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    action: text("action", { enum: HOSTED_USAGE_ACTIONS }).notNull(),
    reservedUnits: integer("reserved_units").notNull(),
    usedUnits: integer("used_units").notNull().default(0),
    refundedUnits: integer("refunded_units").notNull().default(0),
    status: text("status", {
      enum: HOSTED_USAGE_RESERVATION_STATUSES,
    })
      .notNull()
      .default("reserved"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserPeriodIndex: index("idx_hosted_usage_reservations_tenant_user_period").on(
      table.tenantId,
      table.userId,
      table.period,
    ),
    tenantUserPeriodActionIdempotencyUnique: uniqueIndex(
      "idx_hosted_usage_reservations_idempotency_unique",
    ).on(table.tenantId, table.userId, table.period, table.action, table.idempotencyKey),
  }),
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),

    // From crawler
    source: text("source").notNull().default("manual"),
    sourceJobId: text("source_job_id"),
    postingId: text("posting_id"),
    jobUrlDirect: text("job_url_direct"),
    datePosted: text("date_posted"),
    title: text("title").notNull(),
    employer: text("employer").notNull(),
    employerUrl: text("employer_url"),
    jobUrl: text("job_url").notNull(),
    applicationLink: text("application_link"),
    disciplines: text("disciplines"),
    deadline: text("deadline"),
    salary: text("salary"),
    location: text("location"),
    locationEvidence: text("location_evidence"),
    degreeRequired: text("degree_required"),
    starting: text("starting"),
    jobDescription: text("job_description"),

    // JobSpy fields (nullable for other sources)
    jobType: text("job_type"),
    salarySource: text("salary_source"),
    salaryInterval: text("salary_interval"),
    salaryMinAmount: real("salary_min_amount"),
    salaryMaxAmount: real("salary_max_amount"),
    salaryCurrency: text("salary_currency"),
    isRemote: integer("is_remote", { mode: "boolean" }),
    jobLevel: text("job_level"),
    jobFunction: text("job_function"),
    listingType: text("listing_type"),
    emails: text("emails"),
    companyIndustry: text("company_industry"),
    companyLogo: text("company_logo"),
    companyUrlDirect: text("company_url_direct"),
    companyAddresses: text("company_addresses"),
    companyNumEmployees: text("company_num_employees"),
    companyRevenue: text("company_revenue"),
    companyDescription: text("company_description"),
    skills: text("skills"),
    experienceRange: text("experience_range"),
    companyRating: real("company_rating"),
    companyReviewsCount: integer("company_reviews_count"),
    vacancyCount: integer("vacancy_count"),
    workFromHomeType: text("work_from_home_type"),

    // Orchestrator enrichments
    status: text("status", {
      enum: ["discovered", "processing", "ready", "applied", "in_progress", "skipped", "expired"],
    })
      .notNull()
      .default("discovered"),
    outcome: text("outcome", { enum: APPLICATION_OUTCOMES }),
    closedAt: integer("closed_at", { mode: "number" }),
    generationError: text("generation_error"),
    suitabilityScore: real("suitability_score"),
    suitabilityReason: text("suitability_reason"),
    jobBrief: text("job_brief"),
    tailoredSummary: text("tailored_summary"),
    tailoredHeadline: text("tailored_headline"),
    tailoredSkills: text("tailored_skills"),
    selectedProjectIds: text("selected_project_ids"),
    pdfPath: text("pdf_path"),
    pdfSource: text("pdf_source", { enum: ["generated", "uploaded"] }),
    pdfRegenerating: integer("pdf_regenerating", { mode: "boolean" }).notNull().default(false),
    pdfFingerprint: text("pdf_fingerprint"),
    pdfGeneratedAt: text("pdf_generated_at"),

    // Timestamps
    discoveredAt: text("discovered_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    processedAt: text("processed_at"),
    readyAt: text("ready_at"), // Also records when the job was targeted.
    appliedAt: text("applied_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserJobUrlUnique: uniqueIndex("idx_jobs_tenant_user_job_url_unique").on(
      table.tenantId,
      sql`coalesce(${table.userId}, '')`,
      table.jobUrl,
    ),
    tenantUserPostingIdUnique: uniqueIndex("idx_jobs_tenant_user_posting_id_unique").on(
      table.tenantId,
      sql`coalesce(${table.userId}, '')`,
      table.postingId,
    ),
    tenantStatusIndex: index("idx_jobs_tenant_user_status").on(
      table.tenantId,
      table.userId,
      table.status,
    ),
    tenantDiscoveredAtIndex: index("idx_jobs_tenant_discovered_at").on(
      table.tenantId,
      table.discoveredAt,
    ),
  }),
);

export const stageEvents = sqliteTable("stage_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .default("tenant_default")
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  applicationId: text("application_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  groupId: text("group_id"),
  fromStage: text("from_stage", { enum: APPLICATION_STAGES }),
  toStage: text("to_stage", { enum: APPLICATION_STAGES }).notNull(),
  occurredAt: integer("occurred_at", { mode: "number" }).notNull(),
  metadata: text("metadata", { mode: "json" }),
  outcome: text("outcome", { enum: APPLICATION_OUTCOMES }),
});

export const jobNotes = sqliteTable(
  "job_notes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    jobUpdatedIndex: index("idx_job_notes_job_updated").on(table.jobId, table.updatedAt),
  }),
);

export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .default("tenant_default")
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
  status: text("status", {
    enum: ["running", "completed", "partial", "failed", "cancelled"],
  })
    .notNull()
    .default("running"),
  jobsDiscovered: integer("jobs_discovered").notNull().default(0),
  jobsProcessed: integer("jobs_processed").notNull().default(0),
  tasksTotal: integer("tasks_total").notNull().default(0),
  tasksDone: integer("tasks_done").notNull().default(0),
  tasksFailed: integer("tasks_failed").notNull().default(0),
  tasksCached: integer("tasks_cached").notNull().default(0),
  errorMessage: text("error_message"),
  configSnapshot: text("config_snapshot"),
  requestedConfig: text("requested_config", { mode: "json" }),
  effectiveConfig: text("effective_config", { mode: "json" }),
  resultSummary: text("result_summary", { mode: "json" }),
});

export const pipelineSearchPresets = sqliteTable(
  "pipeline_search_presets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    config: text("config", { mode: "json" }).notNull(),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserNameUnique: uniqueIndex("idx_pipeline_search_presets_tenant_user_name_unique").on(
      table.tenantId,
      table.userId,
      table.name,
    ),
    tenantUserUpdatedIndex: index("idx_pipeline_search_presets_tenant_user_updated").on(
      table.tenantId,
      table.userId,
      table.updatedAt,
    ),
  }),
);

export const jobChatThreads = sqliteTable(
  "job_chat_threads",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastMessageAt: text("last_message_at"),
    activeRootMessageId: text("active_root_message_id"),
    selectedNoteIds: text("selected_note_ids").notNull().default("[]"),
    selectedEmailIds: text("selected_email_ids").notNull().default("[]"),
    selectedDocumentIds: text("selected_document_ids").notNull().default("[]"),
  },
  (table) => ({
    jobUpdatedIndex: index("idx_job_chat_threads_job_updated").on(table.jobId, table.updatedAt),
  }),
);

export const jobChatMessages = sqliteTable(
  "job_chat_messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id")
      .notNull()
      .references(() => jobChatThreads.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    role: text("role", { enum: JOB_CHAT_MESSAGE_ROLES }).notNull(),
    content: text("content").notNull().default(""),
    status: text("status", { enum: JOB_CHAT_MESSAGE_STATUSES }).notNull().default("partial"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    version: integer("version").notNull().default(1),
    replacesMessageId: text("replaces_message_id"),
    parentMessageId: text("parent_message_id"),
    activeChildId: text("active_child_id"),
    attachments: text("attachments").notNull().default("[]"),
    suggestions: text("suggestions", { mode: "json" }).$type<ResumeSuggestionV2[]>(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    threadCreatedIndex: index("idx_job_chat_messages_thread_created").on(
      table.threadId,
      table.createdAt,
    ),
  }),
);

export const jobChatRuns = sqliteTable(
  "job_chat_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id")
      .notNull()
      .references(() => jobChatThreads.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    status: text("status", { enum: JOB_CHAT_RUN_STATUSES }).notNull().default("running"),
    model: text("model"),
    provider: text("provider"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    completedAt: integer("completed_at", { mode: "number" }),
    requestId: text("request_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    threadStatusIndex: index("idx_job_chat_runs_thread_status").on(table.threadId, table.status),
  }),
);

export const settings = sqliteTable(
  "settings",
  {
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserKeyUnique: uniqueIndex("idx_settings_tenant_user_key_unique").on(
      table.tenantId,
      sql`coalesce(${table.userId}, '')`,
      table.key,
    ),
  }),
);

// Explicitly global: recipes contain only public site extraction instructions.
// Explicitly global: editorial company ratings are public reference data shared across tenants.
// Ratings use a 0-10 scale. `companyKey` is the label lowercased with non-alphanumerics removed,
// so one row covers the same company on every source adapter.
export const companyRatings = sqliteTable("company_ratings", {
  id: text("id").primaryKey(),
  companyKey: text("company_key").notNull().unique(),
  label: text("label").notNull(),
  wlbRating: real("wlb_rating"),
  salaryRating: real("salary_rating"),
  source: text("source").notNull().default("editorial"),
  sourceUrl: text("source_url"),
  ratedAt: text("rated_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const siteRecipes = sqliteTable("site_recipes", {
  id: text("id").primaryKey(),
  host: text("host").notNull().unique(),
  tier: integer("tier").notNull(),
  recipe: text("recipe"),
  version: integer("version").notNull().default(1),
  learnedAt: text("learned_at").notNull(),
  lastSuccessAt: text("last_success_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  blockedReason: text("blocked_reason"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const watchlistJobStates = sqliteTable(
  "watchlist_job_states",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    state: text("state", { enum: ["ignored", "moved_to_workspace"] })
      .notNull()
      .default("ignored"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserSourceJobUnique: uniqueIndex(
      "idx_watchlist_job_states_tenant_user_source_job_unique",
    ).on(table.tenantId, table.userId, table.source, table.sourceJobId),
    tenantUserStateIndex: index("idx_watchlist_job_states_tenant_user_state").on(
      table.tenantId,
      table.userId,
      table.state,
    ),
  }),
);

export const watchlistChecks = sqliteTable(
  "watchlist_checks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    lastCheckedAt: text("last_checked_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex("idx_watchlist_checks_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
  }),
);

export const watchlistSeenJobs = sqliteTable(
  "watchlist_seen_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserSourceJobUnique: uniqueIndex(
      "idx_watchlist_seen_jobs_tenant_user_source_job_unique",
    ).on(table.tenantId, table.userId, table.source, table.sourceJobId),
    tenantUserLastSeenIndex: index("idx_watchlist_seen_jobs_tenant_user_last_seen").on(
      table.tenantId,
      table.userId,
      table.lastSeenAt,
    ),
  }),
);

// Last fetch outcome (jobs or error) per watched source, so opening the Watchlist page reads this
// instead of re-checking every source. Refreshed only by an explicit refresh or a pipeline run.
export const watchlistSourceResults = sqliteTable(
  "watchlist_source_results",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    sourceKey: text("source_key").notNull(),
    status: text("status", { enum: ["success", "error"] }).notNull(),
    resultJson: text("result_json").notNull(),
    checkedAt: text("checked_at").notNull(),
    previousCheckedAt: text("previous_checked_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserSourceUnique: uniqueIndex(
      "idx_watchlist_source_results_tenant_user_source_unique",
    ).on(table.tenantId, table.userId, table.sourceKey),
  }),
);

export const watchlistSelectedSources = sqliteTable(
  "watchlist_selected_sources",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    catalogSourceId: text("catalog_source_id"),
    label: text("label").notNull(),
    careersUrl: text("careers_url").notNull(),
    cxsJobsUrl: text("cxs_jobs_url"),
    description: text("description").notNull().default(""),
    sourceType: text("source_type").notNull(),
    isCustom: integer("is_custom", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserSortOrderUnique: uniqueIndex(
      "idx_watchlist_selected_sources_tenant_user_sort_order",
    ).on(table.tenantId, table.userId, table.sortOrder),
    tenantUserCareersUrlUnique: uniqueIndex(
      "idx_watchlist_selected_sources_tenant_user_careers_url",
    ).on(table.tenantId, table.userId, table.careersUrl),
    tenantUserIndex: index("idx_watchlist_selected_sources_tenant_user").on(
      table.tenantId,
      table.userId,
    ),
  }),
);

// Explicitly global: public career-board metadata and default filter plans shared across tenants.
// Stores no tenant settings, credentials, user ids, or PII.
export const watchlistSharedSources = sqliteTable(
  "watchlist_shared_sources",
  {
    id: text("id").primaryKey(),
    urlKey: text("url_key").notNull().unique(),
    sourceType: text("source_type").notNull(),
    name: text("name").notNull(),
    careersUrl: text("careers_url").notNull(),
    description: text("description").notNull().default(""),
    discoveredFacetsJson: text("discovered_facets_json"),
    facetsScannedAt: text("facets_scanned_at"),
    defaultFilterPlanJson: text("default_filter_plan_json"),
    filterPlanUpdatedAt: text("filter_plan_updated_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    sourceTypeIndex: index("idx_watchlist_shared_sources_source_type").on(table.sourceType),
  }),
);

// Explicitly global cache of verified public URL filter plans keyed by URL + one-way SHA-256 intent hash.
// Contains no raw tenant intent text, tenant ids, or user ids.
export const watchlistFilterPlans = sqliteTable(
  "watchlist_filter_plans",
  {
    id: text("id").primaryKey(),
    urlKey: text("url_key").notNull(),
    sourceType: text("source_type").notNull(),
    intentHash: text("intent_hash").notNull(),
    planJson: text("plan_json").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    urlIntentUnique: uniqueIndex("idx_watchlist_filter_plans_url_intent_unique").on(
      table.urlKey,
      table.intentHash,
    ),
    urlKeyIndex: index("idx_watchlist_filter_plans_url_key").on(table.urlKey),
  }),
);

export const analyticsInstallState = sqliteTable("analytics_install_state", {
  id: text("id").primaryKey(),
  distinctId: text("distinct_id").notNull(),
  installedAt: text("installed_at").notNull(),
  rawEventReplayVersion: integer("raw_event_replay_version").notNull().default(0),
  rawEventReplayCompletedAt: text("raw_event_replay_completed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const analyticsMilestones = sqliteTable(
  "analytics_milestones",
  {
    milestone: text("milestone").primaryKey(),
    firstSeenAt: integer("first_seen_at", { mode: "number" }).notNull(),
    firstSessionId: text("first_session_id"),
    reportedAt: text("reported_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    firstSeenAtIndex: index("idx_analytics_milestones_first_seen_at").on(table.firstSeenAt),
  }),
);

export const analyticsServerEventReplays = sqliteTable(
  "analytics_server_event_replays",
  {
    eventKey: text("event_key").primaryKey(),
    eventName: text("event_name").notNull(),
    occurredAt: integer("occurred_at", { mode: "number" }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    claimedAt: integer("claimed_at", { mode: "number" }),
    reportedAt: integer("reported_at", { mode: "number" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    eventNameIndex: index("idx_analytics_server_event_replays_event_name").on(table.eventName),
    occurredAtIndex: index("idx_analytics_server_event_replays_occurred_at").on(table.occurredAt),
  }),
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    subject: text("subject").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    expiresAtIndex: index("idx_auth_sessions_expires_at").on(table.expiresAt),
    revokedAtIndex: index("idx_auth_sessions_revoked_at").on(table.revokedAt),
  }),
);

export const ssoIdentities = sqliteTable(
  "sso_identities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: SSO_PROVIDERS }).notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    providerIdentityUnique: unique().on(table.provider, table.issuer, table.subject),
    userIndex: index("idx_sso_identities_user_id").on(table.userId),
  }),
);

export const designResumeDocuments = sqliteTable("design_resume_documents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .default("tenant_default")
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  resumeJson: text("resume_json", { mode: "json" }).notNull(),
  revision: integer("revision").notNull().default(1),
  sourceResumeId: text("source_resume_id"),
  sourceMode: text("source_mode"),
  importedAt: text("imported_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const designResumeAssets = sqliteTable(
  "design_resume_assets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    documentId: text("document_id")
      .notNull()
      .references(() => designResumeDocuments.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["picture"] })
      .notNull()
      .default("picture"),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storagePath: text("storage_path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    documentIndex: index("idx_design_resume_assets_document_id").on(table.documentId),
  }),
);

export const jobDocuments = sqliteTable(
  "job_documents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mediaType: text("media_type"),
    byteSize: integer("byte_size").notNull(),
    storagePath: text("storage_path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    jobIndex: index("idx_job_documents_job_id").on(table.jobId),
    tenantJobIndex: index("idx_job_documents_tenant_job_id").on(table.tenantId, table.jobId),
  }),
);

export const postApplicationIntegrations = sqliteTable(
  "post_application_integrations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    provider: text("provider", { enum: POST_APPLICATION_PROVIDERS }).notNull(),
    accountKey: text("account_key").notNull().default("default"),
    displayName: text("display_name"),
    status: text("status", { enum: POST_APPLICATION_INTEGRATION_STATUSES })
      .notNull()
      .default("disconnected"),
    credentials: text("credentials", { mode: "json" }),
    lastConnectedAt: integer("last_connected_at", { mode: "number" }),
    lastSyncedAt: integer("last_synced_at", { mode: "number" }),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex(
      "idx_post_app_integrations_tenant_user_provider_account_unique",
    ).on(table.tenantId, sql`coalesce(${table.userId}, '')`, table.provider, table.accountKey),
  }),
);

export const postApplicationSyncRuns = sqliteTable(
  "post_application_sync_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    provider: text("provider", { enum: POST_APPLICATION_PROVIDERS }).notNull(),
    accountKey: text("account_key").notNull().default("default"),
    integrationId: text("integration_id").references(() => postApplicationIntegrations.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: POST_APPLICATION_SYNC_RUN_STATUSES })
      .notNull()
      .default("running"),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    completedAt: integer("completed_at", { mode: "number" }),
    messagesDiscovered: integer("messages_discovered").notNull().default(0),
    messagesRelevant: integer("messages_relevant").notNull().default(0),
    messagesClassified: integer("messages_classified").notNull().default(0),
    messagesMatched: integer("messages_matched").notNull().default(0),
    messagesApproved: integer("messages_approved").notNull().default(0),
    messagesDenied: integer("messages_denied").notNull().default(0),
    messagesErrored: integer("messages_errored").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    providerAccountStartedAtIndex: index("idx_post_app_sync_runs_provider_account_started_at").on(
      table.provider,
      table.accountKey,
      table.startedAt,
    ),
  }),
);

export const postApplicationMessages = sqliteTable(
  "post_application_messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    provider: text("provider", { enum: POST_APPLICATION_PROVIDERS }).notNull(),
    accountKey: text("account_key").notNull().default("default"),
    integrationId: text("integration_id").references(() => postApplicationIntegrations.id, {
      onDelete: "set null",
    }),
    syncRunId: text("sync_run_id").references(() => postApplicationSyncRuns.id, {
      onDelete: "set null",
    }),
    externalMessageId: text("external_message_id").notNull(),
    externalThreadId: text("external_thread_id"),
    fromAddress: text("from_address").notNull().default(""),
    fromDomain: text("from_domain"),
    senderName: text("sender_name"),
    subject: text("subject").notNull().default(""),
    receivedAt: integer("received_at", { mode: "number" }).notNull(),
    snippet: text("snippet").notNull().default(""),
    classificationLabel: text("classification_label"),
    classificationConfidence: real("classification_confidence"),
    classificationPayload: text("classification_payload", { mode: "json" }),
    relevanceLlmScore: real("relevance_llm_score"),
    relevanceDecision: text("relevance_decision", {
      enum: POST_APPLICATION_RELEVANCE_DECISIONS,
    })
      .notNull()
      .default("needs_llm"),
    matchConfidence: integer("match_confidence"),
    messageType: text("message_type", {
      enum: POST_APPLICATION_MESSAGE_TYPES,
    })
      .notNull()
      .default("other"),
    stageEventPayload: text("stage_event_payload", { mode: "json" }),
    processingStatus: text("processing_status", {
      enum: POST_APPLICATION_PROCESSING_STATUSES,
    })
      .notNull()
      .default("pending_user"),
    matchedJobId: text("matched_job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    decidedAt: integer("decided_at", { mode: "number" }),
    decidedBy: text("decided_by"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    providerAccountExternalMessageUnique: uniqueIndex(
      "idx_post_app_messages_tenant_user_provider_account_external_unique",
    ).on(
      table.tenantId,
      sql`coalesce(${table.userId}, '')`,
      table.provider,
      table.accountKey,
      table.externalMessageId,
    ),
    providerAccountReviewStatusIndex: index(
      "idx_post_app_messages_provider_account_processing_status",
    ).on(table.provider, table.accountKey, table.processingStatus),
  }),
);

export const experienceBullets = sqliteTable(
  "experience_bullets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CandidateItemKind>().notNull().default("bullet"),
    data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
    parentId: text("parent_id"),
    position: integer("position").notNull().default(0),
    text: text("text").notNull(),
    company: text("company"),
    role: text("role"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    source: text("source").$type<ExperienceBulletSource>().notNull().default("manual"),
    sourceExperienceId: text("source_experience_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    scopeIndex: index("idx_experience_bullets_scope").on(table.tenantId, table.userId),
  }),
);

export const jobResumes = sqliteTable(
  "job_resumes",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => jobs.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    document: text("document", { mode: "json" }).$type<ResumeV5Document>().notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    scopeIndex: index("idx_job_resumes_scope").on(table.tenantId, table.userId),
  }),
);

export const scrapeTasks = sqliteTable(
  "scrape_tasks",
  {
    id: text("id").primaryKey(),
    scrapeKey: text("scrape_key").notNull(),
    windowStart: text("window_start").notNull(),
    source: text("source").notNull(),
    runtime: text("runtime", { enum: ["worker", "browser", "container"] })
      .notNull()
      .default("container"),
    target: text("target").notNull().default(""),
    titleNorm: text("title_norm").notNull(),
    location: text("location").notNull().default(""),
    status: text("status", {
      enum: ["pending", "running", "done", "failed", "needs_attention"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    leaseUntil: text("lease_until"),
    completedAt: text("completed_at"),
    resultKey: text("result_key"),
    postingsFound: integer("postings_found").notNull().default(0),
    postingIds: text("posting_ids", { mode: "json" }).$type<string[] | null>(),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    keyWindowUnique: uniqueIndex("idx_scrape_tasks_key_window_unique").on(
      table.scrapeKey,
      table.windowStart,
    ),
    statusLeaseIndex: index("idx_scrape_tasks_status_lease").on(table.status, table.leaseUntil),
    sourceStatusIndex: index("idx_scrape_tasks_source_status").on(table.source, table.status),
  }),
);

export const taskSubscribers = sqliteTable(
  "task_subscribers",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => scrapeTasks.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    notifiedAt: text("notified_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.tenantId, table.runId] }),
    runIdIndex: index("idx_task_subscribers_run_id").on(table.runId),
  }),
);

export const postings = sqliteTable(
  "postings",
  {
    id: text("id").primaryKey(),
    urlNorm: text("url_norm").notNull(),
    source: text("source").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    description: text("description"),
    postedAt: text("posted_at"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    extracted: text("extracted", { mode: "json" }).$type<Record<string, unknown> | null>(),
  },
  (table) => ({
    urlNormUnique: uniqueIndex("idx_postings_url_norm_unique").on(table.urlNorm),
    lastSeenAtIndex: index("idx_postings_last_seen_at").on(table.lastSeenAt),
  }),
);

export const sourceState = sqliteTable("source_state", {
  source: text("source").primaryKey(),
  inFlight: integer("in_flight").notNull().default(0),
  lastDispatchAt: text("last_dispatch_at"),
  requestsToday: integer("requests_today").notNull().default(0),
  day: text("day"),
  cooldownUntil: text("cooldown_until"),
  cooldownLevel: integer("cooldown_level").notNull().default(0),
});
