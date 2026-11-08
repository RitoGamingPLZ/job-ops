// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let tempDir: string;
let storage: typeof import("./storage");
let settings: typeof import("@server/repositories/settings");
let scope: typeof import("@infra/request-context");

beforeEach(async () => {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "job-ops-scheduler-"));
  vi.stubEnv("DATA_DIR", tempDir);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("JOBOPS_APP_MODE", "hosted");
  vi.stubEnv("JOBOPS_HOSTED_TENANT_ID", "a");
  await import("@server/db/migrate");
  const { db, schema } = await import("@server/db/index");
  await db.insert(schema.tenants).values([
    { id: "a", name: "A", slug: "a" },
    { id: "b", name: "B", slug: "b" },
  ]);
  await db.insert(schema.users).values([
    { id: "alice", username: "alice", passwordHash: "unused" },
    { id: "bob", username: "bob", passwordHash: "unused" },
  ]);
  storage = await import("./storage");
  settings = await import("@server/repositories/settings");
  scope = await import("@infra/request-context");
});
afterEach(async () => {
  (await import("@server/db/index")).closeDb();
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

it("stores and replaces the exact request, isolated by tenant and hosted user", async () => {
  const request = {
    topN: 5,
    runBudget: 300,
    sources: ["indeed" as const],
    searchTerms: ["developer"],
    watchlistSelectedSourceIds: ["apple:software"],
  };
  await scope.runWithRequestContext({ tenantId: "a", userId: "alice" }, () =>
    storage.saveRunRequest(request),
  );
  expect(
    await scope.runWithRequestContext(
      { tenantId: "a", userId: "alice" },
      storage.loadRunRequest,
    ),
  ).toEqual(request);
  expect(
    await scope.runWithRequestContext(
      { tenantId: "a", userId: "bob" },
      storage.loadRunRequest,
    ),
  ).toBeNull();
  expect(
    await scope.runWithRequestContext(
      { tenantId: "b", userId: "alice" },
      storage.loadRunRequest,
    ),
  ).toBeNull();
  await scope.runWithRequestContext({ tenantId: "a", userId: "alice" }, () =>
    storage.saveRunRequest({
      ...request,
      topN: 20,
      watchlistSelectedSourceIds: [],
    }),
  );
  expect(
    await scope.runWithRequestContext(
      { tenantId: "a", userId: "alice" },
      storage.loadRunRequest,
    ),
  ).toEqual({ ...request, topN: 20, watchlistSelectedSourceIds: [] });
});

it("discovers only opted-in owners globally and reads their settings privately", async () => {
  for (const [tenantId, userId, enabled] of [
    ["a", "alice", "1"],
    ["a", "bob", "0"],
    ["b", "alice", "true"],
  ]) {
    await scope.runWithRequestContext({ tenantId, userId }, () =>
      settings.setSetting("pipelineScheduleEnabled", enabled),
    );
  }
  expect(await storage.listScheduleOwners()).toEqual(
    expect.arrayContaining([
      { tenantId: "a", userId: "alice" },
      { tenantId: "b", userId: "alice" },
    ]),
  );
  expect(await storage.listScheduleOwners()).toHaveLength(2);
});
