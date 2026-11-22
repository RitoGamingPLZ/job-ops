import { randomInt, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "../src/server/auth/password";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_DIR = resolve(SCRIPT_DIR, "..");

export const DEFAULT_SOURCE_DB_PATH = resolve(
  ORCHESTRATOR_DIR,
  "data",
  "jobs.db",
);
export const DEFAULT_OUT_DB_PATH = resolve(
  ORCHESTRATOR_DIR,
  "data",
  "cloudflare-export",
  "jobs.db",
);
export const DEFAULT_ADMIN_PREFIX = "admin";
export const ADMIN_SUFFIX_LENGTH = 6;
export const DEFAULT_PASSWORD_LENGTH = 24;

const LOWERCASE_ALPHANUMERIC = "abcdefghijklmnopqrstuvwxyz0123456789";
const PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PASSWORD_LOWER = "abcdefghijkmnopqrstuvwxyz";
const PASSWORD_DIGITS = "23456789";
const PASSWORD_SYMBOLS = "!@#$%^&*-_=+";
const PASSWORD_ALL = `${PASSWORD_UPPER}${PASSWORD_LOWER}${PASSWORD_DIGITS}${PASSWORD_SYMBOLS}`;

export interface PrepareCloudflareDbOptions {
  sourcePath: string;
  outPath: string;
  adminPrefix: string;
  excludeUsers: string[];
  keepExistingAdmins: boolean;
  help?: boolean;
}

export interface ExcludedUserSummary {
  id: string;
  username: string;
  removedTenantIds: string[];
}

export interface PrepareCloudflareDbResult {
  sourcePath: string;
  outPath: string;
  adminUser: {
    id: string;
    username: string;
    tenantId: string;
    tenantSlug: string;
    oneTimePassword: string;
    mustChangePassword: boolean;
  };
  addedMustChangePasswordColumn: boolean;
  demotedAdmins: string[];
  keptAdmins: string[];
  excludedUsers: ExcludedUserSummary[];
  notFoundExcludedUsers: string[];
  tableRowCounts: Record<string, number>;
}

interface TableInfoRow {
  name: string;
}

interface SqliteMasterRow {
  name: string;
}

interface ExistingUserRow {
  id: string;
  username: string;
  is_system_admin: number;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function slugify(value: string): string {
  return (
    normalizeUsername(value)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "admin"
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function validateAdminPrefix(prefix: string): string {
  const normalized = prefix.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(
      `Invalid --admin-prefix "${prefix}". Must start with a lowercase letter or digit and contain only [a-z0-9-].`,
    );
  }
  return normalized;
}

export function generateAdminUsername(
  prefix: string = DEFAULT_ADMIN_PREFIX,
): string {
  const validPrefix = validateAdminPrefix(prefix);
  let suffix = "";
  for (let index = 0; index < ADMIN_SUFFIX_LENGTH; index += 1) {
    suffix +=
      LOWERCASE_ALPHANUMERIC[randomInt(0, LOWERCASE_ALPHANUMERIC.length)];
  }
  return `${validPrefix}-${suffix}`;
}

export function generateOneTimePassword(
  length: number = DEFAULT_PASSWORD_LENGTH,
): string {
  if (!Number.isInteger(length) || length < 20) {
    throw new Error("One-time password length must be an integer >= 20");
  }

  const chars: string[] = [
    PASSWORD_UPPER[randomInt(0, PASSWORD_UPPER.length)],
    PASSWORD_LOWER[randomInt(0, PASSWORD_LOWER.length)],
    PASSWORD_DIGITS[randomInt(0, PASSWORD_DIGITS.length)],
    PASSWORD_SYMBOLS[randomInt(0, PASSWORD_SYMBOLS.length)],
  ];

  while (chars.length < length) {
    chars.push(PASSWORD_ALL[randomInt(0, PASSWORD_ALL.length)]);
  }

  // Fisher-Yates shuffle with cryptographically secure randomness
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    const current = chars[index];
    chars[index] = chars[swapIndex];
    chars[swapIndex] = current;
  }

  return chars.join("");
}

export function parseCliArgs(
  argv: string[],
  cwd: string = process.cwd(),
): PrepareCloudflareDbOptions {
  let sourcePath = DEFAULT_SOURCE_DB_PATH;
  let outPath = DEFAULT_OUT_DB_PATH;
  let adminPrefix = DEFAULT_ADMIN_PREFIX;
  const excludeUsers: string[] = [];
  let keepExistingAdmins = false;
  let help = false;

  const readFlagValue = (flag: string, inlineValue?: string, next?: string) => {
    const value = inlineValue !== undefined ? inlineValue : next;
    if (value === undefined || value.trim() === "") {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--keep-existing-admins") {
      keepExistingAdmins = true;
      continue;
    }

    if (arg === "--source" || arg.startsWith("--source=")) {
      const inline = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : undefined;
      const value = readFlagValue("--source", inline, argv[index + 1]);
      if (inline === undefined) index += 1;
      sourcePath = resolve(cwd, value);
      continue;
    }

    if (arg === "--out" || arg.startsWith("--out=")) {
      const inline = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : undefined;
      const value = readFlagValue("--out", inline, argv[index + 1]);
      if (inline === undefined) index += 1;
      outPath = resolve(cwd, value);
      continue;
    }

    if (arg === "--admin-prefix" || arg.startsWith("--admin-prefix=")) {
      const inline = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : undefined;
      const value = readFlagValue("--admin-prefix", inline, argv[index + 1]);
      if (inline === undefined) index += 1;
      adminPrefix = validateAdminPrefix(value);
      continue;
    }

    if (arg === "--exclude-user" || arg.startsWith("--exclude-user=")) {
      const inline = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : undefined;
      const value = readFlagValue("--exclude-user", inline, argv[index + 1]);
      if (inline === undefined) index += 1;
      const normalized = normalizeUsername(value);
      if (normalized && !excludeUsers.includes(normalized)) {
        excludeUsers.push(normalized);
      }
      continue;
    }

    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  return {
    sourcePath,
    outPath,
    adminPrefix,
    excludeUsers,
    keepExistingAdmins,
    help,
  };
}

export function formatUsage(): string {
  return [
    "Usage: tsx orchestrator/scripts/prepare-cloudflare-db.ts [options]",
    "",
    "Creates a clean SQLite snapshot for Cloudflare R2 / Litestream deployment,",
    "ensures the must_change_password column exists, optionally strips excluded",
    "test users and demotes existing admins, and bootstraps a new system admin",
    "with a one-time password.",
    "",
    "Options:",
    `  --source <path>           Source SQLite DB (default: ${DEFAULT_SOURCE_DB_PATH})`,
    `  --out <path>              Output SQLite DB (default: ${DEFAULT_OUT_DB_PATH})`,
    `  --admin-prefix <prefix>   Prefix for generated admin username (default: ${DEFAULT_ADMIN_PREFIX})`,
    "  --exclude-user <username> Strip user & private tenant data (repeatable)",
    "  --keep-existing-admins    Keep existing is_system_admin=1 users (default: false)",
    "  -h, --help                Show this help message",
  ].join("\n");
}

function getUserTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as SqliteMasterRow[];
  return rows.map((row) => row.name);
}

function getTableColumns(
  db: Database.Database,
  tableName: string,
): Set<string> {
  const rows = db
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all() as TableInfoRow[];
  return new Set(rows.map((row) => row.name));
}

function ensureMustChangePasswordColumn(db: Database.Database): boolean {
  const columns = getTableColumns(db, "users");
  if (columns.has("must_change_password")) {
    return false;
  }
  db.exec(
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
  );
  return true;
}

function stripExcludedUsers(
  db: Database.Database,
  excludeUsernames: string[],
  tables: string[],
): {
  excludedUsers: ExcludedUserSummary[];
  notFoundExcludedUsers: string[];
} {
  if (excludeUsernames.length === 0) {
    return { excludedUsers: [], notFoundExcludedUsers: [] };
  }

  const normalizedTargets = Array.from(
    new Set(excludeUsernames.map(normalizeUsername).filter(Boolean)),
  );

  const findUserStmt = db.prepare(
    "SELECT id, username, is_system_admin FROM users WHERE lower(username) = ?",
  );
  const foundUsers: ExistingUserRow[] = [];
  const notFoundExcludedUsers: string[] = [];

  for (const username of normalizedTargets) {
    const row = findUserStmt.get(username) as ExistingUserRow | undefined;
    if (!row) {
      notFoundExcludedUsers.push(username);
    } else {
      foundUsers.push(row);
    }
  }

  if (foundUsers.length === 0) {
    return { excludedUsers: [], notFoundExcludedUsers };
  }

  const excludedUserIdSet = new Set(foundUsers.map((user) => user.id));
  const tableColumnMap = new Map<string, Set<string>>(
    tables.map((table) => [table, getTableColumns(db, table)]),
  );

  const membershipsForUserStmt = db.prepare(
    "SELECT tenant_id FROM tenant_memberships WHERE user_id = ?",
  );
  const membersInTenantStmt = db.prepare(
    "SELECT user_id FROM tenant_memberships WHERE tenant_id = ?",
  );

  const excludedUsers: ExcludedUserSummary[] = [];

  for (const user of foundUsers) {
    const tenantRows = membershipsForUserStmt.all(user.id) as Array<{
      tenant_id: string;
    }>;
    const privateTenantIds: string[] = [];

    for (const { tenant_id: tenantId } of tenantRows) {
      if (tenantId === "tenant_default") {
        continue;
      }
      const members = membersInTenantStmt.all(tenantId) as Array<{
        user_id: string;
      }>;
      const hasKeptMember = members.some(
        (member) => !excludedUserIdSet.has(member.user_id),
      );
      if (!hasKeptMember) {
        privateTenantIds.push(tenantId);
      }
    }

    // Explicitly purge user_id rows across all tables (covers tables without FK
    // cascades on user_id such as watchlist_* and pipeline_search_presets).
    for (const table of tables) {
      if (table === "users" || table === "tenants") continue;
      const cols = tableColumnMap.get(table);
      if (cols?.has("user_id")) {
        db.prepare(
          `DELETE FROM ${quoteIdentifier(table)} WHERE user_id = ?`,
        ).run(user.id);
      }
    }

    // Purge private tenants and any remaining tenant-scoped rows.
    for (const tenantId of privateTenantIds) {
      for (const table of tables) {
        if (table === "users" || table === "tenants") continue;
        const cols = tableColumnMap.get(table);
        if (cols?.has("tenant_id")) {
          db.prepare(
            `DELETE FROM ${quoteIdentifier(table)} WHERE tenant_id = ?`,
          ).run(tenantId);
        }
      }
      db.prepare("DELETE FROM tenants WHERE id = ?").run(tenantId);
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);

    excludedUsers.push({
      id: user.id,
      username: user.username,
      removedTenantIds: privateTenantIds,
    });
  }

  return { excludedUsers, notFoundExcludedUsers };
}

function pickUniqueAdminUsername(
  db: Database.Database,
  prefix: string,
): string {
  const existsStmt = db.prepare(
    "SELECT 1 FROM users WHERE lower(username) = ?",
  );
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = generateAdminUsername(prefix);
    if (!existsStmt.get(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Failed to generate a unique admin username with prefix "${prefix}" after 25 attempts`,
  );
}

function collectTableRowCounts(
  db: Database.Database,
  tables: string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = db
      .prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(table)}`)
      .get() as { count: number };
    counts[table] = row.count;
  }
  return counts;
}

export async function prepareCloudflareDb(
  options: PrepareCloudflareDbOptions,
): Promise<PrepareCloudflareDbResult> {
  const sourcePath = resolve(options.sourcePath);
  const outPath = resolve(options.outPath);
  const adminPrefix = validateAdminPrefix(options.adminPrefix);

  if (sourcePath === outPath) {
    throw new Error(
      `--out path (${outPath}) must be different from --source path (${sourcePath}) so the live database is never modified.`,
    );
  }

  await mkdir(dirname(outPath), { recursive: true });
  await Promise.all([
    rm(outPath, { force: true }),
    rm(`${outPath}-wal`, { force: true }),
    rm(`${outPath}-shm`, { force: true }),
  ]);

  // Snapshot live DB (including any uncheckpointed WAL frames) without
  // mutating the source file.
  const sourceDb = new Database(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    await sourceDb.backup(outPath);
  } finally {
    sourceDb.close();
  }

  const oneTimePassword = generateOneTimePassword(DEFAULT_PASSWORD_LENGTH);
  const { passwordHash, passwordSalt } = await hashPassword(oneTimePassword);

  const outDb = new Database(outPath);
  try {
    outDb.pragma("foreign_keys = ON");

    const tables = getUserTables(outDb);
    if (!tables.includes("users") || !tables.includes("tenants")) {
      throw new Error(
        `Source database at ${sourcePath} is missing required auth tables (users, tenants).`,
      );
    }

    const addedMustChangePasswordColumn = ensureMustChangePasswordColumn(outDb);
    const now = new Date().toISOString();

    const txResult = outDb.transaction(() => {
      const { excludedUsers, notFoundExcludedUsers } = stripExcludedUsers(
        outDb,
        options.excludeUsers,
        tables,
      );

      const existingAdmins = outDb
        .prepare(
          "SELECT id, username, is_system_admin FROM users WHERE is_system_admin = 1 ORDER BY username",
        )
        .all() as ExistingUserRow[];

      const demotedAdmins: string[] = [];
      const keptAdmins: string[] = [];

      if (options.keepExistingAdmins) {
        for (const admin of existingAdmins) {
          keptAdmins.push(admin.username);
        }
      } else if (existingAdmins.length > 0) {
        outDb
          .prepare(
            "UPDATE users SET is_system_admin = 0, updated_at = ? WHERE is_system_admin = 1",
          )
          .run(now);
        for (const admin of existingAdmins) {
          demotedAdmins.push(admin.username);
        }
      }

      const adminUsername = pickUniqueAdminUsername(outDb, adminPrefix);
      const adminUserId = randomUUID();
      const adminTenantId = randomUUID();
      const adminTenantSlug = `${slugify(adminUsername)}-${adminTenantId.slice(0, 8)}`;

      outDb
        .prepare(
          "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          adminTenantId,
          `System Admin (${adminUsername})`,
          adminTenantSlug,
          now,
          now,
        );

      outDb
        .prepare(
          `INSERT INTO users (
            id,
            username,
            display_name,
            password_hash,
            password_salt,
            is_system_admin,
            is_disabled,
            must_change_password,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, 0, 1, ?, ?)`,
        )
        .run(
          adminUserId,
          adminUsername,
          "System Admin",
          passwordHash,
          passwordSalt,
          now,
          now,
        );

      outDb
        .prepare(
          `INSERT INTO tenant_memberships (
            id,
            user_id,
            tenant_id,
            role,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 'owner', ?, ?)`,
        )
        .run(randomUUID(), adminUserId, adminTenantId, now, now);

      return {
        excludedUsers,
        notFoundExcludedUsers,
        demotedAdmins,
        keptAdmins,
        adminUser: {
          id: adminUserId,
          username: adminUsername,
          tenantId: adminTenantId,
          tenantSlug: adminTenantSlug,
          oneTimePassword,
          mustChangePassword: true,
        },
      };
    })();

    const tableRowCounts = collectTableRowCounts(outDb, tables);

    // Checkpoint and switch exported copy to DELETE journal mode so the
    // resulting jobs.db is a single self-contained file with no -wal/-shm.
    outDb.pragma("wal_checkpoint(TRUNCATE)");
    outDb.pragma("journal_mode = DELETE");

    return {
      sourcePath,
      outPath,
      adminUser: txResult.adminUser,
      addedMustChangePasswordColumn,
      demotedAdmins: txResult.demotedAdmins,
      keptAdmins: txResult.keptAdmins,
      excludedUsers: txResult.excludedUsers,
      notFoundExcludedUsers: txResult.notFoundExcludedUsers,
      tableRowCounts,
    };
  } finally {
    outDb.close();
  }
}

export function formatSummary(result: PrepareCloudflareDbResult): string {
  const lines: string[] = [
    "=== Cloudflare DB Export Complete ===",
    `Source DB (untouched): ${result.sourcePath}`,
    `Exported DB:           ${result.outPath}`,
    `Schema migration:      ${
      result.addedMustChangePasswordColumn
        ? "added users.must_change_password column"
        : "users.must_change_password already present"
    }`,
    "",
    "--- Generated System Admin (NOT written to disk; copy now) ---",
    `Username:              ${result.adminUser.username}`,
    `One-time password:     ${result.adminUser.oneTimePassword}`,
    `Workspace / Tenant ID: ${result.adminUser.tenantId} (${result.adminUser.tenantSlug})`,
    "Flags:                 is_system_admin=1, is_disabled=0, must_change_password=1",
    "",
    "--- Existing Accounts ---",
    `Demoted admins:        ${
      result.demotedAdmins.length > 0 ? result.demotedAdmins.join(", ") : "none"
    }`,
    `Kept existing admins:  ${
      result.keptAdmins.length > 0 ? result.keptAdmins.join(", ") : "none"
    }`,
    `Excluded users:        ${
      result.excludedUsers.length > 0
        ? result.excludedUsers
            .map(
              (entry) =>
                `${entry.username} (removed ${entry.removedTenantIds.length} private tenant${entry.removedTenantIds.length === 1 ? "" : "s"})`,
            )
            .join(", ")
        : "none"
    }`,
  ];

  if (result.notFoundExcludedUsers.length > 0) {
    lines.push(
      `Exclude not found:     ${result.notFoundExcludedUsers.join(", ")}`,
    );
  }

  lines.push("", "--- Preserved Table Row Counts ---");
  const keyTables = new Set([
    "users",
    "tenants",
    "tenant_memberships",
    "jobs",
    "job_resumes",
    "design_resume_documents",
    "settings",
  ]);
  const sortedTables = Object.entries(result.tableRowCounts).filter(
    ([table, count]) => count > 0 || keyTables.has(table),
  );
  const maxNameLen = Math.max(
    ...sortedTables.map(([table]) => table.length),
    10,
  );
  for (const [table, count] of sortedTables) {
    lines.push(`  ${table.padEnd(maxNameLen)}  ${count}`);
  }

  lines.push(
    "",
    "--- Next Steps: Seed Cloudflare R2 / Litestream ---",
    "1. Option A — Seed Litestream replica in R2 (recommended; matches ../job-ops-infra/litestream.yml):",
    `   DB_PATH="${result.outPath}" \\`,
    '     R2_ACCOUNT_ID="<CLOUDFLARE_ACCOUNT_ID>" \\',
    '     R2_BUCKET_NAME="job-ops-data" \\',
    '     LITESTREAM_DB_PATH="litestream/jobs.db" \\',
    '     LITESTREAM_ACCESS_KEY_ID="<key>" \\',
    '     LITESTREAM_SECRET_ACCESS_KEY="<secret>" \\',
    '     litestream replicate -config ../job-ops-infra/litestream.yml -exec "true"',
    "",
    "2. Option B — Upload raw SQLite snapshot backup object to R2 via Wrangler:",
    `   npx wrangler r2 object put job-ops-data/backups/jobs.db --file "${result.outPath}" --remote`,
    "",
    "3. Sign in with the generated admin credentials above; you will be prompted",
    "   to set a permanent password on first login.",
    "4. Delete the local exported DB once uploaded; never commit it to git.",
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatUsage());
    return;
  }

  const result = await prepareCloudflareDb(options);
  console.log(formatSummary(result));
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
