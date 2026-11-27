import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_ENV, login, startServer, stopServer } from "./test-utils";

function headers(token?: string) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

describe("admin user access and invitations", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;
  let adminToken: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: { ...AUTH_ENV, ADZUNA_APP_ID: "operator-adzuna-app" },
    }));
    adminToken = await login(baseUrl, "admin", "secret");
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function createInvitation(body: Record<string, unknown> = { label: "Sam" }) {
    const res = await fetch(`${baseUrl}/api/workspaces/invitations`, {
      method: "POST",
      headers: headers(adminToken),
      body: JSON.stringify(body),
    });
    return { res, body: await res.json() };
  }

  async function accept(token: string, username: string, password = "invitee-password-1") {
    return fetch(`${baseUrl}/api/auth/invitations/${token}/accept`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ username, password }),
    });
  }

  async function inviteAndJoin(username: string, permissions?: Record<string, boolean>) {
    const { body } = await createInvitation({ label: username, permissions });
    const res = await accept(body.data.invitation.token, username);
    expect(res.status).toBe(201);
    const joined = await res.json();
    return { token: joined.data.token as string, user: joined.data.user };
  }

  async function patchPermissions(userId: string, permissions: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/workspaces/users/${userId}/permissions`, {
      method: "PATCH",
      headers: headers(adminToken),
      body: JSON.stringify({ permissions }),
    });
  }

  it("creates an invitation whose link stays copyable only while it is pending", async () => {
    const { res, body } = await createInvitation({ label: "Sam", expiresInDays: 3 });
    expect(res.status).toBe(201);
    expect(typeof body.data.invitation.token).toBe("string");
    expect(body.data.invitation.status).toBe("pending");
    expect(body.data.invitation.permissions.emailTracking).toBe(false);

    const list = await (
      await fetch(`${baseUrl}/api/workspaces/invitations`, { headers: headers(adminToken) })
    ).json();
    expect(list.data.invitations).toHaveLength(1);
    expect(list.data.invitations[0].token).toBe(body.data.invitation.token);

    // Once the invitee has signed up the raw link is gone from the listing.
    expect((await accept(body.data.invitation.token, "sam")).status).toBe(201);
    const afterUse = await (
      await fetch(`${baseUrl}/api/workspaces/invitations`, { headers: headers(adminToken) })
    ).json();
    expect(afterUse.data.invitations[0].status).toBe("used");
    expect(afterUse.data.invitations[0].token).toBeNull();
    expect(JSON.stringify(afterUse)).not.toContain(body.data.invitation.token);
  });

  it("replaces a pending invitation's link and refuses used or unknown invitations", async () => {
    const { body } = await createInvitation({ label: "Sam", permissions: { pipeline: false } });
    const { id, token: oldToken } = body.data.invitation;
    const regenerate = (invitationId: string) =>
      fetch(`${baseUrl}/api/workspaces/invitations/${invitationId}/regenerate`, {
        method: "POST",
        headers: headers(adminToken),
      });

    const res = await regenerate(id);
    expect(res.status).toBe(200);
    const fresh = (await res.json()).data.invitation;
    expect(fresh.token).not.toBe(oldToken);
    expect(fresh).toMatchObject({ id, label: "Sam", status: "pending" });
    expect(fresh.expiresAt).toBe(body.data.invitation.expiresAt);

    expect((await accept(oldToken, "sam")).status).toBe(404);
    const joined = await accept(fresh.token, "sam");
    expect(joined.status).toBe(201);
    // The invitation's access carries over to the new link.
    expect((await joined.json()).data.user.permissions.pipeline).toBe(false);

    expect((await regenerate(id)).status).toBe(404);
    expect((await regenerate("does-not-exist")).status).toBe(404);
    const anonymous = await fetch(`${baseUrl}/api/workspaces/invitations/${id}/regenerate`, {
      method: "POST",
      headers: headers(),
    });
    expect(anonymous.status).toBeGreaterThanOrEqual(401);
  });

  it("previews an invitation without a session and hides invalid tokens", async () => {
    const { body } = await createInvitation({ label: "Sam" });
    const preview = await fetch(`${baseUrl}/api/auth/invitations/${body.data.invitation.token}`);
    expect(preview.status).toBe(200);
    expect((await preview.json()).data.label).toBe("Sam");

    const bogus = await fetch(`${baseUrl}/api/auth/invitations/not-a-real-token`);
    expect(bogus.status).toBe(404);
  });

  it("lets the invitee choose credentials, applies the invitation's access, and is single use", async () => {
    const { body } = await createInvitation({
      label: "Sam",
      permissions: { emailTracking: true, pipeline: false },
    });
    const token = body.data.invitation.token as string;

    const res = await accept(token, "sam");
    expect(res.status).toBe(201);
    const joined = await res.json();
    expect(joined.data.user.isSystemAdmin).toBe(false);
    expect(joined.data.user.permissions).toMatchObject({
      defaultModel: false,
      emailTracking: true,
      pipeline: false,
      serverCredentials: false,
    });

    const sessionToken = await login(baseUrl, "sam", "invitee-password-1");
    const me = await (
      await fetch(`${baseUrl}/api/auth/me`, { headers: headers(sessionToken) })
    ).json();
    expect(me.data.user.mustChangePassword).toBe(false);

    expect((await accept(token, "someone-else")).status).toBe(404);
    const list = await (
      await fetch(`${baseUrl}/api/workspaces/invitations`, { headers: headers(adminToken) })
    ).json();
    expect(list.data.invitations[0]).toMatchObject({ status: "used", usedByUsername: "sam" });
  });

  it("frees the invitation again when the chosen username is taken", async () => {
    const { body } = await createInvitation({ label: "Sam" });
    const token = body.data.invitation.token as string;

    expect((await accept(token, "admin")).status).toBe(409);
    expect((await accept(token, "sam")).status).toBe(201);
  });

  it("refuses revoked invitations and keeps invitation management admin-only", async () => {
    const { body } = await createInvitation({ label: "Sam" });
    const revoke = await fetch(`${baseUrl}/api/workspaces/invitations/${body.data.invitation.id}`, {
      method: "DELETE",
      headers: headers(adminToken),
    });
    expect(revoke.status).toBe(200);
    expect((await accept(body.data.invitation.token, "sam")).status).toBe(404);

    const { token: guestToken } = await inviteAndJoin("guest");
    for (const [method, path] of [
      ["GET", "/api/workspaces/invitations"],
      ["POST", "/api/workspaces/invitations"],
      ["DELETE", `/api/workspaces/invitations/${body.data.invitation.id}`],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: headers(guestToken),
        body: method === "POST" ? JSON.stringify({ label: "x" }) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("deletes invitations of any status from the list", async () => {
    const pending = await createInvitation({ label: "Pending" });
    await inviteAndJoin("used-one");

    const listed = async () =>
      (
        await (
          await fetch(`${baseUrl}/api/workspaces/invitations`, { headers: headers(adminToken) })
        ).json()
      ).data.invitations as Array<{ id: string; status: string }>;

    const before = await listed();
    expect(before.map((invitation) => invitation.status).sort()).toEqual(["pending", "used"]);

    for (const invitation of before) {
      const res = await fetch(`${baseUrl}/api/workspaces/invitations/${invitation.id}`, {
        method: "DELETE",
        headers: headers(adminToken),
      });
      expect(res.status).toBe(200);
    }
    expect(await listed()).toHaveLength(0);
    expect((await accept(pending.body.data.invitation.token, "late")).status).toBe(404);

    const missing = await fetch(
      `${baseUrl}/api/workspaces/invitations/${pending.body.data.invitation.id}`,
      { method: "DELETE", headers: headers(adminToken) },
    );
    expect(missing.status).toBe(404);
  });

  it("deletes a user and their workspace, and keeps that admin-only", async () => {
    const guest = await inviteAndJoin("guest");
    const other = await inviteAndJoin("other");
    const del = (userId: string, token: string) =>
      fetch(`${baseUrl}/api/workspaces/users/${userId}`, {
        method: "DELETE",
        headers: headers(token),
      });
    const listUsers = async () =>
      (
        await (
          await fetch(`${baseUrl}/api/workspaces/users`, { headers: headers(adminToken) })
        ).json()
      ).data.users as Array<{ id: string; username: string; isSystemAdmin: boolean }>;

    expect((await del(other.user.id, guest.token)).status).toBe(403);

    const admin = (await listUsers()).find((user) => user.isSystemAdmin);
    expect(admin).toBeDefined();
    expect((await del(admin?.id ?? "", adminToken)).status).toBe(400);

    expect((await del(guest.user.id, adminToken)).status).toBe(200);
    expect((await listUsers()).map((user) => user.username).sort()).toEqual(["admin", "other"]);
    expect((await del(guest.user.id, adminToken)).status).toBe(404);

    // The deleted user's session no longer works and the name can be reused.
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: headers(guest.token) });
    expect(me.status).toBe(401);
    const { body } = await createInvitation({ label: "guest again" });
    expect((await accept(body.data.invitation.token, "guest")).status).toBe(201);
  });

  it("switches the email tracking inbox on and off per user", async () => {
    const { token, user } = await inviteAndJoin("guest");
    const inbox = () => fetch(`${baseUrl}/api/post-application/inbox`, { headers: headers(token) });

    expect((await inbox()).status).toBe(403);
    expect((await patchPermissions(user.id, { emailTracking: true })).status).toBe(200);
    expect((await inbox()).status).not.toBe(403);
    expect((await patchPermissions(user.id, { emailTracking: false })).status).toBe(200);
    expect((await inbox()).status).toBe(403);
  });

  it("lets an admin block discovery runs and URL imports for one user", async () => {
    const { token, user } = await inviteAndJoin("guest");
    const run = () =>
      fetch(`${baseUrl}/api/pipeline/run`, { method: "POST", headers: headers(token), body: "{}" });
    const fetchUrl = () =>
      fetch(`${baseUrl}/api/manual-jobs/fetch`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ url: "https://93.184.216.34/job" }),
      });

    expect((await run()).status).not.toBe(403);
    expect((await fetchUrl()).status).not.toBe(403);

    expect((await patchPermissions(user.id, { pipeline: false, urlImport: false })).status).toBe(
      200,
    );
    expect((await run()).status).toBe(403);
    expect((await fetchUrl()).status).toBe(403);
  });

  it("unlocks webhook settings only for users granted webhooks", async () => {
    const { token, user } = await inviteAndJoin("guest");
    const save = () =>
      fetch(`${baseUrl}/api/settings`, {
        method: "PATCH",
        headers: headers(token),
        body: JSON.stringify({ pipelineWebhookUrl: "https://hooks.example.com/job-ops" }),
      });

    expect((await save()).status).toBe(403);
    await patchPermissions(user.id, { webhooks: true });
    expect((await save()).status).toBe(200);
  });

  it("lets an admin grant server credentials without leaking operator env into user settings", async () => {
    const { token, user } = await inviteAndJoin("guest");
    const readSettings = async () =>
      (await (await fetch(`${baseUrl}/api/settings`, { headers: headers(token) })).json()).data;
    const readMe = async () =>
      (await (await fetch(`${baseUrl}/api/auth/me`, { headers: headers(token) })).json()).data;

    expect((await readSettings()).adzunaAppId ?? null).toBeNull();
    expect((await readMe()).user.permissions.serverCredentials).toBe(false);
    await patchPermissions(user.id, { serverCredentials: true });
    expect((await readMe()).user.permissions.serverCredentials).toBe(true);
    expect((await readSettings()).adzunaAppId ?? null).toBeNull();
    await patchPermissions(user.id, { serverCredentials: false });
    expect((await readMe()).user.permissions.serverCredentials).toBe(false);
    expect((await readSettings()).adzunaAppId ?? null).toBeNull();
  });

  it("controls defaultModel permission, onboarding requirements, and BYOK gating", async () => {
    const { token, user } = await inviteAndJoin("model-guest");
    expect((await patchPermissions(user.id, { pipeline: true })).status).toBe(200);

    const statusWithoutModel = await (
      await fetch(`${baseUrl}/api/onboarding/status`, { headers: headers(token) })
    ).json();
    const modelStepWithout = statusWithoutModel.data.requirements.find(
      (req: { id: string }) => req.id === "model",
    );
    expect(modelStepWithout?.status).toBe("needs_action");

    const blockedPipeline = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({}),
    });
    expect(blockedPipeline.status).toBe(422);

    await patchPermissions(user.id, { defaultModel: true });
    const statusWithDefault = await (
      await fetch(`${baseUrl}/api/onboarding/status`, { headers: headers(token) })
    ).json();
    expect(
      statusWithDefault.data.requirements.find((req: { id: string }) => req.id === "model"),
    ).toBeUndefined();

    const guestSettingsWithDefault = await (
      await fetch(`${baseUrl}/api/settings`, { headers: headers(token) })
    ).json();
    expect(guestSettingsWithDefault.data.adzunaAppId ?? null).toBeNull();
    expect(guestSettingsWithDefault.data.llmApiKeyHint ?? null).toBeNull();

    await patchPermissions(user.id, { defaultModel: false });
    const savedOwnKey = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({
        llmProvider: "openai",
        llmApiKey: "sk-guest-secret-9999",
      }),
    });
    expect(savedOwnKey.status).toBe(200);
    const savedBody = await savedOwnKey.json();
    expect(savedBody.data.llmApiKeyHint).toBe("********");

    const pipelineWithOwnKey = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({}),
    });
    expect(pipelineWithOwnKey.status).not.toBe(422);
  });

  it("validates permission changes and refuses to edit admins or act as a guest", async () => {
    const { token, user } = await inviteAndJoin("guest");

    expect((await patchPermissions(user.id, { notAPermission: true })).status).toBe(400);

    const users = await (
      await fetch(`${baseUrl}/api/workspaces/users`, { headers: headers(adminToken) })
    ).json();
    const admin = users.data.users.find(
      (entry: { username: string }) => entry.username === "admin",
    );
    expect(admin.permissions.serverCredentials).toBe(true);
    expect((await patchPermissions(admin.id, { webhooks: false })).status).toBe(400);

    const asGuest = await fetch(`${baseUrl}/api/workspaces/users/${user.id}/permissions`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({ permissions: { serverCredentials: true } }),
    });
    expect(asGuest.status).toBe(403);
  });

  it("enables jobs, watchlist, inProgress, and resumes by default and allows admin per-user overrides on creation", async () => {
    const invited = await inviteAndJoin("default-features");
    expect(invited.user.permissions).toMatchObject({
      jobs: true,
      watchlist: true,
      inProgress: true,
      resumes: true,
      pipeline: true,
      urlImport: true,
    });

    const createdRes = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: headers(adminToken),
      body: JSON.stringify({
        username: "limited-user",
        displayName: "Limited User",
        password: "temp-password-1234",
        permissions: { watchlist: false, resumes: false },
      }),
    });
    expect(createdRes.status).toBe(201);
    const createdBody = await createdRes.json();
    expect(createdBody.data.user.permissions).toMatchObject({
      jobs: true,
      watchlist: false,
      inProgress: true,
      resumes: false,
    });

    const limitedToken = await login(baseUrl, "limited-user", "temp-password-1234");
    expect((await fetch(`${baseUrl}/api/jobs`, { headers: headers(limitedToken) })).status).toBe(
      200,
    );
    expect(
      (await fetch(`${baseUrl}/api/watchlist/sources`, { headers: headers(limitedToken) })).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/resumes`, { headers: headers(limitedToken) })).status).toBe(
      403,
    );
    // Warming the PDF renderer is a resumes feature: it must not be a way around the permission.
    const warm = (token: string) =>
      fetch(`${baseUrl}/api/design-resume/pdf-warm`, {
        method: "POST",
        headers: headers(token),
      });
    expect((await warm(limitedToken)).status).toBe(403);
    const warmed = await warm(adminToken);
    expect(warmed.status).toBe(202);
    // No remote renderer outside Cloudflare, so there is nothing to start.
    expect((await warmed.json()).data).toEqual({ warming: false });
  });

  it("enforces jobs, watchlist, inProgress, and resumes permissions per tenant without cross-tenant leakage", async () => {
    const userA = await inviteAndJoin("feature-user-a");
    const userB = await inviteAndJoin("feature-user-b");

    const createJob = async (token: string, suffix: string) => {
      const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          skipTailoring: true,
          job: {
            title: `Engineer ${suffix}`,
            employer: `Acme ${suffix}`,
            jobUrl: `https://example.com/jobs/${suffix}`,
            jobDescription: "Build reliable distributed web systems.",
          },
        }),
      });
      expect(res.status).toBe(200);
      return (await res.json()).data as { id: string };
    };

    const discoveredJob = await createJob(userA.token, "a-discovered");
    const appliedJob = await createJob(userA.token, "a-applied");
    const applyRes = await fetch(`${baseUrl}/api/jobs/${appliedJob.id}/apply`, {
      method: "POST",
      headers: headers(userA.token),
    });
    expect(applyRes.status).toBe(200);

    const userBJob = await createJob(userB.token, "b-job");

    // Disable only `jobs` for user A while keeping `inProgress: true`.
    expect((await patchPermissions(userA.user.id, { jobs: false })).status).toBe(200);

    const filteredListRes = await fetch(`${baseUrl}/api/jobs`, { headers: headers(userA.token) });
    expect(filteredListRes.status).toBe(200);
    const filteredListBody = await filteredListRes.json();
    const listedIds = filteredListBody.data.jobs.map((job: { id: string }) => job.id);
    expect(listedIds).toContain(appliedJob.id);
    expect(listedIds).not.toContain(discoveredJob.id);

    expect(
      (await fetch(`${baseUrl}/api/jobs/${appliedJob.id}`, { headers: headers(userA.token) }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${baseUrl}/api/jobs/${discoveredJob.id}`, { headers: headers(userA.token) }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${discoveredJob.id}`, {
          method: "PATCH",
          headers: headers(userA.token),
          body: JSON.stringify({ userNotes: "Blocked" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${baseUrl}/api/jobs/nonexistent-id`, { headers: headers(userA.token) })).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/api/manual-jobs/import`, {
          method: "POST",
          headers: headers(userA.token),
          body: JSON.stringify({
            skipTailoring: true,
            job: {
              title: "Blocked Import",
              employer: "Acme",
              jobUrl: "https://example.com/jobs/blocked",
              jobDescription: "Blocked",
            },
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/actions`, {
          method: "POST",
          headers: headers(userA.token),
          body: JSON.stringify({ action: "skip", jobIds: [appliedJob.id] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/pipeline/run`, {
          method: "POST",
          headers: headers(userA.token),
          body: "{}",
        })
      ).status,
    ).toBe(403);

    // Disable `inProgress` too for user A -> board/job/stage/pipeline routes become 403.
    expect((await patchPermissions(userA.user.id, { inProgress: false })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/jobs`, { headers: headers(userA.token) })).status).toBe(
      403,
    );
    expect(
      (await fetch(`${baseUrl}/api/jobs/${appliedJob.id}`, { headers: headers(userA.token) }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${appliedJob.id}/stages`, {
          method: "POST",
          headers: headers(userA.token),
          body: JSON.stringify({ toStage: "oa" }),
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/pipeline`, { headers: headers(userA.token) })).status).toBe(
      403,
    );

    // Re-enable jobs, disable watchlist and resumes for user A.
    expect(
      (await patchPermissions(userA.user.id, { jobs: true, watchlist: false, resumes: false }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${baseUrl}/api/watchlist/sources`, { headers: headers(userA.token) })).status,
    ).toBe(403);
    expect((await fetch(`${baseUrl}/api/resumes`, { headers: headers(userA.token) })).status).toBe(
      403,
    );
    expect((await fetch(`${baseUrl}/api/library`, { headers: headers(userA.token) })).status).toBe(
      403,
    );
    expect(
      (await fetch(`${baseUrl}/api/design-resume/status`, { headers: headers(userA.token) }))
        .status,
    ).toBe(403);
    expect(
      (await fetch(`${baseUrl}/api/jobs/${appliedJob.id}/pdf`, { headers: headers(userA.token) }))
        .status,
    ).toBe(403);
    expect(
      (await fetch(`${baseUrl}/pdfs/missing.pdf`, { headers: headers(userA.token) })).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${appliedJob.id}/stages`, {
          method: "POST",
          headers: headers(userA.token),
          body: JSON.stringify({ toStage: "oa" }),
        })
      ).status,
    ).toBe(403);

    // Cross-tenant isolation: user B still retains full default feature access.
    expect((await fetch(`${baseUrl}/api/jobs`, { headers: headers(userB.token) })).status).toBe(
      200,
    );
    expect(
      (await fetch(`${baseUrl}/api/watchlist/sources`, { headers: headers(userB.token) })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${userBJob.id}/stages`, {
          method: "POST",
          headers: headers(userB.token),
          body: JSON.stringify({ toStage: "applied" }),
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${baseUrl}/api/resumes`, { headers: headers(userB.token) })).status).toBe(
      200,
    );
    expect((await fetch(`${baseUrl}/api/library`, { headers: headers(userB.token) })).status).toBe(
      200,
    );

    // Re-enabling features for user A restores access.
    expect(
      (
        await patchPermissions(userA.user.id, {
          jobs: true,
          watchlist: true,
          inProgress: true,
          resumes: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${baseUrl}/api/watchlist/sources`, { headers: headers(userA.token) })).status,
    ).toBe(200);
    expect((await fetch(`${baseUrl}/api/resumes`, { headers: headers(userA.token) })).status).toBe(
      200,
    );
    expect((await fetch(`${baseUrl}/api/library`, { headers: headers(userA.token) })).status).toBe(
      200,
    );
    expect(
      (await fetch(`${baseUrl}/api/design-resume/status`, { headers: headers(userA.token) }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(`${baseUrl}/pdfs/missing.pdf`, { headers: headers(userA.token) })).status,
    ).toBe(404);
  });
});
