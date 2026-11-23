import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@server/services/resume-renderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/services/resume-renderer")>()),
  renderResumePdf: render,
}));

describe("internal PDF rendering", () => {
  let server: Server;
  let closeDb: () => void;
  let tempDir: string;
  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("requires the internal secret without a user session and renders inline pictures with cleanup", async () => {
    let baseUrl: string;
    ({ server, closeDb, tempDir, baseUrl } = await startServer({
      env: {
        JOBOPS_TEST_AUTH_BYPASS: "0",
        INTERNAL_SYNC_SECRET: "render-secret",
        CRON_SECRET: undefined,
      },
    }));
    const url = `${baseUrl}/internal/render-pdf`;
    for (const secret of [undefined, "wrong-secret"]) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "render-auth",
          ...(secret ? { "x-internal-sync-secret": secret } : {}),
        },
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("x-request-id")).toBe("render-auth");
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "UNAUTHORIZED" },
        meta: { requestId: "render-auth" },
      });
    }
    expect(render).not.toHaveBeenCalled();
    const headers = {
      "content-type": "application/json",
      "x-internal-sync-secret": "render-secret",
    };
    const invalid = await fetch(url, { method: "POST", headers, body: "{}" });
    expect(invalid.status).toBe(400);

    const { defaultV5ResumeData } = await import("@server/services/rxresume/schema/v5");
    const resumeJson = structuredClone(defaultV5ResumeData);
    resumeJson.picture.hidden = false;
    resumeJson.picture.url = "/api/design-resume/assets/photo/content";
    const picture = Buffer.alloc(120_000, 42);
    render.mockImplementation(async ({ outputPath }) => {
      await writeFile(outputPath, "%PDF-test");
    });
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        resumeJson,
        renderer: "typst",
        typstTheme: "navy-serif",
        language: "spanish",
        paperSize: "letter",
        jobId: "job-1",
        picture: { base64: picture.toString("base64"), mimeType: "image/png" },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("%PDF-test");
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        renderer: "typst",
        typstTheme: "navy-serif",
        language: "spanish",
        paperSize: "letter",
        jobId: "job-1",
        resolvedPicture: { bytes: picture, mimeType: "image/png" },
      }),
    );
    expect(existsSync(render.mock.lastCall![0].outputPath)).toBe(false);

    delete process.env.INTERNAL_SYNC_SECRET;
    const unconfigured = await fetch(url, { method: "POST", headers, body: "{}" });
    expect(unconfigured.status).toBe(403);
  });
});
