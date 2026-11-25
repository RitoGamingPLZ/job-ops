import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

// Mock the design resume status lookup
vi.mock("@server/services/design-resume", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, getDesignResumeStatus: vi.fn() };
});

// Mock the profile service
vi.mock("@server/services/profile", () => ({
  getProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import { getProfile } from "@server/services/profile";
import { getDesignResumeStatus } from "@server/services/design-resume";

describe("Profile API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  describe("GET /api/profile/projects", () => {
    it("returns projects when profile is configured", async () => {
      const mockProfile = {
        sections: {
          projects: {
            items: [
              {
                id: "proj1",
                name: "Project 1",
                description: "Desc 1",
                summary: "Summary 1",
                date: "2024",
                visible: true,
              },
              {
                id: "proj2",
                name: "Project 2",
                description: "Desc 2",
                summary: "Summary 2",
                date: "2023",
                visible: false,
              },
            ],
          },
        },
      };
      vi.mocked(getProfile).mockResolvedValue(mockProfile);

      const res = await fetch(`${baseUrl}/api/profile/projects`);
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(2);
    });

    it("returns error when profile is not configured", async () => {
      vi.mocked(getProfile).mockRejectedValue(new Error("Base resume not configured."));

      const res = await fetch(`${baseUrl}/api/profile/projects`);
      const body = await res.json();

      expect(res.ok).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain("Base resume not configured");
    });

    it("returns demo project catalog in demo mode", async () => {
      const demoServer = await startServer({
        env: {
          DEMO_MODE: "true",
          BASIC_AUTH_USER: "",
          BASIC_AUTH_PASSWORD: "",
        },
      });
      try {
        vi.mocked(getProfile).mockRejectedValue(new Error("should not be used"));

        const res = await fetch(`${demoServer.baseUrl}/api/profile/projects`);
        const body = await res.json();

        expect(res.ok).toBe(true);
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.data[0]).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
        });
      } finally {
        await stopServer(demoServer);
      }
    });
  });

  describe("GET /api/profile", () => {
    it("returns full profile when configured", async () => {
      const mockProfile = {
        basics: { name: "Test User", headline: "Developer" },
        sections: { summary: { content: "A summary" } },
      };
      vi.mocked(getProfile).mockResolvedValue(mockProfile);

      const res = await fetch(`${baseUrl}/api/profile`);
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data).toEqual(mockProfile);
    });

    it("returns error when profile is not configured", async () => {
      vi.mocked(getProfile).mockRejectedValue(new Error("Base resume not configured."));

      const res = await fetch(`${baseUrl}/api/profile`);
      const body = await res.json();

      expect(res.ok).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain("Base resume not configured");
    });
  });

  describe("GET /api/profile/status", () => {
    it("returns exists: false when no base resume has been imported", async () => {
      vi.mocked(getDesignResumeStatus).mockResolvedValue({
        exists: false,
        documentId: null,
        updatedAt: null,
      });

      const res = await fetch(`${baseUrl}/api/profile/status`);
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.data.exists).toBe(false);
      expect(body.data.error).toContain("No base resume imported yet");
    });

    it("returns exists: true when a base resume is stored", async () => {
      vi.mocked(getDesignResumeStatus).mockResolvedValue({
        exists: true,
        documentId: "primary",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const res = await fetch(`${baseUrl}/api/profile/status`);
      const body = await res.json();

      expect(res.ok).toBe(true);
      expect(body.data.exists).toBe(true);
      expect(body.data.error).toBeNull();
    });
  });

  // Note: POST /api/profile/refresh tests skipped because basic auth blocks POST in test environment
  // The endpoint is tested indirectly through the profile service tests
});
