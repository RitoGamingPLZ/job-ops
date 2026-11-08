import { db, schema } from "@server/db/index";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "@server/tenancy/private-scope";
import { and, eq, or } from "drizzle-orm";
import type { PipelineRunRequest } from "./run-request";

// Internal server-owned snapshot of the accepted manual request. Never logged or
// included in external payloads. The regular settings API cannot write this key.
const REQUEST_KEY = "pipelineScheduleLastRunRequest";
export async function saveRunRequest(
  config: PipelineRunRequest,
): Promise<void> {
  const scope = getPrivateDataScope();
  const filter = and(
    privateDataScopeFilter(schema.settings),
    eq(schema.settings.key, REQUEST_KEY),
  );
  const [existing] = await db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(filter);
  const value = JSON.stringify(config);
  const updatedAt = new Date().toISOString();
  if (existing) {
    await db.update(schema.settings).set({ value, updatedAt }).where(filter);
  } else {
    await db.insert(schema.settings).values({
      tenantId: scope.tenantId,
      userId: scope.userId,
      key: REQUEST_KEY,
      value,
      updatedAt,
    });
  }
}
export async function loadRunRequest(): Promise<unknown | null> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(
      and(
        privateDataScopeFilter(schema.settings),
        eq(schema.settings.key, REQUEST_KEY),
      ),
    );
  return row ? JSON.parse(row.value) : null;
}

// Deliberately global discovery of opt-in owners only. All subsequent reads and
// pipeline work execute under that owner's tenant/user context.
export async function listScheduleOwners() {
  return db
    .select({
      tenantId: schema.settings.tenantId,
      userId: schema.settings.userId,
    })
    .from(schema.settings)
    .where(
      and(
        eq(schema.settings.key, "pipelineScheduleEnabled"),
        or(eq(schema.settings.value, "1"), eq(schema.settings.value, "true")),
      ),
    );
}
