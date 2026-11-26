/**
 * Destructive maintenance scoped to the active workspace.
 *
 * Every user shares one physical database, so bulk deletes must go through the
 * tenant scope filter; raw `DELETE FROM jobs` would wipe everyone's data.
 */

import { db, schema } from "../db/index";
import { privateDataScopeFilter } from "../tenancy/private-scope";

const { jobs, pipelineRuns, stageEvents } = schema;

export async function clearWorkspaceJobData(): Promise<{
  jobsDeleted: number;
  runsDeleted: number;
}> {
  await db.delete(stageEvents).where(privateDataScopeFilter(stageEvents)).run();
  const jobsResult = await db.delete(jobs).where(privateDataScopeFilter(jobs)).run();
  const runsResult = await db
    .delete(pipelineRuns)
    .where(privateDataScopeFilter(pipelineRuns))
    .run();
  return { jobsDeleted: jobsResult.changes, runsDeleted: runsResult.changes };
}
