// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/server/auth/password";
import {
  DEFAULT_ADMIN_PREFIX,
  DEFAULT_OUT_DB_PATH,
  DEFAULT_SOURCE_DB_PATH,
  formatSummary,
  generateAdminUsername,
  generateOneTimePassword,
  parseCliArgs,
  prepareCloudflareDb,
} from "./prepare-cloudflare-db";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "job-ops-cf-db-test-"));
  tempDirs.push(dir);
  return dir;
}

function createFixtureSourceDb(
  dbPath: string,
  options?: { includeMustChangePasswordColumn?: boolean },
): void {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const mustChangeCol = options?.includeMustChangePasswordColumn
      ? ", must_change_password INTEGER NOT NULL DEFAULT 0"
      : "";

    db.exec(`
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT,
        password_salt TEXT,
        is_system_admin INTEGER NOT NULL DEFAULT 0,
        is_disabled INTEGER NOT NULL DEFAULT 0${mustChangeCol},
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE tenant_memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'owner',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        employer TEXT NOT NULL,
        job_url TEXT NOT NULL
      );

      CREATE TABLE settings (
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE watchlist_seen_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_job_id TEXT NOT NULL
      );
    `);

    // Seed tenants
    db.prepare("INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
      "tenant_default",
      "JobOps",
      "default",
      "tenant_onboarding",
      "Onboarding Test",
      "onboarding-test-12345678",
      "tenant_shared",
      "Shared Workspace",
      "shared-12345678",
    );

    // Seed users
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, is_system_admin, is_disabled)
       VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "user_alan",
      "alan",
      "Alan",
      "hash_alan",
      "salt_alan",
      1,
      0,
      "user_onboarding",
      "onboarding-test",
      "Onboarding Test",
      "hash_onb",
      "salt_onb",
      0,
      0,
      "user_shared_keep",
      "teammate",
      "Teammate",
      "hash_team",
      "salt_team",
      0,
      0,
      "user_shared_drop",
      "temp-guest",
      "Temp Guest",
      "hash_guest",
      "salt_guest",
      0,
      0,
    );

    // Seed memberships
    db.prepare(
      `INSERT INTO tenant_memberships (id, user_id, tenant_id, role)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
    ).run(
      "mem_1",
      "user_alan",
      "tenant_default",
      "owner",
      "mem_2",
      "user_onboarding",
      "tenant_onboarding",
      "owner",
      "mem_3",
      "user_shared_keep",
      "tenant_shared",
      "owner",
      "mem_4",
      "user_shared_drop",
      "tenant_shared",
      "member",
    );

    // Seed jobs, settings, and watchlist rows
    db.prepare(
      `INSERT INTO jobs (id, tenant_id, user_id, title, employer, job_url)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
    ).run(
      "job_alan_1",
      "tenant_default",
      "user_alan",
      "Software Engineer",
      "Acme",
      "https://example.com/1",
      "job_onb_1",
      "tenant_onboarding",
      "user_onboarding",
      "Dummy Job",
      "Dummy Corp",
      "https://example.com/2",
      "job_shared_keep",
      "tenant_shared",
      "user_shared_keep",
      "Backend Eng",
      "Shared Co",
      "https://example.com/3",
      "job_shared_drop",
      "tenant_shared",
      "user_shared_drop",
      "Guest Job",
      "Shared Co",
      "https://example.com/4",
    );

    db.prepare(
      "INSERT INTO settings (tenant_id, user_id, key, value) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
    ).run(
      "tenant_default",
      "user_alan",
      "theme",
      "dark",
      "tenant_onboarding",
      "user_onboarding",
      "theme",
      "light",
    );

    db.prepare(
      "INSERT INTO watchlist_seen_jobs (id, tenant_id, user_id, source, source_job_id) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    ).run(
      "wl_alan",
      "tenant_default",
      "user_alan",
      "greenhouse",
      "gh-1",
      "wl_guest",
      "tenant_shared",
      "user_shared_drop",
      "greenhouse",
      "gh-2",
    );
  } finally {
    db.close();
  }
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("prepare-cloudflare-db CLI and generators", () => {
  it("parses default CLI options", () => {
    const options = parseCliArgs([], "/tmp/work");
    expect(options).toEqual({
      sourcePath: DEFAULT_SOURCE_DB_PATH,
      outPath: DEFAULT_OUT_DB_PATH,
      adminPrefix: DEFAULT_ADMIN_PREFIX,
      excludeUsers: [],
      keepExistingAdmins: false,
      help: false,
    });
  });

  it("parses custom CLI flags including repeatable --exclude-user", () => {
    const options = parseCliArgs(
      [
        "--source",
        "custom/source.db",
        "--out=custom/out.db",
        "--admin-prefix",
        "ops-admin",
        "--exclude-user",
        "Onboarding-Test",
        "--exclude-user=temp-guest",
        "--exclude-user",
        "onboarding-test",
        "--keep-existing-admins",
      ],
      "/tmp/work",
    );

    expect(options).toEqual({
      sourcePath: "/tmp/work/custom/source.db",
      outPath: "/tmp/work/custom/out.db",
      adminPrefix: "ops-admin",
      excludeUsers: ["onboarding-test", "temp-guest"],
      keepExistingAdmins: true,
      help: false,
    });
  });

  it("rejects unknown flags and invalid admin prefixes", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow(/Unknown CLI argument/);
    expect(() => parseCliArgs(["--admin-prefix", "bad prefix!"])).toThrow(/Invalid --admin-prefix/);
    expect(() => parseCliArgs(["--source"])).toThrow(/Missing value/);
  });

  it("generates lowercase alphanumeric admin usernames and strong 20+ char passwords", () => {
    const username = generateAdminUsername("admin");
    expect(username).toMatch(/^admin-[a-z0-9]{6}$/);

    const password = generateOneTimePassword();
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%^&*\-_=+]/);
  });
});

