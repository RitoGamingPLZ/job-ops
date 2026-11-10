import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("target ownership", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        JOBOPS_TEST_AUTH_BYPASS: "0",
        JOBOPS_APP_MODE: "hosted",
        JOBOPS_HOSTED_SIGNUPS_ENABLED: "true",
        JOBOPS_HOSTED_TENANT_ID: "tenant_default",
      },
    }));
  });
  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("requires authentication and isolates targeting and discovered cleanup between owners", async () => {
    async function signup(username: string) {
      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: `${username}-secret` }),
      });
      expect(res.status).toBe(201);
      return (await res.json()).data.token as string;
    }
    const alice = await signup("alice");
    const bob = await signup("bob");
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    async function create(token: string, title: string) {
      const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          skipTailoring: true,
          job: {
            title,
            employer: "Acme",
            jobDescription: "Tenant isolation role",
            jobUrl: `https://example.com/${title}`,
          },
        }),
      });
      expect(res.status).toBe(200);
      return (await res.json()).data.id as string;
    }
    const aliceJob = await create(alice, "alice");
    const bobJob = await create(bob, "bob");
    for (const method of ["POST", "DELETE"]) {
      expect(
        (await fetch(`${baseUrl}/api/jobs/${aliceJob}/target`, { method }))
          .status,
      ).toBe(401);
      expect(
        (
          await fetch(`${baseUrl}/api/jobs/${aliceJob}/target`, {
            method,
            headers: headers(bob),
          })
        ).status,
      ).toBe(404);
    }
    const target = await fetch(`${baseUrl}/api/jobs/${aliceJob}/target`, {
      method: "POST",
      headers: headers(alice),
    });
    expect(target.status).toBe(200);
    const targetBody = (await target.json()).data;
    expect(targetBody.status).toBe("processing");
    const targetedAt = targetBody.readyAt;
    expect(targetedAt).toBeTruthy();
    // The mocked background generation never finishes; emulate it ending.
    await fetch(`${baseUrl}/api/jobs/${aliceJob}`, {
      method: "PATCH",
      headers: headers(alice),
      body: JSON.stringify({ status: "discovered" }),
    });
    await fetch(`${baseUrl}/api/jobs/${aliceJob}/target`, {
      method: "DELETE",
      headers: headers(bob),
    });
    const read = await fetch(`${baseUrl}/api/jobs/${aliceJob}`, {
      headers: headers(alice),
    });
    expect((await read.json()).data.readyAt).toBe(targetedAt);
    const aliceLowScoreJob = await create(alice, "alice-low-score");
    const { db, schema } = await import("@server/db");
    const { inArray } = await import("drizzle-orm");
    await db
      .update(schema.jobs)
      .set({ suitabilityScore: 40 })
      .where(inArray(schema.jobs.id, [aliceJob, aliceLowScoreJob, bobJob]));
    const scoreCleanup = await fetch(`${baseUrl}/api/jobs/score/50`, {
      method: "DELETE",
      headers: headers(alice),
    });
    expect(scoreCleanup.status).toBe(200);
    expect((await scoreCleanup.json()).data.count).toBe(1);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${aliceJob}`, {
          headers: headers(alice),
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${baseUrl}/api/jobs/${bobJob}`, { headers: headers(bob) }))
        .status,
    ).toBe(200);
    const cleanup = await fetch(`${baseUrl}/api/jobs/status/discovered`, {
      method: "DELETE",
      headers: headers(alice),
    });
    expect((await cleanup.json()).data.count).toBe(0);
    const untarget = await fetch(`${baseUrl}/api/jobs/${aliceJob}/target`, {
      method: "DELETE",
      headers: headers(alice),
    });
    expect((await untarget.json()).data.readyAt).toBeNull();
    const cleanup2 = await fetch(`${baseUrl}/api/jobs/status/discovered`, {
      method: "DELETE",
      headers: headers(alice),
    });
    expect((await cleanup2.json()).data.count).toBe(1);
    expect(
      (await fetch(`${baseUrl}/api/jobs/${bobJob}`, { headers: headers(bob) }))
        .status,
    ).toBe(200);
  });
});
