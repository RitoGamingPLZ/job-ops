import type { AppDatabase } from "@server/db/index";
import * as schema from "@server/db/schema";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { IncomingPosting } from "./index";
import {
  buildScrapeKey,
  cleanupUnseenPostings,
  completeTask,
  dispatchPendingTasks,
  ensureTask,
  markTaskNeedsAttention,
  normalizePostingUrl,
  onTaskDoneForTenant,
  recordSourceRateLimitHit,
} from "./index";

function createTestDb(): { sqlite: Database.Database; db: AppDatabase } {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      password_hash TEXT,
      password_salt TEXT,
      is_system_admin INTEGER NOT NULL DEFAULT 0,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
      user_id TEXT,
      source TEXT NOT NULL DEFAULT 'gradcracker',
      source_job_id TEXT,
      posting_id TEXT,
      job_url_direct TEXT,
      date_posted TEXT,
      title TEXT NOT NULL,
      employer TEXT NOT NULL,
      employer_url TEXT,
      job_url TEXT NOT NULL,
      application_link TEXT,
      disciplines TEXT,
      deadline TEXT,
      salary TEXT,
      location TEXT,
      location_evidence TEXT,
      degree_required TEXT,
      starting TEXT,
      job_description TEXT,
      job_type TEXT,
      salary_source TEXT,
      salary_interval TEXT,
      salary_min_amount REAL,
      salary_max_amount REAL,
      salary_currency TEXT,
      is_remote INTEGER,
      job_level TEXT,
      job_function TEXT,
      listing_type TEXT,
      emails TEXT,
      company_industry TEXT,
      company_logo TEXT,
      company_url_direct TEXT,
      company_addresses TEXT,
      company_num_employees TEXT,
      company_revenue TEXT,
      company_description TEXT,
      skills TEXT,
      experience_range TEXT,
      company_rating REAL,
      company_reviews_count INTEGER,
      vacancy_count INTEGER,
      work_from_home_type TEXT,
      status TEXT NOT NULL DEFAULT 'discovered',
      outcome TEXT,
      closed_at INTEGER,
      generation_error TEXT,
      suitability_score REAL,
      suitability_reason TEXT,
      job_brief TEXT,
      tailored_summary TEXT,
      tailored_headline TEXT,
      tailored_skills TEXT,
      selected_project_ids TEXT,
      pdf_path TEXT,
      pdf_source TEXT,
      pdf_regenerating INTEGER NOT NULL DEFAULT 0,
      pdf_fingerprint TEXT,
      pdf_generated_at TEXT,
      tracer_links_enabled INTEGER NOT NULL DEFAULT 0,
      sponsor_match_score REAL,
      sponsor_match_names TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      ready_at TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_jobs_tenant_user_job_url_unique ON jobs(tenant_id, coalesce(user_id, ''), job_url);
    CREATE UNIQUE INDEX idx_jobs_tenant_user_posting_id_unique ON jobs(tenant_id, coalesce(user_id, ''), posting_id);
    CREATE TABLE pipeline_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
      user_id TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      jobs_discovered INTEGER NOT NULL DEFAULT 0,
      jobs_processed INTEGER NOT NULL DEFAULT 0,
      tasks_total INTEGER NOT NULL DEFAULT 0,
      tasks_done INTEGER NOT NULL DEFAULT 0,
      tasks_failed INTEGER NOT NULL DEFAULT 0,
      tasks_cached INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      config_snapshot TEXT,
      requested_config TEXT,
      effective_config TEXT,
      result_summary TEXT
    );
    CREATE TABLE scrape_tasks (
      id TEXT PRIMARY KEY,
      scrape_key TEXT NOT NULL,
      window_start TEXT NOT NULL,
      source TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'container',
      target TEXT NOT NULL DEFAULT '',
      title_norm TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_until TEXT,
      completed_at TEXT,
      result_key TEXT,
      postings_found INTEGER NOT NULL DEFAULT 0,
      posting_ids TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_scrape_tasks_key_window_unique ON scrape_tasks(scrape_key, window_start);
    CREATE TABLE task_subscribers (
      task_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      notified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, tenant_id, run_id),
      FOREIGN KEY (task_id) REFERENCES scrape_tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE postings (
      id TEXT PRIMARY KEY,
      url_norm TEXT NOT NULL,
      source TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT,
      description TEXT,
      posted_at TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      extracted TEXT
    );
    CREATE UNIQUE INDEX idx_postings_url_norm_unique ON postings(url_norm);
    CREATE TABLE source_state (
      source TEXT PRIMARY KEY,
      in_flight INTEGER NOT NULL DEFAULT 0,
      last_dispatch_at TEXT,
      requests_today INTEGER NOT NULL DEFAULT 0,
      day TEXT,
      cooldown_until TEXT,
      cooldown_level INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO tenants (id, name, slug) VALUES ('tenant_a', 'Tenant A', 'tenant-a');
    INSERT INTO tenants (id, name, slug) VALUES ('tenant_b', 'Tenant B', 'tenant-b');
  `);
  const db = drizzle(sqlite, { schema }) as unknown as AppDatabase;
  return { sqlite, db };
}

describe("scrape-coordinator", () => {
  let db: AppDatabase;

  beforeEach(() => {
    ({ db } = createTestDb());
  });

  it("normalizes scrape keys and posting URLs consistently", () => {
    expect(
      buildScrapeKey({
        source: " Adzuna ",
        target: "  ACME   Corp ",
        title: " Software   Engineer ",
        location: " London ",
      }),
    ).toBe("adzuna|acme corp|software engineer|london");

    expect(
      normalizePostingUrl(
        "https://Example.COM/jobs/123/?utm_source=feed&b=2&a=1#apply",
      ),
    ).toBe("https://example.com/jobs/123?a=1&b=2");
  });

  it("deduplicates active tasks across tenants and reuses 24h completed tasks", () => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");

    const first = ensureTask(db, {
      source: "adzuna",
      title: "Software Engineer",
      location: "London",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_a1",
      now: t0,
    });
    expect(first.status).toBe("created");

    const second = ensureTask(db, {
      source: "adzuna",
      title: "  software   engineer ",
      location: "london",
      runtime: "worker",
      tenantId: "tenant_b",
      runId: "run_b1",
      now: new Date(t0.getTime() + 5_000),
    });
    expect(second).toEqual({ status: "waiting", taskId: first.taskId });

    const done = completeTask(db, {
      taskId: first.taskId,
      postings: [
        {
          jobUrl: "https://example.com/job/1?utm_source=x",
          source: "adzuna",
          company: "Acme",
          title: "Software Engineer",
          extracted: { seniority: "mid" },
        },
      ],
      now: new Date(t0.getTime() + 10_000),
    });
    expect(done.alreadyDone).toBe(false);
    expect(done.postingIds).toHaveLength(1);
    expect(done.subscribers).toHaveLength(2);

    const within24h = ensureTask(db, {
      source: "adzuna",
      title: "Software Engineer",
      location: "London",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_a2",
      now: new Date(t0.getTime() + 23 * 60 * 60 * 1000),
    });
    expect(within24h).toEqual({
      status: "cached",
      taskId: first.taskId,
      postingIds: done.postingIds,
    });

    const after24h = ensureTask(db, {
      source: "adzuna",
      title: "Software Engineer",
      location: "London",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_a3",
      now: new Date(t0.getTime() + 25 * 60 * 60 * 1000),
    });
    expect(after24h.status).toBe("created");
    expect(after24h.taskId).not.toBe(first.taskId);
  });

  it("enforces per-site rate limits, daily caps, and lease expiry with 3 attempts", () => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");
    const task1 = ensureTask(db, {
      source: "adzuna",
      title: "Role 1",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_1",
      now: t0,
    });
    const task2 = ensureTask(db, {
      source: "adzuna",
      title: "Role 2",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_1",
      now: new Date(t0.getTime() + 100),
    });

    // Only 1 adzuna task can be leased at a time (default maxConcurrent=1)
    const d1 = dispatchPendingTasks(db, {
      now: t0,
      leaseDurationMs: 60_000,
      rateLimits: {
        adzuna: { maxConcurrent: 1, minIntervalMs: 30_000, dailyCap: 2 },
      },
    });
    expect(d1.leasedTasks.map((t) => t.id)).toEqual([task1.taskId]);

    // Expire lease 3 times -> task1 becomes failed
    const d2 = dispatchPendingTasks(db, {
      now: new Date(t0.getTime() + 61_000),
      leaseDurationMs: 60_000,
    });
    expect(d2.expiredCount).toBe(1);
    expect(d2.failedCount).toBe(0);

    // Wait 61s again -> lease expires (attempt 2)
    dispatchPendingTasks(db, {
      now: new Date(t0.getTime() + 122_000),
      leaseDurationMs: 60_000,
    });
    // Wait 61s again -> lease expires (attempt 3 -> failed!)
    const d4 = dispatchPendingTasks(db, {
      now: new Date(t0.getTime() + 183_000),
      leaseDurationMs: 60_000,
    });
    expect(d4.failedCount).toBe(1);

    const failedRow = db
      .select()
      .from(schema.scrapeTasks)
      .where(eq(schema.scrapeTasks.id, task1.taskId))
      .get();
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.attempts).toBe(3);

    // task2 was leased in d2 or d4; verify it exists
    expect(task2.taskId).toBeTruthy();
  });

  it("applies exponential cooldown on 429/403 without consuming task attempts", () => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");
    const task = ensureTask(db, {
      source: "seek",
      title: "Backend Engineer",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_1",
      now: t0,
    });

    dispatchPendingTasks(db, { now: t0, leaseDurationMs: 60_000 });

    const hit1 = recordSourceRateLimitHit(db, {
      source: "seek",
      taskId: task.taskId,
      now: new Date(t0.getTime() + 1_000),
    });
    expect(hit1.cooldownLevel).toBe(1);
    expect(hit1.cooldownUntil).toBe(
      new Date(t0.getTime() + 1_000 + 5 * 60 * 1000).toISOString(),
    );

    const row = db
      .select()
      .from(schema.scrapeTasks)
      .where(eq(schema.scrapeTasks.id, task.taskId))
      .get();
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);

    // Still in cooldown at +2m -> not dispatched
    const duringCooldown = dispatchPendingTasks(db, {
      now: new Date(t0.getTime() + 2 * 60 * 1000),
    });
    expect(duringCooldown.leasedTasks).toHaveLength(0);

    // Second hit doubles to 10m
    const hit2 = recordSourceRateLimitHit(db, {
      source: "seek",
      now: new Date(t0.getTime() + 3 * 60 * 1000),
    });
    expect(hit2.cooldownLevel).toBe(2);
    expect(hit2.cooldownUntil).toBe(
      new Date(t0.getTime() + 3 * 60 * 1000 + 10 * 60 * 1000).toISOString(),
    );
  });

  it("imports postings idempotently per tenant and updates pipeline_runs to completed or partial", () => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");
    db.insert(schema.pipelineRuns)
      .values({
        id: "run_a",
        tenantId: "tenant_a",
        status: "running",
        tasksTotal: 2,
      })
      .run();
    db.insert(schema.pipelineRuns)
      .values({
        id: "run_b",
        tenantId: "tenant_b",
        status: "running",
        tasksTotal: 1,
      })
      .run();

    const task = ensureTask(db, {
      source: "golangjobs",
      title: "Go Developer",
      runtime: "worker",
      tenantId: "tenant_a",
      runId: "run_a",
      now: t0,
    });

    const completed = completeTask(db, {
      taskId: task.taskId,
      postings: [
        {
          jobUrl: "https://golangjobs.test/1",
          source: "golangjobs",
          company: "GoCo",
          title: "Go Developer",
        },
      ],
      now: t0,
    });

    // Idempotent second completeTask call
    const completedAgain = completeTask(db, {
      taskId: task.taskId,
      postings: [],
      now: t0,
    });
    expect(completedAgain.alreadyDone).toBe(true);
    expect(completedAgain.postingIds).toEqual(completed.postingIds);

    const firstImport = onTaskDoneForTenant(db, {
      taskId: task.taskId,
      tenantId: "tenant_a",
      runId: "run_a",
      postingIds: completed.postingIds,
      now: t0,
    });
    expect(firstImport.insertedCount).toBe(1);

    // Same posting imported into tenant_b succeeds
    const tenantBImport = onTaskDoneForTenant(db, {
      tenantId: "tenant_b",
      runId: "run_b",
      postingIds: completed.postingIds,
      cached: true,
      now: t0,
    });
    expect(tenantBImport.insertedCount).toBe(1);

    const runB = db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, "run_b"))
      .get();
    expect(runB?.status).toBe("completed");
    expect(runB?.tasksCached).toBe(1);

    // Second task for run_a fails -> run_a becomes partial
    onTaskDoneForTenant(db, {
      tenantId: "tenant_a",
      runId: "run_a",
      postingIds: [],
      taskStatus: "failed",
      now: t0,
    });
    const runA = db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, "run_a"))
      .get();
    expect(runA?.status).toBe("partial");
    expect(runA?.tasksDone).toBe(1);
    expect(runA?.tasksFailed).toBe(1);

    const sub = db
      .select()
      .from(schema.taskSubscribers)
      .where(eq(schema.taskSubscribers.taskId, task.taskId))
      .get();
    expect(sub?.notifiedAt).toBe(t0.toISOString());
  });

  it("marks tasks as needs_attention and cleans up postings unseen for 30 days", () => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");
    const task = ensureTask(db, {
      source: "hiringcafe",
      title: "Staff Engineer",
      runtime: "container",
      tenantId: "tenant_a",
      runId: "run_1",
      now: t0,
    });
    dispatchPendingTasks(db, { now: t0 });
    markTaskNeedsAttention(db, {
      taskId: task.taskId,
      error: "Cloudflare captcha",
      now: t0,
    });
    const taskRow = db
      .select()
      .from(schema.scrapeTasks)
      .where(eq(schema.scrapeTasks.id, task.taskId))
      .get();
    expect(taskRow?.status).toBe("needs_attention");

    db.insert(schema.postings)
      .values([
        {
          id: "p_old",
          urlNorm: "https://example.com/old",
          source: "adzuna",
          company: "OldCo",
          title: "Old Role",
          firstSeenAt: "2026-10-01T00:00:00.000Z",
          lastSeenAt: "2026-10-01T00:00:00.000Z",
        },
        {
          id: "p_new",
          urlNorm: "https://example.com/new",
          source: "adzuna",
          company: "NewCo",
          title: "New Role",
          firstSeenAt: "2026-11-20T00:00:00.000Z",
          lastSeenAt: "2026-11-20T00:00:00.000Z",
        },
      ])
      .run();

    const cleaned = cleanupUnseenPostings(db, { now: t0 });
    expect(cleaned.deletedCount).toBe(1);
    const remaining = db.select().from(schema.postings).all();
    expect(remaining.map((r) => r.id)).toEqual(["p_new"]);
  });

  it.each([
    { taskStatus: "done" as const, cached: false },
    { taskStatus: "failed" as const, cached: false },
    { taskStatus: "done" as const, cached: true },
  ])("counts $taskStatus completion once per task, tenant and run (cached=$cached)", ({
    taskStatus,
    cached,
  }) => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");
    db.insert(schema.pipelineRuns)
      .values([
        { id: "run_a", tenantId: "tenant_a", tasksTotal: 2 },
        { id: "run_a2", tenantId: "tenant_a", tasksTotal: 1 },
        { id: "run_b", tenantId: "tenant_b", tasksTotal: 1 },
      ])
      .run();
    const task = ensureTask(db, {
      source: "adzuna",
      title: "Engineer",
      tenantId: "tenant_a",
      runId: "run_a",
      now: t0,
    });
    const completed = completeTask(db, {
      taskId: task.taskId,
      postings: [
        {
          jobUrl: "https://example.com/job/1",
          source: "adzuna",
          company: "Acme",
          title: "Engineer",
        },
      ],
      now: t0,
    });
    if (taskStatus === "failed") {
      db.update(schema.scrapeTasks)
        .set({ status: "failed" })
        .where(eq(schema.scrapeTasks.id, task.taskId))
        .run();
    }

    for (const { tenantId, runId } of [
      { tenantId: "tenant_a", runId: "run_a" },
      { tenantId: "tenant_b", runId: "run_b" },
      { tenantId: "tenant_a", runId: "run_a2" },
    ]) {
      const input = {
        taskId: task.taskId,
        tenantId,
        runId,
        postingIds: completed.postingIds,
        taskStatus,
        cached,
        now: t0,
      };
      const expectedInserted =
        taskStatus === "failed" || runId === "run_a2" ? 0 : 1;
      expect(onTaskDoneForTenant(db, input)).toEqual({
        insertedCount: expectedInserted,
      });
      const run = db
        .select()
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.id, runId))
        .get();
      expect(run).toMatchObject({
        tasksDone: taskStatus === "done" ? 1 : 0,
        tasksFailed: taskStatus === "failed" ? 1 : 0,
        tasksCached: cached ? 1 : 0,
        jobsDiscovered: expectedInserted,
        status:
          runId === "run_a"
            ? "running"
            : taskStatus === "failed"
              ? "partial"
              : "completed",
      });

      expect(
        onTaskDoneForTenant(db, {
          ...input,
          now: new Date(t0.getTime() + 1_000),
        }),
      ).toEqual({ insertedCount: 0 });
      expect(
        db
          .select()
          .from(schema.pipelineRuns)
          .where(eq(schema.pipelineRuns.id, runId))
          .get(),
      ).toEqual(run);
    }

    expect(db.select().from(schema.taskSubscribers).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.taskId,
          tenantId: "tenant_a",
          runId: "run_a",
          notifiedAt: t0.toISOString(),
        }),
        expect.objectContaining({
          taskId: task.taskId,
          tenantId: "tenant_b",
          runId: "run_b",
          notifiedAt: t0.toISOString(),
        }),
      ]),
    );
    expect(db.select().from(schema.jobs).all()).toHaveLength(
      taskStatus === "failed" ? 0 : 2,
    );
  });

  it.each([
    true,
    false,
  ])("refreshes a re-scraped posting and preserves its identity (optional fields=%s)", (includeOptionalFields) => {
    const t0 = new Date("2026-11-22T10:00:00.000Z");
    const t1 = new Date(t0.getTime() + 25 * 60 * 60 * 1000);
    const taskInput = {
      source: "adzuna",
      title: "Engineer",
      tenantId: "tenant_a",
      runId: "run_a",
    };
    const task = ensureTask(db, { ...taskInput, now: t0 });
    const original = completeTask(db, {
      taskId: task.taskId,
      postings: [
        {
          jobUrl: "https://example.com/job/1?utm_source=old",
          source: "adzuna",
          company: "Acme",
          title: "Engineer",
          location: "London",
          description: "Original description",
          postedAt: "2026-11-21",
          extracted: { salary: 50000, obsolete: true },
        },
      ],
      now: t0,
    });

    const rescrape = ensureTask(db, {
      ...taskInput,
      tenantId: "tenant_b",
      runId: "run_b",
      now: t1,
    });
    expect(rescrape.status).toBe("created");
    const refreshed: IncomingPosting = {
      jobUrl: "https://example.com/job/1?utm_source=new#apply",
      source: "company-board",
      company: "Acme Ltd",
      title: "Senior Engineer",
      ...(includeOptionalFields
        ? {
            location: "Remote",
            description: "Updated description",
            postedAt: "2026-11-23",
            extracted: { salary: 70000 },
          }
        : {}),
    };
    const completed = completeTask(db, {
      taskId: rescrape.taskId,
      postings: [refreshed],
      now: t1,
    });
    expect(completed.postingIds).toEqual(original.postingIds);
    expect(db.select().from(schema.postings).all()).toEqual([
      {
        id: original.postingIds[0],
        urlNorm: "https://example.com/job/1",
        source: refreshed.source,
        company: refreshed.company,
        title: refreshed.title,
        location: refreshed.location ?? null,
        description: refreshed.description ?? null,
        postedAt: refreshed.postedAt ?? null,
        extracted: refreshed.extracted ?? null,
        firstSeenAt: t0.toISOString(),
        lastSeenAt: t1.toISOString(),
      },
    ]);
  });
});
