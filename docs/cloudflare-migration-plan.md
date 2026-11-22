# Job-Ops Cloudflare Migration Plan

Nov 22, 2026 · @Lin Fung Chiu

We move job-ops from one stateful container (local SQLite mirrored to D1 and R2) to Durable Object SQLite: one AppStore per tenant for user data, and one shared ScrapeCoordinator that scrapes each company and title at most once per 24 hours for all users. Scrape tasks live in a table that the coordinator dispatches to Workers, Browser Run or a container pool; each user then scores the shared postings against their own profile. The work ships in eight phases; each phase is deployable on its own and has a rollback.

## At a glance

&#91;embedded content: target architecture · AppStore per tenant, one shared ScrapeCoordinator, 3 runtimes\]

Each user's AppStore asks the shared coordinator for every search it needs. A search done in the last 24 hours is served from the shared postings; otherwise one scrape runs and every waiting user is notified when it lands. Only the coordinator writes postings; only each AppStore writes its tenant's data.

## Where we start

Today one Worker proxies every request to one Durable Object (`primary`) that owns one container running the whole Express app, its SQLite file and every scraper. D1 and R2 are mirrors, refreshed after mutating requests and reloaded on cold start.

| Area | Today | Why it matters |
| --- | --- | --- |
| Database | `better-sqlite3` + Drizzle, 37 tables, file under `/app/data` | Only the container can reach it |
| Mirror | `services/d1-sync.ts` (342 lines) pushes changes to D1 after POST/PUT/PATCH/DELETE; cold start rehydrates from D1 + R2 | Background pipeline writes are not mirrored until the next mutating request |
| Migrations | Hand-rolled `db/migrate.ts`, 1,938 lines | Must become ordered SQL migrations |
| Transactions | 25 synchronous `db.transaction()` calls | Need a store with real transactions |
| Raw SQL | 57 `sqlite.prepare/exec/pragma` calls | Must go through the ORM or a portable helper |
| DB access | 17 files import `db` directly | No seam to swap the driver |
| Files | 26 `DATA_DIR` references (PDFs, job documents, backups, design resumes) | Container disk is not durable |
| Pipeline | `runPipeline()` runs in-process, fire-and-forget; discovered jobs live in memory until import | A restart loses the run; its row stays `running` forever |
| Scrapers | 17 sources: 12 plain HTTP (adzuna behind a child-process wrapper), 4 Playwright, 1 Python (jobspy) | Decides which runtime each source can use |
| Lifetime | Container sleeps after 15 min without requests; hourly cron | Long scheduled runs can be killed mid-way |

## Decisions

Durable Object SQLite becomes the only database, each company and title is scraped once a day for every user, and each scrape runs in the runtime its source needs.

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| Database | Durable Object SQLite (`ctx.storage.sql`, Drizzle `durable-sqlite`) | D1: batch-only transactions break 25 read-decide-write flows. Turso: extra vendor, network hop per query. Postgres: dialect rewrite. |
| User data | One `AppStore` DO per tenant: Express API, the tenant's jobs, scores, tailoring | API in a stateless Worker: every query becomes an RPC hop, and transactions must live in the DO anyway |
| Shared scraping | One `ScrapeCoordinator` DO: `scrape_tasks` unique on `(scrape_key, window)`, subscribers, shared `postings` | Scraping per tenant: the same company and title scraped once per user |
| Freshness | A scrape key is reused while `completed_at` is within 24 h (rolling); failed scrapes do not count | Calendar-day window: every user refreshes at midnight |
| Task dispatch | The coordinator's alarm leases `pending` tasks from the table and calls executors directly | Cloudflare Queues: a second store of the same state, three queues and a DLQ to run; add later if one dispatcher becomes the bottleneck |
| Transactions | `transactionSync` inside one DO method; no `await` inside a transaction | Interactive transactions across RPC calls: not supported |
| Files | R2 (PDFs, documents, backups) | Container disk: lost on restart |
| Result hand-off | Executor writes raw JSON to R2, then calls `completeTask(taskId, postings)` inline; a retry imports from R2 instead of scraping again | Inline only: a failed import forces a re-scrape. R2 key only: an extra read on the happy path |
| Heavy runtime | Stateless container pool (`scraper-0..N`) for jobspy and blocked Playwright sources | Rewriting jobspy in Playwright: slower, blocked, we would own the scraper |
| Source routing | `runtime: "worker" \| "browser" \| "container"` in each `manifest.ts` | Hard-coded routing in the dispatcher |
| Scoring | Per tenant, in `AppStore`, on postings copied into the tenant's `jobs`; user-independent extraction cached once per posting | Shared scores: the fit depends on each user's profile |
| Captcha sources | Task ends `needs_attention`; a user re-runs that task | Pausing the whole run, as today |

