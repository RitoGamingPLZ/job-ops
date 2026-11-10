import type { Server } from "node:http";
import type { ReactiveResumeV5Document } from "@shared/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const { callJson } = vi.hoisted(() => ({ callJson: vi.fn() }));
vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: vi.fn(async () => ({ callJson })),
  resolveLlmModel: vi.fn(async () => "mock-model"),
}));
let server: Server, baseUrl: string, closeDb: () => void, tempDir: string;
let token: string, jobId: string, document: ReactiveResumeV5Document;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  authorized = true,
) {
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
      await request(
        "/auth/login",
        "POST",
        { username: "admin", password: "secret" },
        false,
      )
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
  const { buildDefaultReactiveResumeDocument } = await import(
    "@server/services/rxresume/document"
  );
  document = buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
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
      description:
        "<ul><li>Built APIs</li><li>Shipped tools</li><li> built   APIs </li></ul>",
      roles: [],
    },
  ];
  const { db, schema } = await import("@server/db");
  const job = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .get();
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
  await stopServer({ server, closeDb, tempDir });
});

describe("co-work routes", () => {
  it.each([
    ["GET", "job resume"],
    ["POST", "resume import"],
  ])("returns 409 for %s %s without a base resume", async (method) => {
    const { db, schema } = await import("@server/db");
    db.delete(schema.designResumeDocuments)
      .where(eq(schema.designResumeDocuments.id, "base-resume"))
      .run();
    const response = await request(
      method === "GET"
        ? `/jobs/${jobId}/resume`
        : "/experience-bullets/import-resume",
      method,
    );
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
  it.each([
    "rxresume",
    "typst",
  ] as const)("uses the configured %s renderer for unsaved resumes and imports", async (renderer) => {
    const { db, schema } = await import("@server/db");
    db.update(schema.designResumeDocuments)
      .set({ sourceResumeId: "upstream-resume", sourceMode: "v5" })
      .where(eq(schema.designResumeDocuments.id, "base-resume"))
      .run();
    expect(
      (await request("/settings", "PATCH", { pdfRenderer: renderer })).status,
    ).toBe(200);
    const upstream = structuredClone(document);
    upstream.metadata.template = "rhyhorn";
    upstream.basics.headline = "Upstream headline";
    const rxresume = await import("@server/services/rxresume");
    const getResume = vi.spyOn(rxresume, "getResume").mockResolvedValue({
      id: "upstream-resume",
      name: "Upstream",
      data: upstream,
    });
    const response = await request(`/jobs/${jobId}/resume`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.document).toMatchObject({
      basics: { headline: "Base headline" },
      metadata: {
        template:
          renderer === "rxresume"
            ? upstream.metadata.template
            : document.metadata.template,
      },
    });
    expect(
      (await request("/experience-bullets/import-resume", "POST")).status,
    ).toBe(200);
    if (renderer === "rxresume") {
      expect(document.metadata.template).not.toBe(upstream.metadata.template);
      expect(getResume).toHaveBeenCalledTimes(2);
      expect(getResume).toHaveBeenCalledWith("upstream-resume");
    } else {
      expect(getResume).not.toHaveBeenCalled();
    }
  });
  it("enforces authentication and returns request IDs on validation errors", async () => {
    for (const path of [
      "/experience-bullets",
      "/resumes",
      `/jobs/${jobId}/resume`,
    ])
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
    expect(
      (await (await request("/experience-bullets")).json()).data.bullets,
    ).toHaveLength(1);
    expect(
      (await request(`/experience-bullets/${bullet.id}`, "PATCH", {})).status,
    ).toBe(400);
    expect(
      (await request(`/experience-bullets/${bullet.id}`, "DELETE")).status,
    ).toBe(200);
    expect(
      (await request(`/experience-bullets/${bullet.id}`, "DELETE")).status,
    ).toBe(404);
  });
  it("imports experience with period labels and deduplicates normalized text", async () => {
    const first = await request("/experience-bullets/import-resume", "POST");
    expect(first.status).toBe(200);
    expect((await first.json()).data).toMatchObject({
      created: 2,
      skipped: 1,
      bullets: [
        expect.objectContaining({
          company: "Acme",
          role: "Engineer",
          startDate: "2021-03",
          endDate: "Present",
          sourceExperienceId: "experience-1",
          source: "resume",
        }),
        expect.any(Object),
      ],
    });
    expect(
      (
        await (
          await request("/experience-bullets/import-resume", "POST")
        ).json()
      ).data,
    ).toMatchObject({ created: 0, skipped: 3 });
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
    expect(
      (await (await request(`/jobs/${jobId}/resume`)).json()).data,
    ).toMatchObject({
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
    expect(
      (await (await request(`/jobs/${jobId}/resume`)).json()).data.exists,
    ).toBe(true);
    expect(document.basics.headline).toBe("Base headline");
  });
  it("generatePdf materializes the editor document before rendering", async () => {
    await request("/settings", "PATCH", { pdfRenderer: "typst" });
    const { db, schema } = await import("@server/db");
    const owner = db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .get();
    if (!owner) throw new Error("Missing job");
    const renderer = await import("@server/services/resume-renderer");
    const render = vi
      .spyOn(renderer, "renderResumePdf")
      .mockResolvedValue(undefined);
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
        expect(render).toHaveBeenCalledWith(
          expect.objectContaining({ resumeJson: row?.document }),
        );
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
    expect(
      (await request("/experience-bullets/rank", "POST", { jobId: "missing" }))
        .status,
    ).toBe(404);
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
      const response = await request(
        `/experience-bullets/${action}`,
        "POST",
        {},
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        meta: { requestId: "cowork-test" },
      });
    }
  });
});

it("screens a posted resume against the job with validated refs and scoped bullets", async () => {
  const own = (
    await (
      await request("/experience-bullets", "POST", { text: "Built tools" })
    ).json()
  ).data.bullet;
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
  expect(
    (await request("/jobs/missing/resume/screening", "POST", { document }))
      .status,
  ).toBe(404);
  expect((await request(path, "POST", { document }, false)).status).toBe(401);
  expect(callJson.mock.calls.length).toBe(calls);
});

it("labels explicit IDs, returns labeled imports, validates payloads, and preserves imports on failure", async () => {
  callJson.mockImplementation(async (input) => ({
    success: true,
    data: {
      labels: JSON.parse(input.messages[1].content).bullets.map(
        (b: { id: string }) => ({ bulletId: b.id, tags: ["APIs"] }),
      ),
    },
  }));
  const imported = (
    await (await request("/experience-bullets/import-resume", "POST")).json()
  ).data;
  expect(imported.labeled).toBe(2);
  expect(
    imported.bullets.every((b: { tags: string[] }) => b.tags.includes("APIs")),
  ).toBe(true);
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
  expect(
    (await request("/experience-bullets/label", "POST", { ids: "bad" })).status,
  ).toBe(400);
  expect(
    (await request("/experience-bullets/label", "POST", {}, false)).status,
  ).toBe(401);
  for (const b of imported.bullets)
    await request(`/experience-bullets/${b.id}`, "DELETE");
  callJson.mockRejectedValue(new Error("upstream unavailable"));
  const failed = (
    await (await request("/experience-bullets/import-resume", "POST")).json()
  ).data;
  expect(failed).toMatchObject({ created: 2, labeled: 0 });
  expect(
    failed.bullets.every((b: { tags: string[] }) => b.tags.length === 0),
  ).toBe(true);
});
