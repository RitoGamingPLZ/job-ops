import type { Server } from "node:http";
import type { ResumeV5Document } from "@shared/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const { callJson } = vi.hoisted(() => ({ callJson: vi.fn() }));
vi.mock("@shared/resume-links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/resume-links")>()),
  applyLibraryUpdate: vi.fn((doc) => doc),
  removeFromResume: vi.fn((doc) => doc),
  stampLibraryRefs: vi.fn((doc) => ({ doc, linked: 0 })),
  isOnResume: vi.fn(() => false),
}));
vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "mock-model"),
}));
let server: Server, baseUrl: string, closeDb: () => void, tempDir: string;
let token: string, jobId: string, document: ResumeV5Document;
async function request(path: string, method = "GET", body?: unknown, authorized = true) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "cowork-test",
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  callJson.mockResolvedValue({ success: true, data: { labels: [] } });
  ({ server, baseUrl, closeDb, tempDir } = await startServer({
    env: {
      BASIC_AUTH_USER: "admin",
      BASIC_AUTH_PASSWORD: "secret",
      JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
      JOBOPS_TEST_AUTH_BYPASS: "0",
    },
  }));
  token = (
    await (
      await request("/auth/login", "POST", { username: "admin", password: "secret" }, false)
    ).json()
  ).data.token;
  const imported = await request("/manual-jobs/import", "POST", {
    skipTailoring: true,
    job: {
      title: "Engineer",
      employer: "Acme",
      jobUrl: "https://example.com/job",
      jobDescription: "Build tools",
    },
  });
  jobId = (await imported.json()).data.id;
  const { buildDefaultResumeDocument } = await import("@server/services/resume-document/document");
  document = buildDefaultResumeDocument() as ResumeV5Document;
  document.basics.headline = "Base headline";
  document.sections.experience.items = [
    {
      id: "experience-1",
      hidden: false,
      company: "Acme",
      position: "Engineer",
      location: "",
      period: "2021-03 – Present",
      website: { url: "", label: "" },
      description: "<ul><li>Built APIs</li><li>Shipped tools</li><li> built   APIs </li></ul>",
      roles: [],
    },
  ];
  const { db, schema } = await import("@server/db");
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) throw new Error("Missing test job");
  db.insert(schema.designResumeDocuments)
    .values({
      id: "base-resume",
      tenantId: job.tenantId,
      userId: job.userId,
      title: "Base",
      resumeJson: document,
      revision: 1,
    })
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await stopServer({ server, closeDb, tempDir });
});

