import type { Server } from "node:http";
import type { ExtractorRegistry } from "@server/extractors/registry";
import type { ExtractorManifest } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const mockGetExtractorRegistry = vi.fn();

vi.mock("@server/extractors/registry", () => ({
  getExtractorRegistry: mockGetExtractorRegistry,
}));

describe("internal scrape routes", () => {
  let server: Server;
  let closeDb: () => void;
  let tempDir: string;

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
    vi.clearAllMocks();
  });

  it("enforces internal secret without requiring a user session and returns full jobs on /scrape", async () => {
    let baseUrl: string;
    ({ server, closeDb, tempDir, baseUrl } = await startServer({
      env: {
        JOBOPS_TEST_AUTH_BYPASS: "0",
        INTERNAL_SYNC_SECRET: "scrape-secret",
        CRON_SECRET: undefined,
      },
    }));

    const run = vi.fn().mockResolvedValue({
      success: true,
      jobs: [
        {
          source: "linkedin",
          title: "Backend Engineer",
          employer: "Acme Labs",
          jobUrl: "https://example.com/jobs/1",
          applicationLink: "https://example.com/jobs/1/apply",
          location: "London, UK",
          jobDescription: "Build TypeScript services.",
        },
      ],
      sourceErrors: ["indeed: soft rate limit"],
    });
    const manifest: ExtractorManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin"],
      runtime: "container",
      run,
    };
    const registry: ExtractorRegistry = {
      manifests: new Map([["jobspy", manifest]]),
      manifestBySource: new Map([
        ["indeed", manifest],
        ["linkedin", manifest],
      ]),
      availableSources: ["indeed", "linkedin"],
      locationCapabilitiesBySource: {},
    };
    mockGetExtractorRegistry.mockResolvedValue(registry);

    for (const url of [`${baseUrl}/scrape`, `${baseUrl}/api/internal/scrape/run`]) {
      for (const secret of [undefined, "wrong-secret"]) {
        const unauthorizedRes = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "scrape-auth-check",
            ...(secret ? { "x-internal-sync-secret": secret } : {}),
          },
          body: JSON.stringify({ source: "linkedin" }),
        });
        expect(unauthorizedRes.status, url).toBe(401);
        expect(unauthorizedRes.headers.get("x-request-id")).toBe("scrape-auth-check");
      }
    }
    expect(run).not.toHaveBeenCalled();

    const headers = {
      "content-type": "application/json",
      "x-internal-sync-secret": "scrape-secret",
      "x-request-id": "scrape-valid-req",
    };
    const res = await fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        taskId: "task-1",
        source: "linkedin",
        params: {
          selectedSources: ["linkedin", "indeed", "invalid-ignored"],
          searchTerms: ["backend engineer"],
          selectedCountry: "united kingdom",
          settings: { jobspyResultsWanted: "25" },
        },
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.meta.requestId).toBe("scrape-valid-req");
    expect(body.data).toMatchObject({
      taskId: "task-1",
      source: "linkedin",
      extractorSucceeded: true,
      sourceErrors: ["indeed: soft rate limit"],
      jobs: [
        expect.objectContaining({
          source: "linkedin",
          title: "Backend Engineer",
          employer: "Acme Labs",
          jobUrl: "https://example.com/jobs/1",
          applicationLink: "https://example.com/jobs/1/apply",
        }),
      ],
      postings: [
        expect.objectContaining({
          jobUrl: "https://example.com/jobs/1",
          title: "Backend Engineer",
          employer: "Acme Labs",
        }),
      ],
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "linkedin",
        selectedSources: ["linkedin", "indeed"],
        searchTerms: ["backend engineer"],
        selectedCountry: "united kingdom",
        settings: { jobspyResultsWanted: "25" },
      }),
    );

    delete process.env.INTERNAL_SYNC_SECRET;
    const unconfigured = await fetch(`${baseUrl}/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "linkedin" }),
    });
    expect(unconfigured.status).toBe(403);
  });
});
