import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  JOBOPS_TEST_AUTH_BYPASS: "0",
  UKVISAJOBS_EMAIL: "operator@example.com",
};

function headers(token?: string) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function login(baseUrl: string, username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).data.token as string;
}

describe("admin user access and invitations", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;
  let adminToken: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({ env: AUTH_ENV }));
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

  it("creates an invitation whose token is shown once and never listed", async () => {
    const { res, body } = await createInvitation({ label: "Sam", expiresInDays: 3 });
    expect(res.status).toBe(201);
    expect(typeof body.data.invitation.token).toBe("string");
    expect(body.data.invitation.status).toBe("pending");
    expect(body.data.invitation.permissions.emailTracking).toBe(false);

    const list = await (
      await fetch(`${baseUrl}/api/workspaces/invitations`, { headers: headers(adminToken) })
    ).json();
    expect(list.data.invitations).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(body.data.invitation.token);
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

    expect((await readSettings()).ukvisajobsEmail ?? null).toBeNull();
    expect((await readMe()).user.permissions.serverCredentials).toBe(false);
    await patchPermissions(user.id, { serverCredentials: true });
    expect((await readMe()).user.permissions.serverCredentials).toBe(true);
    expect((await readSettings()).ukvisajobsEmail ?? null).toBeNull();
    await patchPermissions(user.id, { serverCredentials: false });
    expect((await readMe()).user.permissions.serverCredentials).toBe(false);
    expect((await readSettings()).ukvisajobsEmail ?? null).toBeNull();
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
    expect(guestSettingsWithDefault.data.ukvisajobsEmail ?? null).toBeNull();
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
});
