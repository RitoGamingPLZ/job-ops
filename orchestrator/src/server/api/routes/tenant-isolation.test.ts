import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ENV, login, startServer, stopServer } from "./test-utils";

async function signup(baseUrl: string, username: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.status).toBe(201);
  return body.data.token as string;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function importManualJob(baseUrl: string, token: string, title: string) {
  const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      job: {
        title,
        employer: "Acme",
        jobUrl: "https://example.com/shared-job",
        jobDescription: "Tenant isolation role",
      },
    }),
  });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.data.status).toBe("processing");
  // The mocked background generation never finishes; emulate it ending.
  const settled = await fetch(`${baseUrl}/api/jobs/${body.data.id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ status: "discovered" }),
  });
  expect(settled.status).toBe(200);
  return body.data as { id: string; title: string };
}

async function assertScoringSettingsIsolation(
  ownerToken: string,
  otherToken: string,
  hosted: boolean,
) {
  const { runWithRequestContext } = await import("@infra/request-context");
  const settingsRepo = await import("@server/repositories/settings");
  const { getEffectiveSettings } = await import("@server/services/settings");
  const { resolveLlmRuntimeSettings } = await import("@server/services/modelSelection");
  const claims = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as {
      tenantId: string;
      userId: string;
    };
  const owner = claims(ownerToken);
  const other = claims(otherToken);
  if (hosted) {
    expect(owner.tenantId).toBe(other.tenantId);
    expect(owner.userId).not.toBe(other.userId);
  } else {
    expect(owner.tenantId).not.toBe(other.tenantId);
  }
  const envBefore = { ...process.env };
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected HTTP during settings resolution"));
  try {
    // These writes and all reads use the real repository and temporary database.
    for (const [scope, key, provider, model] of [
      [owner, "synthetic-owner-key", "openai", ""],
      [other, "synthetic-other-key", "openrouter", "other-scoring-model"],
    ] as const) {
      await runWithRequestContext(scope, async () => {
        await settingsRepo.setSetting("llmProvider", "openrouter");
        await settingsRepo.setSetting("model", "google/gemini-3-flash-preview");
        await settingsRepo.setSetting("llmApiKey", `${key}-global`);
        await settingsRepo.setSetting("llmPurposeApiKeys", JSON.stringify({ scoring: key }));
        await settingsRepo.setSetting(
          "llmPurposeOverrides",
          JSON.stringify({ scoring: { provider, model } }),
        );
      });
    }
    const read = (scope: typeof owner) =>
      runWithRequestContext(scope, async () => {
        const saved = await getEffectiveSettings();
        const runtime = await resolveLlmRuntimeSettings("scoring");
        expect(runtime.model).toBe(saved.modelScorer.value);
        return runtime;
      });
    const [ownerRuntime, otherRuntime] = await Promise.all([read(owner), read(other)]);
    expect(ownerRuntime).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      apiKey: "synthetic-owner-key",
    });
    expect(otherRuntime).toMatchObject({
      provider: "openrouter",
      model: "other-scoring-model",
      apiKey: "synthetic-other-key",
    });
    // Removing one scope's purpose key inherits only that scope's global key.
    await runWithRequestContext(owner, () => settingsRepo.setSetting("llmPurposeApiKeys", null));
    expect((await read(owner)).apiKey).toBe("synthetic-owner-key-global");
    expect((await read(other)).apiKey).toBe("synthetic-other-key");
    if (hosted) {
      await runWithRequestContext(owner, () => settingsRepo.setSetting("llmApiKey", null));
      expect(await read(owner)).toMatchObject({
        apiKey: null,
        allowEnvironmentCredentials: false,
        allowCliProviders: false,
      });
      expect((await read(other)).apiKey).toBe("synthetic-other-key");
    }
    expect(process.env).toEqual(envBefore);
    expect(http).not.toHaveBeenCalled();
  } finally {
    http.mockRestore();
  }
}

async function assertCoworkIsolation(baseUrl: string, ownerToken: string, otherToken: string) {
  const job = await importManualJob(baseUrl, ownerToken, "Private co-work role");
  const { buildDefaultResumeDocument } = await import("@server/services/resume-document/document");
  const document = buildDefaultResumeDocument();
  const call = (path: string, token: string, method = "GET", body?: unknown) =>
    fetch(`${baseUrl}/api${path}`, {
      method,
      headers: authHeaders(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const created = await call("/experience-bullets", ownerToken, "POST", {
    text: "Private duty",
  });
  expect(created.status).toBe(201);
  const bullet = (await created.json()).data.bullet;
  const { runWithRequestContext } = await import("@infra/request-context");
  const { buildCandidateExperienceContext } = await import("@server/services/candidate-experience");
  const candidateContext = (token: string) => {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as {
      tenantId: string;
      userId: string;
    };
    return runWithRequestContext(
      { tenantId: claims.tenantId, userId: claims.userId },
      buildCandidateExperienceContext,
    );
  };
  expect(await candidateContext(ownerToken)).toContain("Private duty");
  expect(await candidateContext(otherToken)).toBeNull();

  expect((await (await call("/experience-bullets", otherToken)).json()).data.bullets).toEqual([]);
  expect(
    (
      await call(`/experience-bullets/${bullet.id}`, otherToken, "PATCH", {
        text: "stolen",
      })
    ).status,
  ).toBe(404);
  expect((await call(`/experience-bullets/${bullet.id}`, otherToken, "DELETE")).status).toBe(404);
  const saved = await call(`/jobs/${job.id}/resume`, ownerToken, "PUT", {
    baseRevision: 0,
    document,
  });
  expect(saved.status).toBe(200);
  expect(
    (
      await call(`/jobs/${job.id}/resume/screening`, otherToken, "POST", {
        document,
      })
    ).status,
  ).toBe(404);
  for (const method of ["GET", "PUT", "DELETE"]) {
    expect(
      (
        await call(
          `/jobs/${job.id}/resume`,
          otherToken,
          method,
          method === "PUT" ? { baseRevision: 1, document } : undefined,
        )
      ).status,
    ).toBe(404);
  }
  expect((await (await call("/resumes", otherToken)).json()).data.resumes).toEqual([]);
  expect((await (await call("/resumes", ownerToken)).json()).data.resumes).toEqual([
    expect.objectContaining({ jobId: job.id }),
  ]);
  expect((await (await call(`/jobs/${job.id}/resume`, ownerToken)).json()).data.revision).toBe(1);
  expect((await (await call("/experience-bullets", ownerToken)).json()).data.bullets).toEqual([
    expect.objectContaining({ id: bullet.id, text: "Private duty" }),
  ]);
}

describe("Tenant isolation", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("isolates saved scoring settings and runtime credentials between private workspaces", async () => {
    const owner = await login(baseUrl, "admin", "secret");
    const created = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(created.status).toBe(201);
    await assertScoringSettingsIsolation(owner, await login(baseUrl, "adam", "adam-secret"), false);
  });

  it("isolates experience bullets and job resumes between private workspaces", async () => {
    const adminToken = await login(baseUrl, "admin", "secret");
    const created = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(created.status).toBe(201);
    await assertCoworkIsolation(baseUrl, adminToken, await login(baseUrl, "adam", "adam-secret"));
  });

  it("isolates jobs and PDFs between private workspaces", async () => {
    const { scoreJobSuitability } = await import("@server/services/scorer");
    vi.mocked(scoreJobSuitability).mockResolvedValue({
      score: 80,
      reason: "Good fit",
      jobBrief: null,
    });

    const adminToken = await login(baseUrl, "admin", "secret");

    const createAdamRes = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(createAdamRes.status).toBe(201);

    const adamToken = await login(baseUrl, "adam", "adam-secret");
    const adminJob = await importManualJob(baseUrl, adminToken, "Admin Role");
    const adamJob = await importManualJob(baseUrl, adamToken, "Adam Role");

    const adminList = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((res) => res.json());
    expect(adminList.data.jobs.map((job: { id: string }) => job.id)).toEqual([adminJob.id]);

    const adamList = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${adamToken}` },
    }).then((res) => res.json());
    expect(adamList.data.jobs.map((job: { id: string }) => job.id)).toEqual([adamJob.id]);

    const crossTenantJob = await fetch(`${baseUrl}/api/jobs/${adminJob.id}`, {
      headers: { Authorization: `Bearer ${adamToken}` },
    });
    expect(crossTenantJob.status).toBe(404);

    const pdfBytes = Buffer.from("%PDF-1.4\n%EOF\n").toString("base64");
    const uploadPdfRes = await fetch(`${baseUrl}/api/jobs/${adminJob.id}/pdf`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        fileName: "resume.pdf",
        mediaType: "application/pdf",
        dataBase64: pdfBytes,
      }),
    });
    expect(uploadPdfRes.status).toBe(201);

    const adminPdf = await fetch(`${baseUrl}/api/jobs/${adminJob.id}/pdf`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminPdf.status).toBe(200);

    const adamPdf = await fetch(`${baseUrl}/api/jobs/${adminJob.id}/pdf`, {
      headers: { Authorization: `Bearer ${adamToken}` },
    });
    expect(adamPdf.status).toBe(404);

    const adamDeletesAdminJob = await fetch(`${baseUrl}/api/jobs/${adminJob.id}`, {
      method: "DELETE",
      headers: authHeaders(adamToken),
    });
    expect(adamDeletesAdminJob.status).toBe(404);
    expect((await adamDeletesAdminJob.json()).error.code).toBe("NOT_FOUND");
    const deleteRes = await fetch(`${baseUrl}/api/jobs/${adminJob.id}`, {
      method: "DELETE",
      headers: authHeaders(adminToken),
    });
    expect(deleteRes.status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${adamJob.id}`, {
          headers: authHeaders(adamToken),
        })
      ).status,
    ).toBe(200);
  });

  it("returns 409 when creating a duplicate workspace username", async () => {
    const adminToken = await login(baseUrl, "admin", "secret");

    const firstRes = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(firstRes.status).toBe(201);

    const secondRes = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: " Adam ",
        displayName: "Adam Clone",
        password: "adam-secret-2",
      }),
    });
    const body = await secondRes.json();

    expect(secondRes.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("Username already exists");
  });

  it("revokes existing sessions when an admin resets a user password", async () => {
    const adminToken = await login(baseUrl, "admin", "secret");

    const createRes = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: "adam",
        displayName: "Adam",
        password: "adam-secret",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      data: { user: { id: string } };
    };

    const adamToken = await login(baseUrl, "adam", "adam-secret");

    const resetRes = await fetch(
      `${baseUrl}/api/workspaces/users/${created.data.user.id}/reset-password`,
      {
        method: "POST",
        headers: authHeaders(adminToken),
        body: JSON.stringify({ password: "adam-secret-2" }),
      },
    );
    expect(resetRes.status).toBe(200);

    const oldSessionRes = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${adamToken}` },
    });
    expect(oldSessionRes.status).toBe(401);

    const newToken = await login(baseUrl, "adam", "adam-secret-2");
    const newSessionRes = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    expect(newSessionRes.status).toBe(200);
  });
});

