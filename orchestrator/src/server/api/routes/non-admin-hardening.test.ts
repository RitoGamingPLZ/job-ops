import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  JOBOPS_TEST_AUTH_BYPASS: "0",
};

async function login(baseUrl: string, username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.status).toBe(200);
  return body.data.token as string;
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function importJob(baseUrl: string, token: string, title: string) {
  const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      skipTailoring: true,
      job: {
        title,
        employer: "Acme",
        jobUrl: `https://example.com/${title}`,
        jobDescription: "Hardening role",
      },
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).data as { id: string };
}

describe("non-admin hardening", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;
  let adminToken: string;
  let guestToken: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: {
        ...AUTH_ENV,
        ADZUNA_APP_ID: "operator-adzuna-app",
        WEBHOOK_SECRET: "operator-webhook-secret",
      },
    }));
    adminToken = await login(baseUrl, "admin", "secret");

    const created = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: headers(adminToken),
      body: JSON.stringify({ username: "guest", password: "guest-password-1" }),
    });
    expect(created.status).toBe(201);
    guestToken = await login(baseUrl, "guest", "guest-password-1");
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("does not expose operator integration values or the operator LLM defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, { headers: headers(guestToken) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.adzunaAppId ?? null).toBeNull();
    expect(body.data.webhookSecretHint ?? null).toBeNull();
    expect(body.data.llmProvider.default).toBe("gemini");

    const adminRes = await fetch(`${baseUrl}/api/settings`, { headers: headers(adminToken) });
    const adminBody = await adminRes.json();
    expect(adminBody.data.adzunaAppId).toBe("operator-adzuna-app");
  });

  it("lets a guest save their own Gemini key and model, scoped to their workspace", async () => {
    const save = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: headers(guestToken),
      body: JSON.stringify({
        llmProvider: "gemini",
        llmApiKey: "guest-gemini-key",
        model: "google/gemini-3.1-flash-lite",
      }),
    });
    expect(save.status).toBe(200);

    const guest = await (
      await fetch(`${baseUrl}/api/settings`, { headers: headers(guestToken) })
    ).json();
    expect(guest.data.llmProvider.value).toBe("gemini");
    expect(guest.data.llmApiKeyHint).toBeTruthy();

    const admin = await (
      await fetch(`${baseUrl}/api/settings`, { headers: headers(adminToken) })
    ).json();
    expect(admin.data.llmProvider.value).not.toBe("gemini");
    expect(admin.data.llmApiKeyHint ?? null).not.toBe(guest.data.llmApiKeyHint);
  });

  it("rejects CLI providers and webhook destinations for guests", async () => {
    const cli = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: headers(guestToken),
      body: JSON.stringify({ llmProvider: "gemini_cli" }),
    });
    expect(cli.status).toBe(403);

    const hook = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: headers(guestToken),
      body: JSON.stringify({ pipelineWebhookUrl: "https://attacker.example/hook" }),
    });
    expect(hook.status).toBe(403);
  });

  it("keeps server-wide controls admin-only", async () => {
    for (const [method, path] of [
      ["POST", "/api/pipeline/challenge-viewer"],
      ["POST", "/api/pipeline/solve-challenge"],
      ["GET", "/api/settings/codex-auth"],
      ["DELETE", "/api/database"],
      ["DELETE", "/api/jobs/status/discovered"],
      ["DELETE", "/api/jobs/score/50"],
      ["GET", "/api/backups"],
      ["POST", "/api/backups"],
      ["GET", "/api/backups/jobs_2026_01_01.json.gz/download"],
      ["DELETE", "/api/backups/jobs_2026_01_01.json.gz"],
      ["GET", "/api/post-application/inbox"],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: headers(guestToken),
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }

    for (const payload of [{ llmProvider: "litellm" }, { adzunaAppId: "guest-adzuna" }]) {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: "PATCH",
        headers: headers(guestToken),
        body: JSON.stringify(payload),
      });
      expect(res.status, JSON.stringify(payload)).toBe(403);
    }
  });

  it("clears only the caller's workspace when an admin clears jobs", async () => {
    const adminJob = await importJob(baseUrl, adminToken, "admin-role");
    const guestJob = await importJob(baseUrl, guestToken, "guest-role");

    const cleared = await fetch(`${baseUrl}/api/database`, {
      method: "DELETE",
      headers: headers(adminToken),
    });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).data.jobsDeleted).toBe(1);

    const gone = await fetch(`${baseUrl}/api/jobs/${adminJob.id}`, {
      headers: headers(adminToken),
    });
    expect(gone.status).toBe(404);
    const kept = await fetch(`${baseUrl}/api/jobs/${guestJob.id}`, {
      headers: headers(guestToken),
    });
    expect(kept.status).toBe(200);
  });

  it("refuses to fetch private or metadata addresses", async () => {
    for (const url of [
      "http://127.0.0.1:3001/api/settings",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost/",
    ]) {
      const res = await fetch(`${baseUrl}/api/manual-jobs/fetch`, {
        method: "POST",
        headers: headers(guestToken),
        body: JSON.stringify({ url }),
      });
      expect(res.status, url).toBe(422);
    }
  });

  it("serves stored PDFs only to signed-in owners of that workspace folder", async () => {
    const anonymous = await fetch(`${baseUrl}/pdfs/tenant_default/design_resume_current.pdf`);
    expect(anonymous.status).toBe(401);

    const guestForAdminFolder = await fetch(
      `${baseUrl}/pdfs/tenant_default/design_resume_current.pdf`,
      { headers: headers(guestToken) },
    );
    expect(guestForAdminFolder.status).not.toBe(200);
  });

  it("sets baseline security headers and does not echo foreign CORS origins", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