describe("co-work routes", () => {
  it("returns 409 for a job resume without a base resume", async () => {
    const { db, schema } = await import("@server/db");
    db.delete(schema.designResumeDocuments)
      .where(eq(schema.designResumeDocuments.id, "base-resume"))
      .run();
    const response = await request(`/jobs/${jobId}/resume`, "GET");
    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe("cowork-test");
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Import or create a resume first",
      },
      meta: { requestId: "cowork-test" },
    });
  });
  it("builds unsaved resumes and library syncs from the local base resume", async () => {
    expect((await request("/settings", "PATCH", { pdfRenderer: "typst" })).status).toBe(200);
    const response = await request(`/jobs/${jobId}/resume`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.document).toMatchObject({
      basics: { headline: "Base headline" },
      metadata: { template: document.metadata.template },
    });
    expect((await request("/library/sync", "POST")).status).toBe(200);
  });
  it("enforces authentication and returns request IDs on validation errors", async () => {
    for (const path of ["/experience-bullets", "/resumes", `/jobs/${jobId}/resume`])
      expect((await request(path, "GET", undefined, false)).status).toBe(401);
    const response = await request("/experience-bullets", "POST", {
      text: " ",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("x-request-id")).toBe("cowork-test");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
      meta: { requestId: "cowork-test" },
    });
  });
  it("creates, patches, lists and deletes plain-text library bullets", async () => {
    const created = await request("/experience-bullets", "POST", {
      text: "Built APIs",
      tags: ["TypeScript"],
    });
    expect(created.status).toBe(201);
    const {
      data: { bullet },
    } = await created.json();
    expect(bullet).toMatchObject({
      text: "Built APIs",
      source: "manual",
      company: null,
    });
    expect(bullet).not.toHaveProperty("tenantId");
    expect(
      (
        await (
          await request(`/experience-bullets/${bullet.id}`, "PATCH", {
            company: "Acme",
          })
        ).json()
      ).data.bullet,
    ).toMatchObject({ company: "Acme", tags: ["TypeScript"] });
    expect((await (await request("/experience-bullets")).json()).data.bullets).toHaveLength(1);
    expect((await request(`/experience-bullets/${bullet.id}`, "PATCH", {})).status).toBe(400);
    expect((await request(`/experience-bullets/${bullet.id}`, "DELETE")).status).toBe(200);
    expect((await request(`/experience-bullets/${bullet.id}`, "DELETE")).status).toBe(404);
  });
  it("syncs all library kinds without calling the LLM and keeps the default bullet filter", async () => {
    const first = await request("/library/sync", "POST");
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({
      created: 3,
      skipped: 1,
      linked: 0,
    });
    const items = (await (await request("/library")).json()).data.items;
    expect(items).toHaveLength(3);
    const role = items.find((item: { kind: string }) => item.kind === "role");
    expect(role).toMatchObject({
      text: "Engineer",
      data: { company: "Acme", period: "2021-03 – Present" },
    });
    const bullets = (await (await request("/experience-bullets")).json()).data.bullets;
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toMatchObject({
      parentId: role.id,
      company: "Acme",
      role: "Engineer",
      startDate: "2021-03",
      endDate: "Present",
    });
    expect((await (await request("/library/sync", "POST")).json()).data).toMatchObject({
      created: 0,
      skipped: 0,
    });
    expect(callJson).not.toHaveBeenCalled();
    expect((await request("/experience-bullets/import-resume", "POST")).status).toBe(404);
  });
  it("validates kinds, parent relationships and structured data", async () => {
    const role = (
      await (
        await request("/experience-bullets", "POST", {
          text: "Engineer",
          kind: "role",
          data: { company: "Acme" },
        })
      ).json()
    ).data.bullet;
    for (const input of [
      { text: "x", kind: "unknown" },
      { text: "x", data: [] },
      { text: "x", data: "bad" },
      { text: "x", parentId: "missing" },
      { text: "x", kind: "project_point", parentId: role.id },
      { text: "x", kind: "skill", parentId: role.id },
    ])
      expect((await request("/experience-bullets", "POST", input)).status).toBe(400);
    const child = await request("/experience-bullets", "POST", {
      text: "Duty",
      parentId: role.id,
    });
    expect(child.status).toBe(201);
    expect(
      (
        await request(`/experience-bullets/${role.id}`, "PATCH", {
          kind: "skill",
        })
      ).status,
    ).toBe(400);
    expect((await request(`/library/${role.id}/usage`)).status).toBe(200);
    expect((await (await request(`/library/${role.id}/usage`)).json()).data).toEqual({
      jobIds: [],
      frozenJobIds: [],
    });
  });
  it("automatically syncs once even when a manual role already exists", async () => {
    await request("/experience-bullets", "POST", {
      kind: "role",
      text: "Manual role",
    });
    const pdf = await import("@server/services/pdf");
    const load = vi.spyOn(pdf, "loadBaseResumeSource");
    expect((await (await request("/library")).json()).data.items).toHaveLength(4);
    expect((await (await request("/library")).json()).data.items).toHaveLength(4);
    expect(load).toHaveBeenCalledOnce();
  });
  it("materializes a tailored copy, atomically checks revisions and resets", async () => {
    const patched = await request(`/jobs/${jobId}`, "PATCH", {
      tailoredSummary: "Tailored summary",
      tailoredHeadline: "Tailored headline",
      tailoredSkills: JSON.stringify([{ name: "TS", keywords: ["Node"] }]),
    });
    expect(patched.status).toBe(200);
    const initial = await request(`/jobs/${jobId}/resume`);
    expect(initial.status).toBe(200);
    const state = (await initial.json()).data;
    expect(state).toMatchObject({
      exists: true,
      revision: 1,
      updatedAt: expect.any(String),
      document: {
        basics: { headline: "Tailored headline" },
        summary: { content: "Tailored summary" },
      },
    });
    expect((await (await request("/resumes")).json()).data.resumes).toEqual([
      expect.objectContaining({ jobId, hasPdf: false }),
    ]);
    const edited = {
      ...state.document,
      basics: { ...state.document.basics, headline: "Co-work headline" },
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 1,
          document: edited,
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await (await request(`/jobs/${jobId}/resume`)).json()).data).toMatchObject({
      exists: true,
      revision: 2,
      document: { basics: { headline: "Co-work headline" } },
    });
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 1,
          document: edited,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 2,
          document: edited,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 2,
          document: edited,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 3,
          document: {},
        })
      ).status,
    ).toBe(400);
    expect((await request(`/jobs/${jobId}/resume`, "DELETE")).status).toBe(200);
    expect((await (await request(`/jobs/${jobId}/resume`)).json()).data.exists).toBe(true);
    expect(document.basics.headline).toBe("Base headline");
  });
  it("generatePdf materializes the editor document before rendering", async () => {
    await request("/settings", "PATCH", { pdfRenderer: "typst" });
    const { db, schema } = await import("@server/db");
    const owner = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    if (!owner) throw new Error("Missing job");
    const renderer = await import("@server/services/resume-renderer");
    const { writeFile } = await import("node:fs/promises");
    const render = vi.spyOn(renderer, "renderResumePdf").mockImplementation(async (args) => {
      await writeFile(args.outputPath, Buffer.from("%PDF-1.4\n"));
    });
    const { generatePdf } = await import("@server/services/pdf");
    const { getJobResume } = await import("@server/repositories/job-resumes");
    const { runWithRequestContext } = await import("@infra/request-context");
    await runWithRequestContext(
      {
        tenantId: "tenant_default",
        userId: owner.userId ?? undefined,
        requestId: "pdf-create",
      },
      async () => {
        expect(await getJobResume(jobId)).toBeNull();
        expect(await generatePdf(jobId, "Build tools")).toMatchObject({
          success: true,
        });
        const row = await getJobResume(jobId);
        expect(row).toMatchObject({
          revision: 1,
          exists: true,
          document: { basics: { headline: "Base headline" } },
        });
        expect(render).toHaveBeenCalledWith(expect.objectContaining({ resumeJson: row?.document }));
      },
    );
  });
  it("lists targeted jobs without copies but excludes legacy tailoring alone", async () => {
    const { db, schema } = await import("@server/db");
    db.update(schema.jobs)
      .set({ tailoredSummary: "Legacy summary" })
      .where(eq(schema.jobs.id, jobId))
      .run();
    expect((await (await request("/resumes")).json()).data.resumes).toEqual([]);
    db.update(schema.jobs)
      .set({ readyAt: new Date().toISOString() })
      .where(eq(schema.jobs.id, jobId))
      .run();
    expect((await (await request("/resumes")).json()).data.resumes).toEqual([
      expect.objectContaining({ jobId }),
    ]);
  });
  it("lists saved copies without tailoring and rejects missing jobs", async () => {
    expect((await (await request("/resumes")).json()).data.resumes).toEqual([]);
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 0,
          document,
        })
      ).status,
    ).toBe(200);
    expect((await (await request("/resumes")).json()).data.resumes).toEqual([
      expect.objectContaining({ jobId, title: "Engineer", employer: "Acme" }),
    ]);
    for (const method of ["GET", "PUT", "DELETE"])
      expect(
        (
          await request(
            "/jobs/missing/resume",
            method,
            method === "PUT" ? { baseRevision: 0, document } : undefined,
          )
        ).status,
      ).toBe(404);
    await request(`/jobs/${jobId}/resume`, "DELETE");
    expect((await (await request("/resumes")).json()).data.resumes).toEqual([]);
  });
  it("ranks an empty library without an LLM and checks job ownership", async () => {
    const response = await request("/experience-bullets/rank", "POST", {
      jobId,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ ranked: [] });
    expect((await request("/experience-bullets/rank", "POST", { jobId: "missing" })).status).toBe(
      404,
    );
    expect(
      (
        await request("/experience-bullets/extract", "POST", {
          text: "x".repeat(50001),
        })
      ).status,
    ).toBe(400);
  });
  it("validates AI route inputs before calling the LLM", async () => {
    for (const action of ["rank", "extract"]) {
      const response = await request(`/experience-bullets/${action}`, "POST", {});
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        meta: { requestId: "cowork-test" },
      });
    }
  });
});