describe("prepareCloudflareDb", () => {
  it("snapshots WAL DB without mutating source, migrates schema, strips excluded users, demotes existing admins, and creates bootstrap admin", async () => {
    const dir = await makeTempDir();
    const sourcePath = join(dir, "live.db");
    const outDir = join(dir, "export");
    const outPath = join(outDir, "jobs.db");

    createFixtureSourceDb(sourcePath);

    // Keep an open write connection with an uncheckpointed WAL write to verify
    // SQLite backup() captures live WAL state cleanly.
    const liveWriter = new Database(sourcePath);
    liveWriter
      .prepare(
        "INSERT INTO jobs (id, tenant_id, user_id, title, employer, job_url) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "job_alan_wal",
        "tenant_default",
        "user_alan",
        "WAL Live Job",
        "Live Co",
        "https://example.com/wal",
      );

    let result: Awaited<ReturnType<typeof prepareCloudflareDb>>;
    try {
      result = await prepareCloudflareDb({
        sourcePath,
        outPath,
        adminPrefix: "admin",
        excludeUsers: ["onboarding-test", "temp-guest", "nonexistent-user"],
        keepExistingAdmins: false,
      });
    } finally {
      liveWriter.close();
    }

    // 1. Source DB must be completely untouched
    const sourceCheck = new Database(sourcePath, { readonly: true });
    try {
      const sourceCols = sourceCheck.prepare("PRAGMA table_info(users)").all() as Array<{
        name: string;
      }>;
      expect(sourceCols.some((col) => col.name === "must_change_password")).toBe(false);

      const sourceAlan = sourceCheck
        .prepare("SELECT is_system_admin FROM users WHERE username = 'alan'")
        .get() as { is_system_admin: number };
      expect(sourceAlan.is_system_admin).toBe(1);

      const sourceUsers = sourceCheck
        .prepare("SELECT username FROM users ORDER BY username")
        .all() as Array<{ username: string }>;
      expect(sourceUsers.map((row) => row.username)).toEqual([
        "alan",
        "onboarding-test",
        "teammate",
        "temp-guest",
      ]);
    } finally {
      sourceCheck.close();
    }

    // 2. Exported DB should be a single clean file with no secrets files written
    const exportFiles = await readdir(outDir);
    expect(exportFiles).toEqual(["jobs.db"]);
    expect(existsSync(outPath)).toBe(true);

    // 3. Verify result metadata
    expect(result.addedMustChangePasswordColumn).toBe(true);
    expect(result.demotedAdmins).toEqual(["alan"]);
    expect(result.keptAdmins).toEqual([]);
    expect(result.notFoundExcludedUsers).toEqual(["nonexistent-user"]);
    expect(result.excludedUsers).toEqual([
      {
        id: "user_onboarding",
        username: "onboarding-test",
        removedTenantIds: ["tenant_onboarding"],
      },
      {
        id: "user_shared_drop",
        username: "temp-guest",
        removedTenantIds: [],
      },
    ]);
    expect(result.adminUser.username).toMatch(/^admin-[a-z0-9]{6}$/);
    expect(result.adminUser.oneTimePassword.length).toBeGreaterThanOrEqual(20);
    expect(result.adminUser.mustChangePassword).toBe(true);

    // 4. Inspect exported DB contents directly
    const outDb = new Database(outPath, { readonly: true });
    try {
      const cols = outDb.prepare("PRAGMA table_info(users)").all() as Array<{
        name: string;
      }>;
      expect(cols.some((col) => col.name === "must_change_password")).toBe(true);

      // alan is demoted, data & WAL job preserved
      const alan = outDb
        .prepare(
          "SELECT is_system_admin, is_disabled, must_change_password FROM users WHERE username = 'alan'",
        )
        .get() as {
        is_system_admin: number;
        is_disabled: number;
        must_change_password: number;
      };
      expect(alan).toEqual({
        is_system_admin: 0,
        is_disabled: 0,
        must_change_password: 0,
      });

      const alanJobs = outDb
        .prepare("SELECT id FROM jobs WHERE user_id = 'user_alan' ORDER BY id")
        .all() as Array<{ id: string }>;
      expect(alanJobs.map((row) => row.id)).toEqual(["job_alan_1", "job_alan_wal"]);

      // onboarding-test and its private tenant are completely gone
      expect(
        outDb.prepare("SELECT 1 FROM users WHERE username = 'onboarding-test'").get(),
      ).toBeUndefined();
      expect(
        outDb.prepare("SELECT 1 FROM tenants WHERE id = 'tenant_onboarding'").get(),
      ).toBeUndefined();
      expect(outDb.prepare("SELECT 1 FROM jobs WHERE id = 'job_onb_1'").get()).toBeUndefined();

      // temp-guest is gone (including watchlist_seen_jobs without FK), but shared tenant & teammate remain
      expect(
        outDb.prepare("SELECT 1 FROM users WHERE username = 'temp-guest'").get(),
      ).toBeUndefined();
      expect(
        outDb.prepare("SELECT 1 FROM watchlist_seen_jobs WHERE id = 'wl_guest'").get(),
      ).toBeUndefined();
      expect(outDb.prepare("SELECT 1 FROM tenants WHERE id = 'tenant_shared'").get()).toBeDefined();
      expect(outDb.prepare("SELECT 1 FROM jobs WHERE id = 'job_shared_keep'").get()).toBeDefined();
      expect(
        outDb.prepare("SELECT 1 FROM jobs WHERE id = 'job_shared_drop'").get(),
      ).toBeUndefined();

      // New system admin user exists in its own tenant with valid scrypt hash
      const adminRow = outDb
        .prepare(
          `SELECT u.id, u.username, u.password_hash, u.password_salt,
                  u.is_system_admin, u.is_disabled, u.must_change_password,
                  tm.tenant_id, tm.role
           FROM users u
           INNER JOIN tenant_memberships tm ON tm.user_id = u.id
           WHERE u.username = ?`,
        )
        .get(result.adminUser.username) as {
        id: string;
        username: string;
        password_hash: string;
        password_salt: string;
        is_system_admin: number;
        is_disabled: number;
        must_change_password: number;
        tenant_id: string;
        role: string;
      };

      expect(adminRow.id).toBe(result.adminUser.id);
      expect(adminRow.is_system_admin).toBe(1);
      expect(adminRow.is_disabled).toBe(0);
      expect(adminRow.must_change_password).toBe(1);
      expect(adminRow.tenant_id).toBe(result.adminUser.tenantId);
      expect(adminRow.tenant_id).not.toBe("tenant_default");
      expect(adminRow.role).toBe("owner");

      const passwordValid = await verifyPassword({
        password: result.adminUser.oneTimePassword,
        passwordHash: adminRow.password_hash,
        passwordSalt: adminRow.password_salt,
      });
      expect(passwordValid).toBe(true);
    } finally {
      outDb.close();
    }

    // 5. Summary output contains credentials, row counts, and R2/Litestream instructions
    const summary = formatSummary(result);
    expect(summary).toContain(result.adminUser.username);
    expect(summary).toContain(result.adminUser.oneTimePassword);
    expect(summary).toContain("wrangler r2 object put");
    expect(summary).toContain(
      'litestream replicate -config ../job-ops-infra/litestream.yml -exec "true"',
    );
    expect(summary).toContain('LITESTREAM_DB_PATH="litestream/jobs.db"');
    expect(summary).toContain(`DB_PATH="${outPath}"`);
    expect(summary).toContain("jobs");
  });

  it("supports --keep-existing-admins and idempotent must_change_password column", async () => {
    const dir = await makeTempDir();
    const sourcePath = join(dir, "live.db");
    const outPath = join(dir, "out.db");

    createFixtureSourceDb(sourcePath, {
      includeMustChangePasswordColumn: true,
    });

    const result = await prepareCloudflareDb({
      sourcePath,
      outPath,
      adminPrefix: "cfadmin",
      excludeUsers: [],
      keepExistingAdmins: true,
    });

    expect(result.addedMustChangePasswordColumn).toBe(false);
    expect(result.demotedAdmins).toEqual([]);
    expect(result.keptAdmins).toEqual(["alan"]);
    expect(result.adminUser.username).toMatch(/^cfadmin-[a-z0-9]{6}$/);

    const outDb = new Database(outPath, { readonly: true });
    try {
      const admins = outDb
        .prepare("SELECT username FROM users WHERE is_system_admin = 1 ORDER BY username")
        .all() as Array<{ username: string }>;
      expect(admins.map((row) => row.username).sort()).toEqual(
        ["alan", result.adminUser.username].sort(),
      );
    } finally {
      outDb.close();
    }
  });

  it("refuses to overwrite --source in place", async () => {
    const dir = await makeTempDir();
    const sourcePath = join(dir, "live.db");
    createFixtureSourceDb(sourcePath);

    await expect(
      prepareCloudflareDb({
        sourcePath,
        outPath: sourcePath,
        adminPrefix: "admin",
        excludeUsers: [],
        keepExistingAdmins: false,
      }),
    ).rejects.toThrow(/must be different from --source/);
  });
});
