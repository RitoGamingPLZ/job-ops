import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";

describe("database migrations", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("adds candidate library columns to old bullets without losing rows", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";
      const path = join(process.env.DATA_DIR, "jobs.db");
      const old = new Database(path);
      old.exec("CREATE TABLE experience_bullets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'tenant_default', user_id TEXT, text TEXT NOT NULL, company TEXT, role TEXT, start_date TEXT, end_date TEXT, tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'manual', source_experience_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))); INSERT INTO experience_bullets(id,text) VALUES ('old','Built tools')");
      old.close();
      const url = pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href;
      await import(url + "?first");
      await import(url + "?second");
      const migrated = new Database(path);
      const row = migrated.prepare("SELECT * FROM experience_bullets WHERE id = 'old'").get();
      const marker = migrated.prepare("SELECT 1 FROM app_data_migrations WHERE id = 'candidate-library-structured-fields-v2'").get();
      if (!marker) throw new Error("Structured library migration did not run");
      if (row.text !== "Built tools" || row.kind !== "bullet" || row.data !== null || row.parent_id !== null || row.position !== 0) throw new Error("Legacy bullet defaults were not preserved");
      migrated.close();
    `;
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIR: tempDir },
      stdio: "pipe",
    });
  });

  it("boots when an older pipeline_runs table lacks config_snapshot", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const sqlite = new Database(dbPath);
      sqlite.exec(\`
        CREATE TABLE pipeline_runs (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          jobs_discovered INTEGER NOT NULL DEFAULT 0,
          jobs_processed INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        );
      \`);
      sqlite.close();

      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath, { readonly: true });
      const columns = migratedDb.prepare("PRAGMA table_info(pipeline_runs)").all();
      if (!columns.some((column) => column.name === "config_snapshot")) {
        throw new Error("config_snapshot column missing after migration");
      }
      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("creates tenant foreign keys for tenant-scoped core tables", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath, { readonly: true });

      function hasTenantCascade(tableName) {
        const fks = migratedDb.prepare(\`PRAGMA foreign_key_list(\${tableName})\`).all();
        return fks.some((fk) => fk.from === "tenant_id" && fk.table === "tenants" && String(fk.on_delete).toUpperCase() === "CASCADE");
      }

      const requiredTables = ["jobs", "pipeline_runs", "settings"];
      for (const tableName of requiredTables) {
        if (!hasTenantCascade(tableName)) {
          throw new Error(\`\${tableName} is missing tenant_id -> tenants(id) ON DELETE CASCADE\`);
        }
      }

      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("marks only existing workspaces for legacy onboarding migration", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const sqlite = new Database(dbPath);
      sqlite.exec(\`
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO settings(key, value) VALUES ('llmProvider', 'openrouter');
      \`);
      sqlite.close();

      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath, { readonly: true });
      const pending = migratedDb.prepare(
        "SELECT value FROM settings WHERE key = 'onboardingLegacyMigrationPending'",
      ).get();
      if (pending?.value !== "1") {
        throw new Error("Existing workspace was not marked for onboarding migration");
      }
      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIR: tempDir },
      stdio: "pipe",
    });
  });

  it("creates hosted usage tables with user-scoped foreign keys and indexes", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath, { readonly: true });

      function tableExists(tableName) {
        return Boolean(
          migratedDb
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(tableName),
        );
      }

      for (const tableName of ["account_subscriptions", "hosted_usage_counters", "hosted_usage_reservations"]) {
        if (!tableExists(tableName)) {
          throw new Error(\`\${tableName} was not created\`);
        }
        const fks = migratedDb.prepare(\`PRAGMA foreign_key_list(\${tableName})\`).all();
        const hasTenantCascade = fks.some((fk) => fk.from === "tenant_id" && fk.table === "tenants" && String(fk.on_delete).toUpperCase() === "CASCADE");
        const hasUserCascade = fks.some((fk) => fk.from === "user_id" && fk.table === "users" && String(fk.on_delete).toUpperCase() === "CASCADE");
        if (!hasTenantCascade || !hasUserCascade) {
          throw new Error(\`\${tableName} is missing hosted usage foreign keys\`);
        }
      }

      const counterIndexes = migratedDb.prepare("PRAGMA index_list(hosted_usage_counters)").all();
      const counterUnique = counterIndexes.find((index) => index.name === "idx_hosted_usage_counters_tenant_user_period_action_unique");
      if (!counterUnique || !counterUnique.unique) {
        throw new Error("hosted usage counter unique index missing");
      }

      const reservationIndexes = migratedDb.prepare("PRAGMA index_list(hosted_usage_reservations)").all();
      const reservationUnique = reservationIndexes.find((index) => index.name === "idx_hosted_usage_reservations_idempotency_unique");
      if (!reservationUnique || !reservationUnique.unique) {
        throw new Error("hosted usage reservation idempotency unique index missing");
      }

      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("backfills legacy PDF rows as generated", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const migrationUrl = pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href;
      await import(\`\${migrationUrl}?run=initial\`);

      // Simulate a database that predates the migration ledger: it has the legacy rows but no
      // recorded steps, so the next boot must run (and then record) every step.
      const sqlite = new Database(dbPath);
      sqlite.prepare("INSERT INTO jobs(id, title, employer, job_url, pdf_path, pdf_source) VALUES (?, ?, ?, ?, ?, NULL)").run(
        "legacy-pdf-job",
        "Legacy PDF Job",
        "Acme",
        "https://example.com/legacy-pdf-job",
        "data/pdfs/resume_legacy-pdf-job.pdf",
      );
      sqlite.prepare("DELETE FROM app_data_migrations WHERE id GLOB 'legacy-*'").run();
      sqlite.close();

      await import(\`\${migrationUrl}?run=backfill\`);

      const migratedDb = new Database(dbPath, { readonly: true });
      const row = migratedDb.prepare("SELECT pdf_source FROM jobs WHERE id = ?").get("legacy-pdf-job");
      if (row?.pdf_source !== "generated") {
        throw new Error(\`Expected legacy PDF source to be generated, got \${row?.pdf_source}\`);
      }
      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("records applied steps in the ledger and skips them on later boots", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const migrationUrl = pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href;
      const ledger = () => {
        const db = new Database(dbPath, { readonly: true });
        const legacy = db.prepare("SELECT id, applied_at FROM app_data_migrations WHERE id GLOB 'legacy-*' ORDER BY id").all();
        const numbered = db.prepare("SELECT id, name, checksum, applied_at FROM _portable_migrations ORDER BY id").all();
        db.close();
        return { legacy, numbered };
      };

      await import(\`\${migrationUrl}?run=first\`);
      const first = ledger();
      const expectedLegacyIds = [
        "legacy-0001-baseline-statements",
        "legacy-0002-tenancy-columns-and-rebuilds",
        "legacy-0003-private-user-scoping",
        "legacy-0004-post-application-and-settings-rebuilds",
        "legacy-0005-unique-and-lookup-indexes",
      ];
      if (JSON.stringify(first.legacy.map((row) => row.id)) !== JSON.stringify(expectedLegacyIds)) {
        throw new Error("Unexpected legacy ledger after first boot: " + JSON.stringify(first.legacy));
      }
      const numberedIds = first.numbered.map((row) => row.id);
      if (JSON.stringify(numberedIds) !== JSON.stringify(["0001", "0002", "0003", "0004", "0005", "0006"])) {
        throw new Error("Numbered migrations were not all recorded: " + JSON.stringify(first.numbered));
      }

      // 0005 adds users.permissions, which the legacy upgrade already created: it must have been
      // adopted rather than failing on the duplicate column.
      const inspect = new Database(dbPath, { readonly: true });
      const permissionColumns = inspect.prepare("PRAGMA table_info(users)").all().filter((c) => c.name === "permissions");
      inspect.close();
      if (permissionColumns.length !== 1) {
        throw new Error("Expected exactly one users.permissions column, got " + permissionColumns.length);
      }

      // Break an invariant that step 0001 would otherwise repair. If the second boot replayed the
      // history, pdf_source would be backfilled to 'generated'.
      const sqlite = new Database(dbPath);
      sqlite.prepare("INSERT INTO jobs(id, title, employer, job_url, pdf_path, pdf_source) VALUES (?, ?, ?, ?, ?, NULL)").run(
        "skipped-job",
        "Skipped",
        "Acme",
        "https://example.com/skipped-job",
        "data/pdfs/resume_skipped-job.pdf",
      );
      sqlite.close();

      await import(\`\${migrationUrl}?run=second\`);

      const check = new Database(dbPath, { readonly: true });
      const row = check.prepare("SELECT pdf_source FROM jobs WHERE id = ?").get("skipped-job");
      check.close();
      if (row?.pdf_source !== null) {
        throw new Error("Second boot replayed an already-applied step: pdf_source=" + row?.pdf_source);
      }
      if (JSON.stringify(ledger()) !== JSON.stringify(first)) {
        throw new Error("Ledger changed on a no-op boot: " + JSON.stringify(ledger()));
      }
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIR: tempDir },
      stdio: "pipe",
    });
  });

  it("seeds the bootstrap owner on a later boot and assigns unowned rows to them", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const migrationUrl = pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href;

      await import(\`\${migrationUrl}?run=no-env\`);

      const sqlite = new Database(dbPath);
      if (sqlite.prepare("SELECT count(*) AS count FROM users").get().count !== 0) {
        throw new Error("No owner should exist without BASIC_AUTH_* set");
      }
      sqlite.prepare("INSERT INTO jobs(id, tenant_id, user_id, title, employer, job_url) VALUES (?, ?, NULL, ?, ?, ?)").run(
        "unowned-job",
        "tenant_default",
        "Unowned",
        "Acme",
        "https://example.com/unowned-job",
      );
      sqlite.close();

      process.env.BASIC_AUTH_USER = "Owner";
      process.env.BASIC_AUTH_PASSWORD = "secret";
      await import(\`\${migrationUrl}?run=with-env\`);

      const check = new Database(dbPath, { readonly: true });
      const owner = check.prepare("SELECT id, username, is_system_admin FROM users").all();
      if (owner.length !== 1 || owner[0].username !== "owner" || owner[0].is_system_admin !== 1) {
        throw new Error("Bootstrap owner was not seeded on the later boot: " + JSON.stringify(owner));
      }
      const job = check.prepare("SELECT user_id FROM jobs WHERE id = ?").get("unowned-job");
      if (job?.user_id !== owner[0].id) {
        throw new Error("Unowned row was not assigned to the seeded owner: " + JSON.stringify(job));
      }
      check.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIR: tempDir, BASIC_AUTH_USER: "", BASIC_AUTH_PASSWORD: "" },
      stdio: "pipe",
    });
  });

  it("drops legacy tracer_links and tracer_click_events tables", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const sqlite = new Database(dbPath);
      sqlite.exec(\`
        CREATE TABLE tracer_links (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          job_id TEXT NOT NULL
        );

        CREATE TABLE tracer_click_events (
          id TEXT PRIMARY KEY,
          tracer_link_id TEXT NOT NULL
        );
      \`);
      sqlite.close();

      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath, { readonly: true });
      const tables = migratedDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tracer_links', 'tracer_click_events')")
        .all();
      if (tables.length !== 0) {
        throw new Error(\`Expected legacy tracer tables to be dropped, found: \${tables.map((t) => t.name).join(", ")}\`);
      }

      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("relaxes legacy NOT NULL password columns while preserving accounts", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const sqlite = new Database(dbPath);
      sqlite.exec(\`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          is_system_admin INTEGER NOT NULL DEFAULT 0,
          is_disabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE tenant_memberships (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner', 'member')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          UNIQUE(user_id, tenant_id)
        );

        INSERT INTO tenants(id, name, slug) VALUES ('tenant_default', 'JobOps', 'default');
        INSERT INTO users(id, username, display_name, password_hash, password_salt, is_system_admin)
        VALUES ('user-legacy', 'legacy', 'Legacy Owner', 'legacy-hash', 'legacy-salt', 1);
        INSERT INTO tenant_memberships(id, user_id, tenant_id, role)
        VALUES ('membership-legacy', 'user-legacy', 'tenant_default', 'owner');
      \`);
      sqlite.close();

      const migrationUrl = pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href;
      await import(\`\${migrationUrl}?run=initial\`);
      await import(\`\${migrationUrl}?run=rerun\`);

      const migratedDb = new Database(dbPath);
      const columns = migratedDb.prepare("PRAGMA table_info(users)").all();
      for (const columnName of ["password_hash", "password_salt"]) {
        const column = columns.find((entry) => entry.name === columnName);
        if (!column || column.notnull !== 0) {
          throw new Error(\`\${columnName} is still NOT NULL after migration\`);
        }
      }

      const user = migratedDb.prepare("SELECT username, password_hash, is_system_admin FROM users WHERE id = ?").get("user-legacy");
      if (user?.password_hash !== "legacy-hash" || user.is_system_admin !== 1) {
        throw new Error("Legacy user did not survive the rebuild");
      }

      const membership = migratedDb.prepare("SELECT tenant_id FROM tenant_memberships WHERE user_id = ?").get("user-legacy");
      if (membership?.tenant_id !== "tenant_default") {
        throw new Error("Legacy tenant membership did not survive the rebuild");
      }

      const userCount = migratedDb.prepare("SELECT count(*) AS count FROM users").get();
      if (userCount.count !== 1) {
        throw new Error(\`Expected a single user after the rebuild, got \${userCount.count}\`);
      }

      migratedDb.prepare("INSERT INTO users(id, username) VALUES (?, ?)").run("user-sso", "sso");

      let duplicateMessage = null;
      try {
        migratedDb.prepare("INSERT INTO users(id, username) VALUES (?, ?)").run("user-duplicate", "legacy");
      } catch (error) {
        duplicateMessage = error.message;
      }
      if (!duplicateMessage?.includes("UNIQUE constraint failed: users.username")) {
        throw new Error(\`Expected a username uniqueness failure, got \${duplicateMessage}\`);
      }

      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
        BASIC_AUTH_USER: "",
        BASIC_AUTH_PASSWORD: "",
      },
      stdio: "pipe",
    });
  });

  it("creates sso_identities with a unique provider subject", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath);

      const fks = migratedDb.prepare("PRAGMA foreign_key_list(sso_identities)").all();
      const hasTenantCascade = fks.some((fk) => fk.from === "tenant_id" && fk.table === "tenants" && String(fk.on_delete).toUpperCase() === "CASCADE");
      const hasUserCascade = fks.some((fk) => fk.from === "user_id" && fk.table === "users" && String(fk.on_delete).toUpperCase() === "CASCADE");
      if (!hasTenantCascade || !hasUserCascade) {
        throw new Error("sso_identities is missing its foreign keys");
      }

      const indexes = migratedDb.prepare("PRAGMA index_list(sso_identities)").all();
      if (!indexes.some((index) => index.name === "idx_sso_identities_user_id")) {
        throw new Error("sso_identities user index missing");
      }

      migratedDb.prepare("INSERT INTO users(id, username) VALUES (?, ?)").run("user-1", "alice");
      migratedDb.prepare("INSERT INTO sso_identities(id, user_id, provider, issuer, subject) VALUES (?, ?, ?, ?, ?)").run(
        "identity-1",
        "user-1",
        "oidc",
        "https://id.example.com",
        "subject-1",
      );

      let duplicateFailed = false;
      try {
        migratedDb.prepare("INSERT INTO sso_identities(id, user_id, provider, issuer, subject) VALUES (?, ?, ?, ?, ?)").run(
          "identity-2",
          "user-1",
          "oidc",
          "https://id.example.com",
          "subject-1",
        );
      } catch {
        duplicateFailed = true;
      }
      if (!duplicateFailed) {
        throw new Error("sso_identities allowed a duplicate provider subject");
      }

      let unknownProviderFailed = false;
      try {
        migratedDb.prepare("INSERT INTO sso_identities(id, user_id, provider, issuer, subject) VALUES (?, ?, ?, ?, ?)").run(
          "identity-3",
          "user-1",
          "linkedin",
          "https://id.example.com",
          "subject-2",
        );
      } catch {
        unknownProviderFailed = true;
      }
      if (!unknownProviderFailed) {
        throw new Error("sso_identities accepted an unknown provider");
      }

      const stored = migratedDb.prepare("SELECT tenant_id FROM sso_identities WHERE id = ?").get("identity-1");
      if (stored?.tenant_id !== "tenant_default") {
        throw new Error(\`Expected the default tenant, got \${stored?.tenant_id}\`);
      }

      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("enforces private unique indexes when user_id is null", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      await import(pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href);

      const migratedDb = new Database(dbPath);
      migratedDb.prepare("INSERT INTO jobs(id, tenant_id, user_id, title, employer, job_url) VALUES (?, ?, NULL, ?, ?, ?)").run(
        "job-null-owner-1",
        "tenant_default",
        "Role",
        "Acme",
        "https://example.com/null-owner",
      );

      let duplicateFailed = false;
      try {
        migratedDb.prepare("INSERT INTO jobs(id, tenant_id, user_id, title, employer, job_url) VALUES (?, ?, NULL, ?, ?, ?)").run(
          "job-null-owner-2",
          "tenant_default",
          "Role",
          "Acme",
          "https://example.com/null-owner",
        );
      } catch {
        duplicateFailed = true;
      }

      if (!duplicateFailed) {
        throw new Error("jobs unique index allowed duplicate NULL user_id rows");
      }

      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });

  it("idempotently adds must_change_password to legacy users tables", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-migrate-"));
    const script = `
      import { join } from "node:path";
      import { pathToFileURL } from "node:url";
      import Database from "better-sqlite3";

      const dbPath = join(process.env.DATA_DIR, "jobs.db");
      const oldDb = new Database(dbPath);
      oldDb.exec(\`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          is_system_admin INTEGER NOT NULL DEFAULT 0,
          is_disabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users(id, username, display_name, password_hash, password_salt, is_system_admin, is_disabled)
        VALUES ('legacy-user', 'legacy', 'Legacy User', 'hash', 'salt', 1, 0);
      \`);
      oldDb.close();

      const url = pathToFileURL(join(process.cwd(), "src/server/db/migrate.ts")).href;
      await import(url + "?first");
      await import(url + "?second");

      const migratedDb = new Database(dbPath, { readonly: true });
      const columns = migratedDb.prepare("PRAGMA table_info(users)").all();
      const col = columns.find((column) => column.name === "must_change_password");
      if (!col || col.notnull !== 1 || String(col.dflt_value) !== "0") {
        throw new Error("must_change_password column missing or has unexpected definition: " + JSON.stringify(col));
      }
      const row = migratedDb.prepare("SELECT username, must_change_password FROM users WHERE id = 'legacy-user'").get();
      if (!row || row.username !== "legacy" || row.must_change_password !== 0) {
        throw new Error("Legacy user row did not default must_change_password to 0: " + JSON.stringify(row));
      }
      migratedDb.close();
    `;

    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        DATA_DIR: tempDir,
      },
      stdio: "pipe",
    });
  });
});