it("screens a posted resume against the job with validated refs and scoped bullets", async () => {
  const own = (await (await request("/experience-bullets", "POST", { text: "Built tools" })).json())
    .data.bullet;
  callJson.mockResolvedValue({
    success: true,
    data: {
      score: 55,
      summary: "Close.",
      requirements: [
        {
          text: "APIs",
          importance: "must",
          category: "skill",
          status: "in_library",
          evidence: [
            {
              text: "Built APIs",
              focus: {
                kind: "bullet",
                section: "experience",
                itemId: "experience-1",
                bulletIndex: 0,
              },
            },
            {
              text: "ghost",
              focus: {
                kind: "item",
                section: "experience",
                itemId: "ghost",
                bulletIndex: null,
              },
            },
          ],
          libraryBulletIds: [own.id, "foreign"],
          tip: "Add the duty",
        },
      ],
    },
  });
  const path = `/jobs/${jobId}/resume/screening`;
  const response = await request(path, "POST", { document });
  expect(response.status).toBe(200);
  const report = (await response.json()).data;
  expect(report).toMatchObject({
    score: 55,
    jobTitle: "Engineer",
    employer: "Acme",
    requirements: [
      {
        status: "in_library",
        libraryBulletIds: [own.id],
        evidence: [
          {
            focus: {
              kind: "bullet",
              itemId: "experience-1",
              label: "Experience › Acme — Engineer › Built APIs",
            },
          },
          { focus: null },
        ],
      },
    ],
  });
  const prompt = JSON.parse(callJson.mock.lastCall?.[0].messages[1].content);
  expect(prompt.job.jobDescription).toBe("Build tools");
  expect(prompt.library.map((b: { id: string }) => b.id)).toEqual([own.id]);

  const calls = callJson.mock.calls.length;
  for (const body of [{}, { document: { nope: true } }, { document, x: 1 }])
    expect((await request(path, "POST", body)).status).toBe(400);
  expect((await request("/jobs/missing/resume/screening", "POST", { document })).status).toBe(404);
  expect((await request(path, "POST", { document }, false)).status).toBe(401);
  expect(callJson.mock.calls.length).toBe(calls);
});

