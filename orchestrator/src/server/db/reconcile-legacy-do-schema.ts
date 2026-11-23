import { type DoSqlStorageLike, PORTABLE_MIGRATIONS } from "./portable-migrations";

/** Repair legacy DO tables before the immutable baseline migration creates indexes. */
export function reconcileLegacyDoSchema(sql: DoSqlStorageLike): void {
  const columns = (table: "jobs" | "pipeline_runs") =>
    new Set(
      Array.from(sql.exec<{ name: string }>(`PRAGMA table_info("${table}")`), (row) => row.name),
    );
  const jobs = columns("jobs");
  let postingIdAdded = false;
  let postingIdsNulled = 0;

  if (jobs.size > 0) {
    if (!jobs.has("posting_id")) {
      sql.exec('ALTER TABLE "jobs" ADD COLUMN "posting_id" text');
      jobs.add("posting_id");
      postingIdAdded = true;
    }
    // Preserve every job and its child records. Keep the oldest rowid's posting
    // link within each tenant/user group, matching the baseline unique index.
    sql.exec(`UPDATE "jobs" SET "posting_id" = NULL
      WHERE "posting_id" IS NOT NULL AND rowid NOT IN (
        SELECT min(rowid) FROM "jobs" WHERE "posting_id" IS NOT NULL
        GROUP BY "tenant_id", coalesce("user_id", ''), "posting_id"
      )`);
    postingIdsNulled =
      Array.from(sql.exec<{ count: number }>("SELECT changes() AS count"))[0]?.count ?? 0;
  }

  const runs = columns("pipeline_runs");
  const pipelineRunColumnsAdded: string[] = [];
  if (runs.size > 0) {
    for (const column of ["tasks_total", "tasks_done", "tasks_failed", "tasks_cached"]) {
      if (!runs.has(column)) {
        sql.exec(`ALTER TABLE "pipeline_runs" ADD COLUMN "${column}" integer NOT NULL DEFAULT 0`);
        pipelineRunColumnsAdded.push(column);
      }
    }
  }

  // Read column declarations from 0001 without changing its recorded checksum.
  const jobsDefinition = PORTABLE_MIGRATIONS[0]?.statements.find((statement) =>
    statement.startsWith('CREATE TABLE IF NOT EXISTS "jobs" ('),
  );
  const missingJobsColumns =
    jobs.size > 0
      ? Array.from(jobsDefinition?.matchAll(/^  "([^"]+)" /gm) ?? [], (match) => match[1]).filter(
          (column) => !jobs.has(column),
        )
      : [];

  // Constructor diagnostics contain schema names and counts only, never job data.
  console.log(
    JSON.stringify({
      message: "Reconciled legacy DO schema",
      postingIdAdded,
      postingIdsNulled,
      pipelineRunColumnsAdded,
      missingJobsColumns,
    }),
  );
}