describe("Hosted current-user isolation", () => {
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
        JOBOPS_HOSTED_PLATFORM_LLM_ENABLED: "false",
        LLM_API_KEY: "synthetic-platform-key-never-for-byok",
        JOBOPS_HOSTED_TENANT_ID: "tenant_default",
      },
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("isolates saved scoring settings and BYOK credentials between hosted users sharing a tenant", async () => {
    await assertScoringSettingsIsolation(
      await signup(baseUrl, "alice", "alice-secret"),
      await signup(baseUrl, "bob", "bob-secret"),
      true,
    );
  });

  it("isolates experience bullets and job resumes between hosted users sharing a tenant", async () => {
    await assertCoworkIsolation(
      baseUrl,
      await signup(baseUrl, "alice", "alice-secret"),
      await signup(baseUrl, "bob", "bob-secret"),
    );
  });

  it("authorizes deletion for only the job owner within a shared hosted tenant", async () => {
    const aliceToken = await signup(baseUrl, "alice", "alice-secret");
    const bobToken = await signup(baseUrl, "bob", "bob-secret");
    const aliceJob = await importManualJob(baseUrl, aliceToken, "Alice delete role");
    const bobJob = await importManualJob(baseUrl, bobToken, "Bob keep role");

    const { db, schema } = await import("@server/db");
    const pdfBytes = Buffer.from("%PDF-1.4\n%EOF\n");
    const storedFiles: Array<{ pdfPath: string; documentPath: string }> = [];
    for (const [token, job] of [
      [aliceToken, aliceJob],
      [bobToken, bobJob],
    ] as const) {
      const pdfRes = await fetch(`${baseUrl}/api/jobs/${job.id}/pdf`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          fileName: "resume.pdf",
          mediaType: "application/pdf",
          dataBase64: pdfBytes.toString("base64"),
        }),
      });
      expect(pdfRes.status).toBe(201);
      const documentRes = await fetch(`${baseUrl}/api/jobs/${job.id}/documents`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          fileName: "note.txt",
          mediaType: "text/plain",
          dataBase64: Buffer.from("Private attachment").toString("base64"),
        }),
      });
      expect(documentRes.status).toBe(201);
      storedFiles.push({
        pdfPath:
          db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get()?.pdfPath ?? "",
        documentPath:
          db.select().from(schema.jobDocuments).where(eq(schema.jobDocuments.jobId, job.id)).get()
            ?.storagePath ?? "",
      });
    }
    const tamperPathRes = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
      method: "PATCH",
      headers: authHeaders(aliceToken),
      body: JSON.stringify({ pdfPath: storedFiles[1].pdfPath }),
    });
    expect(tamperPathRes.status).toBe(200);

    const anonymousDelete = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
      method: "DELETE",
    });
    expect(anonymousDelete.status).toBe(401);
    const crossUserDelete = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
      method: "DELETE",
      headers: authHeaders(bobToken),
    });
    expect(crossUserDelete.status).toBe(404);
    expect((await crossUserDelete.json()).error.code).toBe("NOT_FOUND");
    expect(await readFile(storedFiles[0].pdfPath)).toEqual(pdfBytes);

    const deleteRes = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
      method: "DELETE",
      headers: authHeaders(aliceToken),
    });
    expect(deleteRes.status).toBe(200);
    await expect(readFile(storedFiles[0].pdfPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(storedFiles[0].documentPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(storedFiles[1].pdfPath)).toEqual(pdfBytes);
    expect(await readFile(storedFiles[1].documentPath, "utf8")).toBe("Private attachment");
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
          headers: authHeaders(aliceToken),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/api/jobs/${bobJob.id}`, {
          headers: authHeaders(bobToken),
        })
      ).status,
    ).toBe(200);
  });

  it("isolates private data between two hosted users in the same tenant", async () => {
    const aliceToken = await signup(baseUrl, "alice", "alice-secret");
    const bobToken = await signup(baseUrl, "bob", "bob-secret");

    const aliceJob = await importManualJob(baseUrl, aliceToken, "Alice Role");
    const bobJob = await importManualJob(baseUrl, bobToken, "Bob Role");
    expect(aliceJob.id).not.toBe(bobJob.id);

    const aliceList = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    }).then((res) => res.json());
    expect(aliceList.data.jobs.map((job: { id: string }) => job.id)).toEqual([aliceJob.id]);

    const bobList = await fetch(`${baseUrl}/api/jobs`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    }).then((res) => res.json());
    expect(bobList.data.jobs.map((job: { id: string }) => job.id)).toEqual([bobJob.id]);

    const bobReadsAliceJob = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobReadsAliceJob.status).toBe(404);

    const bobMutatesAliceJob = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}`, {
      method: "PATCH",
      headers: authHeaders(bobToken),
      body: JSON.stringify({ status: "ready" }),
    });
    expect(bobMutatesAliceJob.status).toBe(404);

    const pdfBytes = Buffer.from("%PDF-1.4\n%EOF\n").toString("base64");
    const uploadPdfRes = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}/pdf`, {
      method: "POST",
      headers: authHeaders(aliceToken),
      body: JSON.stringify({
        fileName: "resume.pdf",
        mediaType: "application/pdf",
        dataBase64: pdfBytes,
      }),
    });
    expect(uploadPdfRes.status).toBe(201);

    const aliceReadsOwnPdf = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}/pdf`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(aliceReadsOwnPdf.status).toBe(200);
    expect(Buffer.from(await aliceReadsOwnPdf.arrayBuffer())).toEqual(
      Buffer.from(pdfBytes, "base64"),
    );
    expect(aliceReadsOwnPdf.headers.get("cache-control")).toContain("no-store");

    const bobReadsAlicePdf = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}/pdf`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobReadsAlicePdf.status).toBe(404);

    const uploadDocumentRes = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}/documents`, {
      method: "POST",
      headers: authHeaders(aliceToken),
      body: JSON.stringify({
        fileName: "note.txt",
        mediaType: "text/plain",
        dataBase64: Buffer.from("private note").toString("base64"),
      }),
    });
    expect(uploadDocumentRes.status).toBe(201);

    const bobListsAliceDocuments = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}/documents`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobListsAliceDocuments.status).toBe(404);

    const bobReadsAliceChat = await fetch(`${baseUrl}/api/jobs/${aliceJob.id}/chat/messages`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobReadsAliceChat.status).toBe(404);

    const savedSearchConfig = {
      searchTerms: ["backend engineer"],
      sources: ["linkedin"],
      country: "united kingdom",
      cityLocations: ["London"],
      workplaceTypes: ["remote"],
      searchScope: "selected_only",
      matchStrictness: "exact_only",
      topN: 10,
      minSuitabilityScore: 55,
      runBudget: 250,
      automaticPresetId: "custom",
    };

    for (const token of [aliceToken, bobToken]) {
      const res = await fetch(`${baseUrl}/api/pipeline/search-presets`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          name: "Same name",
          config: savedSearchConfig,
        }),
      });
      expect(res.status).toBe(201);
    }

    const aliceSearches = await fetch(`${baseUrl}/api/pipeline/search-presets`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    }).then((res) => res.json());
    const bobSearches = await fetch(`${baseUrl}/api/pipeline/search-presets`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    }).then((res) => res.json());

    expect(aliceSearches.data.searches).toHaveLength(1);
    expect(bobSearches.data.searches).toHaveLength(1);
    expect(aliceSearches.data.searches[0].id).not.toBe(bobSearches.data.searches[0].id);
  });

  it("keeps bulk job deletion scoped to the current hosted user", async () => {
    const aliceToken = await signup(baseUrl, "alice", "alice-secret");
    const bobToken = await signup(baseUrl, "bob", "bob-secret");
    const aliceJob = await importManualJob(baseUrl, aliceToken, "Alice Role");
    const bobJob = await importManualJob(baseUrl, bobToken, "Bob Role");

    const databaseDelete = await fetch(`${baseUrl}/api/database`, {
      method: "DELETE",
      headers: authHeaders(bobToken),
    });
    expect(databaseDelete.status).toBe(403);

    for (const [token, jobId] of [
      [aliceToken, aliceJob.id],
      [bobToken, bobJob.id],
    ]) {
      const res = await fetch(`${baseUrl}/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ status: "ready", suitabilityScore: 10 }),
      });
      expect(res.status).toBe(200);
    }

    const statusDelete = await fetch(`${baseUrl}/api/jobs/status/ready`, {
      method: "DELETE",
      headers: authHeaders(aliceToken),
    });
    expect((await statusDelete.json()).data.count).toBe(1);

    const bobAfterStatusDelete = await fetch(`${baseUrl}/api/jobs/${bobJob.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobAfterStatusDelete.status).toBe(200);

    const aliceLowScoreJob = await importManualJob(baseUrl, aliceToken, "Alice Low Score Role");
    const scorePatch = await fetch(`${baseUrl}/api/jobs/${aliceLowScoreJob.id}`, {
      method: "PATCH",
      headers: authHeaders(aliceToken),
      body: JSON.stringify({ suitabilityScore: 10 }),
    });
    expect(scorePatch.status).toBe(200);
    // Manual imports land Targeted; score cleanup keeps targeted jobs.
    const untarget = await fetch(`${baseUrl}/api/jobs/${aliceLowScoreJob.id}/target`, {
      method: "DELETE",
      headers: authHeaders(aliceToken),
    });
    expect(untarget.status).toBe(200);

    const scoreDelete = await fetch(`${baseUrl}/api/jobs/score/50`, {
      method: "DELETE",
      headers: authHeaders(aliceToken),
    });
    expect((await scoreDelete.json()).data.count).toBe(1);

    const bobAfterScoreDelete = await fetch(`${baseUrl}/api/jobs/${bobJob.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobAfterScoreDelete.status).toBe(200);
  });

  it("isolates watchlist job state and integration updates across hosted users", async () => {
    const aliceToken = await signup(baseUrl, "alice-wl", "alice-secret");
    const bobToken = await signup(baseUrl, "bob-wl", "bob-secret");

    const { runWithRequestContext } = await import("@infra/request-context");
    const watchlistRepo = await import("@server/repositories/watchlist");
    const integrationsRepo = await import("@server/repositories/post-application-integrations");
    const claims = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as {
        tenantId: string;
        userId: string;
      };
    const alice = claims(aliceToken);
    const bob = claims(bobToken);

    await runWithRequestContext(alice, async () => {
      await watchlistRepo.setWatchlistJobState({
        source: "greenhouse",
        sourceJobId: "job-1",
        state: "moved_to_workspace",
      });
      await integrationsRepo.upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: "shared@example.com",
        displayName: "Alice Gmail",
        credentials: { token: "alice" },
      });
    });

    await runWithRequestContext(bob, async () => {
      await watchlistRepo.setWatchlistJobState({
        source: "greenhouse",
        sourceJobId: "job-1",
        state: "ignored",
      });
      await integrationsRepo.upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: "shared@example.com",
        displayName: "Bob Gmail",
        credentials: { token: "bob" },
      });
    });

    await runWithRequestContext(alice, async () => {
      const states = await watchlistRepo.listWatchlistJobStates();
      expect(states).toHaveLength(1);
      expect(states[0]?.state).toBe("moved_to_workspace");

      const integration = await integrationsRepo.getPostApplicationIntegration(
        "gmail",
        "shared@example.com",
      );
      expect(integration?.displayName).toBe("Alice Gmail");
      expect(integration?.credentials).toEqual({ token: "alice" });
    });
  });
});