it("labels explicit IDs, validates payloads, and sync never calls the LLM", async () => {
  callJson.mockImplementation(async (input) => ({
    success: true,
    data: {
      labels: JSON.parse(input.messages[1].content).bullets.map((b: { id: string }) => ({
        bulletId: b.id,
        tags: ["APIs"],
      })),
    },
  }));
  await request("/library/sync", "POST");
  expect(callJson).not.toHaveBeenCalled();
  const imported = (await (await request("/experience-bullets")).json()).data;
  const response = await request("/experience-bullets/label", "POST", {
    ids: [imported.bullets[0].id, "foreign"],
  });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    labeled: 1,
    remaining: 0,
  });
  const callsBefore = callJson.mock.calls.length;
  expect(
    (
      await request("/experience-bullets/label", "POST", {
        ids: Array.from({ length: 201 }, () => imported.bullets[0].id),
      })
    ).status,
  ).toBe(400);
  expect(callJson).toHaveBeenCalledTimes(callsBefore);
  expect(
    (
      await request("/experience-bullets/label", "POST", {
        ids: Array.from({ length: 200 }, () => imported.bullets[0].id),
      })
    ).status,
  ).toBe(200);
  expect((await request("/experience-bullets/label", "POST", { ids: "bad" })).status).toBe(400);
  expect((await request("/experience-bullets/label", "POST", {}, false)).status).toBe(401);
  for (const b of imported.bullets) await request(`/experience-bullets/${b.id}`, "DELETE");
  callJson.mockRejectedValue(new Error("upstream unavailable"));
  const failed = (await (await request("/library/sync", "POST")).json()).data;
  expect(failed).toMatchObject({ created: 0 });
  expect(
    (await (await request("/experience-bullets")).json()).data.bullets.every(
      (b: { tags: string[] }) => b.tags.length === 0,
    ),
  ).toBe(true);
});

