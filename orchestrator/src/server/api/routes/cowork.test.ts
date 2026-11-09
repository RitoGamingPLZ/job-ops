import type { Server } from "node:http";
import type { ReactiveResumeV5Document } from "@shared/types";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

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
afterEach(async () => stopServer({ server, closeDb, tempDir }));

describe("co-work routes", () => {
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
  it("returns an unsaved tailored copy, atomically checks revisions and resets", async () => {
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
      exists: false,
      revision: 0,
      updatedAt: null,
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
          baseRevision: 0,
          document: edited,
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await (await request(`/jobs/${jobId}/resume`)).json()).data,
    ).toMatchObject({
      exists: true,
      revision: 1,
      document: { basics: { headline: "Co-work headline" } },
    });
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 0,
          document: edited,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/jobs/${jobId}/resume`, "PUT", {
          baseRevision: 1,
          document: edited,
        })
      ).status,
    ).toBe(200);
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
          document: {},
        })
      ).status,
    ).toBe(400);
    expect((await request(`/jobs/${jobId}/resume`, "DELETE")).status).toBe(200);
    expect(
      (await (await request(`/jobs/${jobId}/resume`)).json()).data.exists,
    ).toBe(false);
    expect(document.basics.headline).toBe("Base headline");
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
