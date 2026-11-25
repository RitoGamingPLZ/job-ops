/**
 * Destructive maintenance scoped to the active workspace.
 *
 * Every user shares one physical database, so bulk deletes must go through the
 * tenant scope filter; raw `DELETE FROM jobs` would wipe everyone's data.
 */

import { db, schema } from "../db/index";
import { privateDataScopeFilter } from "../tenancy/private-scope";

const { interviews, jobs, pipelineRuns, stageEvents, tasks } = schema;

export async function clearWorkspaceJobData(): Promise<{
  jobsDeleted: number;
  runsDeleted: number;
}> {
  await db.delete(stageEvents).where(privateDataScopeFilter(stageEvents)).run();
  await db.delete(tasks).where(privateDataScopeFilter(tasks)).run();
  await db.delete(interviews).where(privateDataScopeFilter(interviews)).run();
  const jobsResult = await db.delete(jobs).where(privateDataScopeFilter(jobs)).run();
  const runsResult = await db
    .delete(pipelineRuns)
    .where(privateDataScopeFilter(pipelineRuns))
    .run();
  return { jobsDeleted: jobsResult.changes, runsDeleted: runsResult.changes };
}