it("retries the base import without log spam and preserves a successful first build after deletion", async () => {
  const { db, schema } = await import("@server/db");
  db.delete(schema.designResumeDocuments)
    .where(eq(schema.designResumeDocuments.id, "base-resume"))
    .run();
  const pdf = await import("@server/services/pdf");
  const load = vi.spyOn(pdf, "loadBaseResumeSource");
  const { logger } = await import("@infra/logger");
  const warn = vi.spyOn(logger, "warn");
  const manual = (
    await (await request("/experience-bullets", "POST", { text: "Manual duty" })).json()
  ).data.bullet;
  const first = await request("/library");
  expect(first.status).toBe(200);
  const items = (await first.json()).data.items;
  expect(items).toHaveLength(2);
  const role = items.find((item: { kind: string }) => item.kind === "role");
  expect(items.find((item: { id: string }) => item.id === manual.id).parentId).toBe(role.id);
  expect(warn).toHaveBeenCalledOnce();
  await request(`/experience-bullets/${role.id}`, "DELETE");
  expect((await (await request("/library")).json()).data.items).toEqual([]);
  expect((await (await request("/library/sync", "POST")).json()).data.created).toBe(0);
  expect(load).toHaveBeenCalledTimes(3);
  expect(warn).toHaveBeenCalledOnce();

  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
  if (!job) throw new Error("Missing test job");
  db.insert(schema.designResumeDocuments)
    .values({
      id: "base-resume",
      tenantId: job.tenantId,
      userId: job.userId,
      title: "Base",
      resumeJson: document,
      revision: 1,
    })
    .run();
  const imported = (await (await request("/library")).json()).data.items;
  expect(imported.some((item: { text: string }) => item.text === "Built APIs")).toBe(true);
  expect(load).toHaveBeenCalledTimes(4);
  for (const item of imported) {
    await request(`/experience-bullets/${item.id}`, "DELETE");
  }
  expect((await (await request("/library")).json()).data.items).toEqual([]);
  await request("/library/sync", "POST");
  expect(load).toHaveBeenCalledTimes(4);
  expect(warn).toHaveBeenCalledOnce();
});

it("logs unavailable base imports independently for each private scope", async () => {
  vi.stubEnv("JOBOPS_APP_MODE", "hosted");
  vi.stubEnv("JOBOPS_HOSTED_TENANT_ID", "tenant_default");
  vi.stubEnv("JOBOPS_HOSTED_SIGNUPS_ENABLED", "true");
  const { db, schema } = await import("@server/db");
  db.delete(schema.designResumeDocuments).run();
  const pdf = await import("@server/services/pdf");
  const load = vi.spyOn(pdf, "loadBaseResumeSource");
  const { logger } = await import("@infra/logger");
  const warn = vi.spyOn(logger, "warn");
  const ownerToken = token;
  const signup = await request(
    "/auth/signup",
    "POST",
    { username: "other-scope", password: "secret-password" },
    false,
  );
  expect(signup.status).toBe(201);
  token = (await signup.json()).data.token;
  await request("/library");
  await request("/library/sync", "POST");
  expect(warn).toHaveBeenCalledOnce();
  token = ownerToken;
  await request("/library");
  await request("/library/sync", "POST");
  expect(load).toHaveBeenCalledTimes(4);
  expect(warn).toHaveBeenCalledTimes(2);
});

