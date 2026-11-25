import { conflict, notFound } from "@infra/errors";
import type { JobResumeState, ResumeV5Document, ResumeListItem } from "@shared/types";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getPrivateDataScope, privateDataScopeFilter } from "../tenancy/private-scope";

const { jobResumes: table, jobs } = schema;
export async function getJobResume(jobId: string): Promise<JobResumeState | null> {
  const row = db
    .select()
    .from(table)
    .where(and(privateDataScopeFilter(table), eq(table.jobId, jobId)))
    .get();
  return row
    ? {
        document: row.document,
        revision: row.revision,
        exists: true,
        updatedAt: row.updatedAt,
      }
    : null;
}
export async function saveJobResume(
  jobId: string,
  baseRevision: number,
  document: ResumeV5Document,
): Promise<JobResumeState> {
  return db.transaction((tx) => {
    const job = tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(privateDataScopeFilter(jobs), eq(jobs.id, jobId)))
      .get();
    if (!job) throw notFound("Job not found");
    const now = new Date().toISOString();
    const scope = getPrivateDataScope();
    const row =
      baseRevision === 0
        ? tx
            .insert(table)
            .values({
              ...scope,
              jobId,
              document,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning()
            .get()
        : tx
            .update(table)
            .set({ document, revision: baseRevision + 1, updatedAt: now })
            .where(
              and(
                privateDataScopeFilter(table),
                eq(table.jobId, jobId),
                eq(table.revision, baseRevision),
              ),
            )
            .returning()
            .get();
    if (!row) throw conflict("Resume changed. Reload before saving.");
    return {
      document: row.document,
      revision: row.revision,
      exists: true,
      updatedAt: row.updatedAt,
    };
  });
}
export async function deleteJobResume(jobId: string): Promise<void> {
  db.delete(table)
    .where(and(privateDataScopeFilter(table), eq(table.jobId, jobId)))
    .run();
}
export async function listResumes(): Promise<ResumeListItem[]> {
  const updated = sql<string>`coalesce(${table.updatedAt}, ${jobs.updatedAt})`;
  return db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      employer: jobs.employer,
      stage: sql<
        string | null
      >`(select to_stage from stage_events where application_id = ${jobs.id} and tenant_id = ${jobs.tenantId} and user_id is ${jobs.userId} order by occurred_at desc, id desc limit 1)`,
      updatedAt: updated,
      pdfPath: jobs.pdfPath,
      status: jobs.status,
      readyAt: jobs.readyAt,
    })
    .from(jobs)
    .leftJoin(table, and(eq(table.jobId, jobs.id), privateDataScopeFilter(table)))
    .where(and(privateDataScopeFilter(jobs), or(isNotNull(table.jobId), isNotNull(jobs.readyAt))))
    .orderBy(desc(updated), desc(jobs.id))
    .all()
    .map(({ pdfPath, ...row }) => ({ ...row, hasPdf: Boolean(pdfPath) }));
}