## Roadmap

&#91;embedded content: roadmap · 8 phases, 3 gates, about 9–13 weeks including the 7-day soak\]

Phases 0 and 1 can run in parallel; Phase 3 is the one risky cutover, and everything after it moves one source at a time. Bands show order, not duration to scale.

## Task tracker

33 tasks across the eight phases plus one prerequisite; change a task's status from its dropdown as work moves. Task 0 is the security fix and must ship before any user is onboarded.

| # | Task | Phase | Status | Depends on |
| --- | --- | --- | --- | --- |
| 0 | Merge and deploy the API auth-bypass and deploy-trigger fixes ([PR #9](https://github.com/RitoGamingPLZ/job-ops/pull/9)) | Prerequisite | Done | — |
| 1 | Spike A: Express app inside a Durable Object with `durable-sqlite` (`AppStore` DO implemented) | 0 | Done | — |
| 2 | Spike B: alarm dispatcher to a 2-container scraper pool (`ScrapeCoordinatorDO` + `ScraperContainer` pool) | 0 | Done | — |
| 3 | Spike C: Browser Run bot test for hiringcafe, naukri, gradcracker, ukvisajobs (`runtime` assigned in manifests; live Browser Rendering binding pending Cloudflare config) | 0 | In progress | — |
| 4 | Spike D: copy production SQLite into a DO, compare row counts (`scripts/export-import-do.ts` + `/_cf/do/import`) | 0 | Done | — |
| 5 | Mark `running` pipeline runs as `failed` on startup | 1 | Done | — |
| 6 | DO alarm during runs: mirror sync + container keep-alive | 1 | Done | — |
| 7 | Import discovered jobs per source as each finishes | 1 | Done | — |
| 8 | Scheduler catch-up for missed or interrupted runs | 1 | Done | — |
| 9 | Scoring LLM calls: `maxRetries: 2` | 1 | Done | — |
| 10 | `getDb()` seam replaces direct `db` imports (`getDb()`, `setDb()` in `db/index.ts`) | 2 | Done | 1, 4 |
| 11 | Port raw `sqlite.prepare/exec/pragma` calls (`execRawSql()` helper + portable migrations) | 2 | Done | 10 |
| 12 | Audit transactions: synchronous, no `await` inside (`runTransactionSync()` guard in `db/index.ts`) | 2 | Done | 10 |
| 13 | Ordered SQL baseline + migrations (`portable-migrations.ts` for `better-sqlite3` & DO `SqlStorage`) | 2 | Done | 10 |
| 14 | `BlobStore` with R2 adapter (`blob-store.ts` wired to `pdf-storage.ts` & `job-document-storage.ts`; `DATA_BUCKET` -> `job-ops-data` bound in `wrangler.jsonc`) | 2 | Done | — |
| 15 | Move Node-only work (LaTeX, extractors) off the API (`ScraperContainer` & `BlobStore` seams) | 2 | Done | 1 |
| 16 | `AppStore` DO class + `DB_BACKEND` routing flag (`DB_BACKEND=container` default, `DB_BACKEND=do` ready) | 3 | Done | 10–15 |
| 17 | Export/import script with per-table checksums (`scripts/export-import-do.ts`) | 3 | Done | 4 |
| 18 | Cutover: freeze writes (`WRITE_FREEZE`), copy, flip the flag | 3 | Done (live on `jobdb.alanchiu.net`, `DB_BACKEND="do"`, 1,257 jobs + 2 users migrated from D1; static career boards/manifests bundled in DO, `/api/internal/scrape/run` + `ScraperContainer` wired, `design-resume` assets on `BlobStore`) | 16, 17 |
| 19 | 7-day soak, then delete D1 sync, Litestream, hydration | 3 | Pending 7-day soak | 18 |
| 20 | `runtime` + `rateLimit` in every `manifest.ts` | 4 | Done | — |
| 21 | `ScrapeCoordinator` DO: `scrape_tasks`, `task_subscribers`, `postings`, `source_state` | 4 | Done | 18 |
| 22 | `ensureTask` with 24-hour reuse and subscribers | 4 | Done | 21 |
| 23 | Alarm dispatcher: leases, retries, per-site rate limiter, cooldown | 4 | Done | 20, 21 |
| 24 | `Scraper` container pool running every extractor | 4 | Done | 2, 23 |
| 25 | `completeTask` + `onTaskDone`, raw JSON archived to R2 (optional until R2 enabled) | 4 | Done | 22, 24 |
| 26 | Per-tenant import + scoring with cached extraction | 4 | Done | 25 |
| 27 | `pipeline_runs` task counters, `partial` status, task view in the UI | 4 | Done | 25 |
| 28 | 30-day retention for unseen postings | 4 | Done | 21 |
| 29 | Worker executor with Worker-safe `run(task)` entry points (including Adzuna direct fetch) | 5 | Done | 24 |
| 30 | Move the HTTP sources (`runtime: "worker"` set in manifests; 3-day count verification pending in prod) | 5 | In progress | 29 |
| 31 | Port unblocked Playwright sources (`gradcracker`, `ukvisajobs` -> `runtime: "browser"`) | 6 | Done | 3, 24 |
| 32 | Delete the in-process discovery path and `isRunning` lock | 7 | Deferred until Phases 3–6 soak | 30, 31 |
| 33 | Slim the container image; delete the D1 mirror and R2 mirror bucket | 7 | Deferred until Phases 3–6 soak | 32 |

> [!NOTE]
> **Non-blocking Cloudflare Config Notes:**
> - **R2 Storage:** Enabled (`job-ops-data` bucket provisioned in `ENAM` and bound as `DATA_BUCKET` in `job-ops-infra/wrangler.jsonc`).
> - **Browser Rendering Binding:** `gradcracker` and `ukvisajobs` are configured with `runtime: "browser"`, falling back cleanly until a Cloudflare Browser Rendering binding is attached.

## Phase 0 — Spikes (1 week, throwaway code)

Four spikes prove the assumptions the whole plan rests on; if spike A fails, we switch the database target to Turso and keep Express in the container.

1. **A. Express inside a Durable Object.** Boot the current Express app in a DO with `nodejs_compat`, Drizzle `durable-sqlite` and 3 real routes (jobs list, job detail, settings save).
   - Pass: bundle fits the Worker size limit, cold start under 2 s, steady memory under the DO isolate limit (128 MB, to confirm), p95 under 150 ms.
   - Also list every Node API the server uses (`fs`, `child_process`, `net`) and where each must move.
2. **B. Dispatcher to container pool round trip.** A DO alarm dispatcher sends a task to `scraper-0` and `scraper-1`; each runs jobspy, writes JSON to R2, calls a stub `completeTask`.
   - Pass: 20 tasks finish with 2 leased at a time, a forced failure retries, and a task ends `failed` after 3 attempts.
3. **C. Browser Run bot test.** Run hiringcafe, naukri, gradcracker and ukvisajobs once each with `@cloudflare/playwright`.
   - Output: a pass/blocked table that sets each source's `runtime`.
4. **D. Data size and copy.** Export the production SQLite, load it into a DO in batches of 500 rows.
   - Pass: full copy under 10 min, row counts match per table, size well under 10 GB.

**Gate to Phase 2:** A and D pass. B and C only shape Phase 4 onward.

## Phase 1 — Stabilize today's stack (2–3 days, ships to prod)

These fixes stop data loss now and stay useful until Phase 3 removes the old path.

1. On startup, mark `pipeline_runs` rows still `running` as `failed` with "interrupted by restart" — one `UPDATE` beside `resetInterruptedJobs()` in `orchestrator/src/server/index.ts`.
2. While a run is active, the DO sets an alarm every 60 s that calls `syncContainerToD1AndR2` and renews the container's activity timeout. This mirrors background writes and stops the 15-minute kill.
3. Import discovered jobs per source as each source finishes, instead of holding them in memory until discovery ends.
4. Scheduler catch-up: if the last scheduled run failed or was interrupted and its hour has passed today, run it on the next cron tick.
5. Scoring LLM calls: `maxRetries: 2`.

**Done when:** killing the container mid-run leaves a `failed` row, the jobs from finished sources are in D1, and the next cron tick reruns the schedule.

## Phase 2 — Make the database layer portable (2–3 weeks, ships on today's stack)

Every change here runs on today's `better-sqlite3`, so each step ships and is tested in production before any cutover.

1. **One seam for the database.** Replace the 17 direct `db` imports with `getDb()` from `db/index.ts`. It returns `better-sqlite3` Drizzle today and `durable-sqlite` Drizzle after Phase 3.
2. **Remove raw SQLite.** Port the 57 `sqlite.prepare/exec/pragma` calls to Drizzle or `db.run(sql\`…\`)` . Keep  `PRAGMA\` only in migration code.
3. **Transactions stay synchronous.** Keep the 25 `db.transaction()` calls synchronous and free of `await`, which matches `transactionSync`. Move any LLM or `fetch` call inside one to before or after it.
4. **Ordered SQL migrations.** Generate a baseline from `db/schema.ts` with `drizzle-kit`, then replace `db/migrate.ts` (1,938 lines) with numbered SQL files. Check that the baseline matches production with a schema diff.
5. **Files to R2.** Put the 26 `DATA_DIR` uses (`pdf-storage`, `job-document-storage`, `backup`, `design-resume`, `visa-sponsors`) behind a `BlobStore` with `local` and `r2` adapters.
6. **Node-only work leaves the API.** Spike A's list decides it. Expected: LaTeX PDF rendering and every extractor move to the container pool; the API calls them through RPC.

**Done when:** the full test suite passes, no file outside `db/` imports `better-sqlite3`, and production runs with `BlobStore=r2`.

## Phase 3 — Cut over to Durable Object SQLite (1–2 weeks)

The API moves into a new `AppStore` Durable Object; the old container path stays deployed and read-only until the new one has run clean for 7 days.

1. **New DO class `AppStore`** in `job-ops-infra`: hosts the Express app, runs migrations in `blockConcurrencyWhile` at construction, and exposes RPC methods for internal callers (`completeTask`, `failTask`, `getRunStatus`).
2. **Routing flag.** The Worker sends requests to `AppStore` when `DB_BACKEND=do`, else to the old container DO. Flipping the flag is the rollback.
3. **Data copy.** Freeze writes (maintenance banner, `POST/PUT/PATCH/DELETE` return 503), export the container SQLite, import into `AppStore` in 500-row batches with the Phase 0 script, compare row counts and a checksum per table.
4. **Flip and watch.** Set `DB_BACKEND=do`, lift the freeze. Keep the old container image and its last D1/R2 mirror for 7 days.
5. **Remove the mirror.** Delete `services/d1-sync.ts`, the `/api/internal/d1-sync/*` routes, Litestream, `hydrateContainerFromD1AndR2` and `syncContainerToD1AndR2`.

**Rollback:** inside the 7 days, freeze writes, export `AppStore` back to SQLite with the same script, set `DB_BACKEND=container`.

**Done when:** 7 days on `AppStore` with no data incident, then the mirror code is deleted.

## Phase 4 — Shared scrape coordinator with a container pool (2–3 weeks)

Every source still runs in a container in this phase; what changes is that each company and title is scraped once per 24 hours for all users, as a durable task with its own retries.

1. **Runtime in each manifest.** Add `runtime: "worker" | "browser" | "container"` to every `manifest.ts`; all start as `container`.
2. **Scrape key.** `source + target (company or board) + normalized title + canonical location`. Normalize: lowercase, trim, collapse spaces. Synonyms ("SDE" vs "Software Development Engineer") are out of scope.
3. **`ScrapeCoordinator` DO** (one, shared). `ensureTask(key, tenantId, runId)` runs in one `transactionSync`:
   - a `done` task with `completed_at` in the last 24 h → return its posting ids; the caller scores them at once;
   - a `pending` or `running` task → add a subscriber and return `waiting`;
   - none, or the last attempt `failed` → create a task (unique on `scrape_key, window_start`), add a subscriber.
4. **Alarm dispatcher** in the coordinator, every 30 s while work exists: expire leases (`attempts + 1`, or `failed` at 3), lease up to N `pending` tasks per runtime (start: container 2) that also pass the **per-site rate limiter**, then call the executor without awaiting it. The limiter reads `rateLimit` from each `manifest.ts` (default: 1 request at a time, at least 30 s between requests, a daily cap) and tracks each site in `source_state`. A 429 or 403 response puts the site in a cooldown that doubles on each repeat (5 min, 10 min, up to 2 h); its tasks wait as `pending` and do not use up attempts.
5. **Container pool.** A new `Scraper` container class, smallest instance type, no database. The dispatcher calls `getByName("scraper-" + i)`; the container runs the extractor's `run(task)`, writes raw JSON to R2, then calls `coordinator.completeTask(taskId, postings)`.
6. **`completeTask`** is idempotent: in one `transactionSync` it upserts postings (unique on normalized URL), marks the task `done`, and reads its subscribers. It then calls `AppStore(tenant).onTaskDone(taskId, postingIds)` for each, outside the transaction. If a call to `completeTask` fails, the retry imports from the R2 copy instead of scraping again.
7. **Per-tenant import and scoring.** `onTaskDone` copies the postings into the tenant's `jobs` (status `discovered`, skipping ones already present) and scores new ones with the user's profile. Scoring reuses user-independent fields (requirements, seniority, salary) extracted once per posting by the coordinator.
8. **Run state.** `pipeline_runs` tracks the run: it is `completed` when every task it subscribed to is `done`, `partial` when some `failed`. The UI shows per-task status and whether each search came from cache.

**Done when:** two users requesting the same search within a minute trigger one scrape and both get scored jobs, a container kill mid-scrape loses no postings, and a forced source failure ends the run as `partial`.

## Phases 5–7 — Move sources off the container, then decommission

Each source moves by flipping one `runtime` value, so every move is reversible in one deploy.

**Phase 5 — HTTP sources to a Worker executor (1 week).**

1. Give each HTTP extractor a Worker-safe entry point: `run(task) → jobs[]`, `fetch` only, no Node built-ins. Remove adzuna's child-process wrapper and call its `main.ts` logic directly.
2. Dispatcher limits for this runtime: up to 10 tasks at once, 1 per site, 3 attempts.
3. Move the 12 HTTP sources one at a time: fiveamsat, freehire, golangjobs, jobindex, seek, startupjobs, wazzuf, workingnomads, adzuna, greenhouse, workday, bamboohr. Compare job counts against the container run for 3 days before moving the next one; Cloudflare IPs may be blocked.

**Phase 6 — Playwright sources to Browser Run (1 week).**

1. Port the Playwright sources that passed spike C to `@cloudflare/playwright`.
2. `max_concurrency` at or under 10, which is the number of included concurrent browsers.
3. Blocked sources keep `runtime: "container"`. Captcha challenges end the task as `needs_attention` instead of pausing the run.

**Phase 7 — Decommission (2–3 days).**

1. Delete the in-process `runPipeline()` discovery path and the `isRunning` in-memory lock.
2. Shrink the container image to Python + jobspy + Chromium for the remaining sources + LaTeX.
3. Delete the D1 database and the R2 mirror bucket after a final export to cold storage.

## New data model

Three new tables live in the shared ScrapeCoordinator; each tenant's AppStore only extends two existing tables. Scoring and tailoring keep using `jobs.status` as their work queue, as `resetInterruptedJobs()` already does.

| Store | Table | Key columns | Notes |
| --- | --- | --- | --- |
| ScrapeCoordinator | `scrape_tasks` (new) | `id`, `scrape_key`, `window_start`, `source`, `runtime`, `target`, `title_norm`, `location`, `status`, `attempts`, `lease_until`, `completed_at`, `result_key`, `postings_found`, `error` | Unique on `(scrape_key, window_start)`; `status`: `pending` · `running` · `done` · `failed` · `needs_attention` |
| ScrapeCoordinator | `task_subscribers` (new) | `task_id`, `tenant_id`, `run_id`, `notified_at` | Primary key `(task_id, tenant_id, run_id)`; `notified_at` set when `onTaskDone` succeeds, so failed notifications are retried |
| ScrapeCoordinator | `postings` (new) | `id`, `url_norm`, `source`, `company`, `title`, `location`, `description`, `posted_at`, `first_seen_at`, `last_seen_at`, `extracted` (json) | Unique on `url_norm`; `extracted` holds user-independent fields computed once |
| AppStore (per tenant) | `pipeline_runs` (extended) | + `tasks_total`, `tasks_done`, `tasks_failed`, `tasks_cached`; status + `partial` | Replaces the planned `scrape_runs` |
| AppStore (per tenant) | `jobs` (extended) | + `posting_id` | Unique on `posting_id`; the row keeps a copy of the posting so existing code is unchanged |

`completeTask` and `onTaskDone` are idempotent: a task already `done`, or a posting already linked to the tenant, returns early, so retries cannot create duplicates.

The per-site rate limiter adds one small table to the ScrapeCoordinator: `source_state` with `source` (primary key), `in_flight`, `last_dispatch_at`, `requests_today`, `day`, `cooldown_until` and `cooldown_level`. Limits themselves stay in each source's `manifest.ts`, so changing a site's pace is a one-line deploy.

## Capacity at 50 users

The design handles 50 users with large headroom; four additions are needed: a postings retention policy, a per-site crawl rate limiter, spread-out schedules, and a Browser Run budget of about $20 a month. A global LLM cap is deferred until usage shows it is needed.

Assumptions (estimates, not measured): each user runs daily with 3 titles × 2 locations across 10 of the 17 sources, about 60 searches per user per day; 30–50% of searches overlap between users; a scrape returns about 30 postings.

| Component | Load at 50 users | Limit or budget | Verdict |
| --- | --- | --- | --- |
| AppStore per tenant | 1 user each | single-threaded DO, per tenant | Fine: isolated, no shared bottleneck |
| ScrapeCoordinator calls | \~3,000 `ensureTask` + \~2,000 `completeTask` per day; \~1.4/s if all in one hour | hundreds of simple calls/s | Fine; shard by `hash(scrape_key)` only near thousands of users |
| Scrapes after dedup | \~2,000 per day: \~1,400 HTTP, \~470 Playwright, \~120 jobspy | — | Fine |
| Rows written (coordinator) | \~60 k posting upserts/day ≈ 7 M rows/month with indexes | 50 M/month included | Fine |
| Postings storage | \~10–20 k new postings/day × \~5 KB ≈ 50–100 MB/day | 10 GB per DO | **Needs retention**: drop postings unseen for 30 days (≈ 1.5–3 GB steady) |
| Browser Run | \~470 tasks × \~1 min ≈ 235 h/month, 4 concurrent | 10 h + 10 browsers included | \~$20/month extra |
| Container pool (jobspy) | \~120 tasks × \~2 min ≈ 4 container-hours/day; 2 h wall time with 2 scrapers | — | Fine; cost to confirm |
| Per-site traffic | \~120 searches/day per site | each site's tolerance | **Planned:** per-site rate limiter with cooldown on 429/403 (Phase 4) |
| LLM scoring | \~100–300 new postings/user/day ≈ 5–15 k scoring calls/day | provider rate limit and price | **Deferred:** no global cap at launch; batch several postings per call and reuse cached extraction; add a cap if 429s or a backlog appear |
| Hourly cron | 50 AppStores woken | — | **Spread** each user's schedule across hours so scrapes do not all land at once |

## Risks and open questions

The largest risk is the Express app not fitting inside a Durable Object; spike A answers it in week 1, and Turso is the fallback.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Express + dependencies exceed the DO memory or bundle limit | Phase 3 blocked | Spike A; fallback: Turso with embedded replica, API stays in the container |
| Shared coordinator is down or slow | No new scrapes for anyone | Calls are short and idempotent; cached searches still score; shard by `hash(scrape_key)` if load grows |
| Postings catalog reaches the 10 GB DO limit | Writes fail | 30-day retention on unseen postings; descriptions can move to R2 |
| Cloudflare IPs blocked by job sites | Fewer postings from Worker or Browser Run sources | Compare counts before each move; `runtime` flips back in one deploy; 1 request per site at a time |
| Lease expires while the executor is still working | The same search scraped twice | `completeTask` is idempotent; lease longer than the slowest source |
| LLM rate limit or cost at 50 users | Scoring backlog, bill | Deferred at launch: batch scoring and cached extraction; add a global cap if 429s or a backlog appear |
| Data copy at cutover | Data loss | Write freeze, per-table row counts and checksums, 7-day rollback window |
| API auth bypass (`/API/...`) from the security audit | Data exposure today | Fixed in PR #9; merge and deploy before onboarding users |

**Open questions**

- [ ] Does any tenant other than `tenant_default` hold data in production? This decides one DO now versus one per tenant. -> Yes
- [ ] Is LaTeX PDF rendering staying, or can it move to a Worker-friendly renderer?
- [ ] What is the DO isolate memory limit for this account and plan? To confirm in spike A.
- [ ] Does the hourly cron stay, or do schedules move to DO alarms per tenant?

## Cost

At 50 users the platform costs about $25 a month (the $5 Workers Paid plan plus \~$20 of Browser Run), before container minutes and LLM calls, which were not priced for this plan.

| Item | Included in Workers Paid | Expected use at 50 users | Extra cost |
| --- | --- | --- | --- |
| DO SQLite rows written | 50 M / month | \~7 M (coordinator) + tenant imports | $0 |
| DO SQLite rows read | 25 B / month | tens of M | $0 |
| DO SQLite storage | 5 GB, then $0.20 / GB-month | 1.5–3 GB with 30-day retention | $0 |
| Browser Run hours | 10 h / month, then $0.09 / h | \~235 h | \~$20 |
| Browser Run concurrency | 10 browsers | \~4 | $0 |
| Containers | not checked | \~4 container-hours / day | to confirm |
| LLM scoring | not checked | 5–15 k calls / day | to confirm; the largest variable cost |

## Sources

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/)
- [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- [Browser Run crawl endpoint](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/index.md)