it("accepts valid contact items and rejects invalid contact data on create and patch", async () => {
  const response = await request("/experience-bullets", "POST", {
    kind: "contact",
    text: "Personal email",
    data: { type: "email", value: "me@example.com" },
    tags: ["Personal"],
  });
  expect(response.status).toBe(201);
  const {
    data: { bullet },
  } = await response.json();
  expect(bullet).toMatchObject({
    kind: "contact",
    parentId: null,
    data: { type: "email", value: "me@example.com" },
  });
  const invalid = await request(`/experience-bullets/${bullet.id}`, "PATCH", {
    data: { type: "fax", value: "123" },
  });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error.code).toBe("INVALID_REQUEST");
  expect(
    (
      await request("/experience-bullets", "POST", {
        kind: "contact",
        text: "Empty",
        data: { type: "email", value: "" },
      })
    ).status,
  ).toBe(400);
});

it("supersedes an uploaded job PDF only when saved editor content changes, and allows preview and generation", async () => {
  callJson.mockResolvedValue({
    success: true,
    data: {
      headline: "Tailored headline",
      summary: "Tailored summary",
      experience: [],
      projects: [],
      skills: [],
      educationIds: [],
      certificationIds: [],
      awardIds: [],
    },
  });
  expect((await request("/settings", "PATCH", { pdfRenderer: "typst" })).status).toBe(200);
  const uploadedPdf = Buffer.from("%PDF-1.7\nUploaded original\n");
  const uploadRes = await request(`/jobs/${jobId}/pdf`, "POST", {
    fileName: "uploaded.pdf",
    mediaType: "application/pdf",
    dataBase64: uploadedPdf.toString("base64"),
  });
  expect(uploadRes.status).toBe(201);
  expect((await uploadRes.json()).data).toMatchObject({
    status: "ready",
    pdfSource: "uploaded",
    pdfFreshness: "uploaded",
  });

  const materialized = await request(`/jobs/${jobId}/resume`);
  expect(materialized.status).toBe(200);
  const initialState = (await materialized.json()).data as {
    revision: number;
    document: ResumeV5Document;
  };
  expect(initialState.revision).toBe(1);
  expect((await (await request(`/jobs/${jobId}`)).json()).data).toMatchObject({
    pdfSource: "uploaded",
    pdfFreshness: "uploaded",
  });

  const unchangedSave = await request(`/jobs/${jobId}/resume`, "PUT", {
    baseRevision: 1,
    document: initialState.document,
  });
  expect(unchangedSave.status).toBe(200);
  expect((await unchangedSave.json()).data.revision).toBe(2);
  expect((await (await request(`/jobs/${jobId}`)).json()).data).toMatchObject({
    pdfSource: "uploaded",
    pdfFreshness: "uploaded",
  });

  const editedDocument: ResumeV5Document = {
    ...initialState.document,
    basics: { ...initialState.document.basics, headline: "Edited headline" },
  };
  const editedSave = await request(`/jobs/${jobId}/resume`, "PUT", {
    baseRevision: 2,
    document: editedDocument,
  });
  expect(editedSave.status).toBe(200);
  expect((await editedSave.json()).data.revision).toBe(3);
  expect((await (await request(`/jobs/${jobId}`)).json()).data).toMatchObject({
    pdfSource: "generated",
    pdfFreshness: "stale",
    pdfFingerprint: null,
  });

  const renderer = await import("@server/services/resume-renderer");
  const { writeFile } = await import("node:fs/promises");
  vi.spyOn(renderer, "renderResumePdf").mockImplementation(async (args) => {
    const headline = (args.resumeJson as { basics?: { headline?: string } }).basics?.headline ?? "";
    await writeFile(args.outputPath, Buffer.from(`%PDF-1.4\n${headline}\n`));
  });

  const previewRes = await request(`/jobs/${jobId}/preview-pdf`, "POST");
  expect(previewRes.status).toBe(200);
  expect(await previewRes.text()).toContain("Edited headline");

  const pipeline = await import("@server/pipeline/index");
  const actualPipeline =
    await vi.importActual<typeof import("@server/pipeline/index")>("@server/pipeline/index");
  vi.mocked(pipeline.generateFinalPdf).mockImplementationOnce((id, opts) =>
    actualPipeline.generateFinalPdf(id, opts),
  );

  const generateRes = await request(`/jobs/${jobId}/generate-pdf`, "POST");
  expect(generateRes.status).toBe(200);
  expect((await generateRes.json()).data).toMatchObject({
    pdfSource: "generated",
    pdfFreshness: "current",
  });

  const storedPdfRes = await request(`/jobs/${jobId}/pdf`);
  expect(storedPdfRes.status).toBe(200);
  expect(await storedPdfRes.text()).toContain("Edited headline");

  const reuploadRes = await request(`/jobs/${jobId}/pdf`, "POST", {
    fileName: "uploaded-again.pdf",
    mediaType: "application/pdf",
    dataBase64: Buffer.from("%PDF-1.7\nReplacement upload\n").toString("base64"),
  });
  expect(reuploadRes.status).toBe(201);
  expect((await reuploadRes.json()).data).toMatchObject({
    pdfSource: "uploaded",
    pdfFreshness: "uploaded",
  });
});

