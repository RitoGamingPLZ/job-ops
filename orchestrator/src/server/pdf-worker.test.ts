import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPdfWorkerApp } from "./pdf-worker-app";
import { defaultV5ResumeData } from "./services/resume-document/schema/v5";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@server/services/resume-renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/services/resume-renderer")>()),
  renderResumePdf: render,
}));

async function startPdfWorkerServer() {
  const app = createPdfWorkerApp();
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve PDF worker server address");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("pdf-worker app", () => {
  const originalInternalSecret = process.env.INTERNAL_SYNC_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;
  let server: Server | null = null;

  afterEach(async () => {
    render.mockReset();
    if (originalInternalSecret === undefined) {
      delete process.env.INTERNAL_SYNC_SECRET;
    } else {
      process.env.INTERNAL_SYNC_SECRET = originalInternalSecret;
    }
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
    if (server) {
      const closing = server;
      server = null;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
  });

  it("serves /health and returns structured 404 for unknown routes", async () => {
    let baseUrl: string;
    ({ server, baseUrl } = await startPdfWorkerServer());

    const health = await fetch(`${baseUrl}/health`, {
      headers: { "x-request-id": "health-req-1" },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toBe("health-req-1");
    expect(await health.json()).toMatchObject({
      status: "ok",
      timestamp: expect.any(String),
    });

    const missing = await fetch(`${baseUrl}/api/jobs`, {
      headers: { "x-request-id": "missing-req-1" },
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-request-id")).toBe("missing-req-1");
    expect(await missing.json()).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
      meta: { requestId: "missing-req-1" },
    });
  });

  it("enforces internal secret auth with CRON_SECRET fallback and renders PDFs", async () => {
    let baseUrl: string;
    ({ server, baseUrl } = await startPdfWorkerServer());
    const url = `${baseUrl}/internal/render-pdf`;
    const validBody = JSON.stringify({
      resumeJson: structuredClone(defaultV5ResumeData),
      renderer: "typst",
      typstTheme: "classic",
      language: "english",
      paperSize: "a4",
      jobId: "job-pdf-worker",
    });

    // Unconfigured when neither secret is present (or whitespace-only).
    process.env.INTERNAL_SYNC_SECRET = "   ";
    delete process.env.CRON_SECRET;
    const unconfigured = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-sync-secret": "any" },
      body: validBody,
    });
    expect(unconfigured.status).toBe(403);

    // Falls back to CRON_SECRET when INTERNAL_SYNC_SECRET is unset or whitespace-only.
    process.env.CRON_SECRET = "cron-fallback-secret";
    const missingAuth = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "unauth-1" },
      body: validBody,
    });
    expect(missingAuth.status).toBe(401);
    expect(missingAuth.headers.get("x-request-id")).toBe("unauth-1");

    render.mockImplementationOnce(async ({ outputPath }) => {
      await writeFile(outputPath, "%PDF-worker-cron");
    });
    const cronAuthed = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-sync-secret": "cron-fallback-secret",
        "x-request-id": "cron-ok-1",
      },
      body: validBody,
    });
    expect(cronAuthed.status).toBe(200);
    expect(cronAuthed.headers.get("content-type")).toContain("application/pdf");
    expect(cronAuthed.headers.get("x-request-id")).toBe("cron-ok-1");
    expect(await cronAuthed.text()).toBe("%PDF-worker-cron");
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-pdf-worker",
        resolvedPicture: null,
      }),
    );

    // When INTERNAL_SYNC_SECRET is set, CRON_SECRET alone is rejected and INTERNAL_SYNC_SECRET succeeds.
    process.env.INTERNAL_SYNC_SECRET = "primary-secret";
    const rejectedCron = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-sync-secret": "cron-fallback-secret",
      },
      body: validBody,
    });
    expect(rejectedCron.status).toBe(401);

    render.mockImplementationOnce(async ({ outputPath }) => {
      await writeFile(outputPath, "%PDF-worker-primary");
    });
    const primaryAuthed = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-sync-secret": "primary-secret",
      },
      body: validBody,
    });
    expect(primaryAuthed.status).toBe(200);
    expect(await primaryAuthed.text()).toBe("%PDF-worker-primary");
  });

  it("answers the warm-up request only with the internal secret", async () => {
    process.env.INTERNAL_SYNC_SECRET = "warm-secret";
    let baseUrl: string;
    ({ server, baseUrl } = await startPdfWorkerServer());

    const denied = await fetch(`${baseUrl}/internal/render-pdf/warm`, { method: "POST" });
    expect(denied.status).toBe(401);

    const warmed = await fetch(`${baseUrl}/internal/render-pdf/warm`, {
      method: "POST",
      headers: { "x-internal-sync-secret": "warm-secret" },
    });
    expect(warmed.status).toBe(204);
    expect(render).not.toHaveBeenCalled();
  });
});