it("scopes uploaded PDF superseding to the active user in hosted multi-user mode", async () => {
  callJson.mockResolvedValue({
    success: true,
    data: {
      headline: "Tailored headline",
      summary: "Tailored summary",
      experience: [],
      projects: [],
      skills: [],
      educationIds: [],
      certificationIds: [],
      awardIds: [],
    },
  });
  vi.stubEnv("JOBOPS_APP_MODE", "hosted");
  vi.stubEnv("JOBOPS_HOSTED_TENANT_ID", "tenant_default");
  vi.stubEnv("JOBOPS_HOSTED_SIGNUPS_ENABLED", "true");

  const ownerUpload = await request(`/jobs/${jobId}/pdf`, "POST", {
    fileName: "owner.pdf",
    mediaType: "application/pdf",
    dataBase64: Buffer.from("%PDF-1.7\nOwner PDF\n").toString("base64"),
  });
  expect(ownerUpload.status).toBe(201);

  const ownerToken = token;
  const signup = await request(
    "/auth/signup",
    "POST",
    { username: "other-pdf-scope", password: "secret-password" },
    false,
  );
  expect(signup.status).toBe(201);
  token = (await signup.json()).data.token;

  const otherImported = await request("/manual-jobs/import", "POST", {
    skipTailoring: true,
    job: {
      title: "Designer",
      employer: "Beta",
      jobUrl: "https://example.com/job-other",
      jobDescription: "Design systems",
    },
  });
  expect(otherImported.status).toBe(200);
  const otherJobId = (await otherImported.json()).data.id as string;
  expect(
    (
      await request(`/jobs/${otherJobId}/pdf`, "POST", {
        fileName: "other.pdf",
        mediaType: "application/pdf",
        dataBase64: Buffer.from("%PDF-1.7\nOther PDF\n").toString("base64"),
      })
    ).status,
  ).toBe(201);

  const { db, schema } = await import("@server/db");
  const otherJobRow = db.select().from(schema.jobs).where(eq(schema.jobs.id, otherJobId)).get();
  if (!otherJobRow) throw new Error("Missing other user job");
  db.insert(schema.designResumeDocuments)
    .values({
      id: "other-base-resume",
      tenantId: otherJobRow.tenantId,
      userId: otherJobRow.userId,
      title: "Other Base",
      resumeJson: document,
      revision: 1,
    })
    .run();

  const otherInitial = (await (await request(`/jobs/${otherJobId}/resume`)).json()).data as {
    revision: number;
    document: ResumeV5Document;
  };
  const otherEdit = await request(`/jobs/${otherJobId}/resume`, "PUT", {
    baseRevision: otherInitial.revision,
    document: {
      ...otherInitial.document,
      basics: { ...otherInitial.document.basics, headline: "Other edited headline" },
    },
  });
  expect(otherEdit.status).toBe(200);
  expect((await (await request(`/jobs/${otherJobId}`)).json()).data).toMatchObject({
    pdfSource: "generated",
    pdfFreshness: "stale",
  });

  token = ownerToken;
  expect((await (await request(`/jobs/${jobId}`)).json()).data).toMatchObject({
    pdfSource: "uploaded",
    pdfFreshness: "uploaded",
  });
});
