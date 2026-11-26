import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { parseAndVerifyBackupSnapshot } from "@server/services/backup/snapshot";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe("Backup API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  describe("GET /api/backups", () => {
    it("should return empty array and storage info when no backups exist", async () => {
      const res = await fetch(`${baseUrl}/api/backups`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.backups).toEqual([]);
      expect(body.data.nextScheduled).toBeNull();
      expect(body.data.storage).toEqual({
        kind: "local",
        label: "Local data storage (backups/)",
      });
    });

    it("should list backups with metadata", async () => {
      await fetch(`${baseUrl}/api/backups`, { method: "POST" });

      const res = await fetch(`${baseUrl}/api/backups`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.backups).toHaveLength(1);
      expect(body.data.backups[0]).toHaveProperty("filename");
      expect(body.data.backups[0]).toHaveProperty("type", "manual");
      expect(body.data.backups[0]).toHaveProperty("size");
      expect(body.data.backups[0]).toHaveProperty("createdAt");
    });
  });

  describe("POST /api/backups", () => {
    it("should create a manual backup under backups/ and not in DATA_DIR root", async () => {
      const res = await fetch(`${baseUrl}/api/backups`, { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.type).toBe("manual");
      expect(body.data.filename).toMatch(
        /^jobs_manual_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.json\.gz$/,
      );
      expect(body.data.size).toBeGreaterThan(0);

      expect(fs.existsSync(path.join(tempDir, body.data.filename))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "backups", body.data.filename))).toBe(true);
    });

    it("should return error if database is unavailable", async () => {
      closeDb();
      await fs.promises.unlink(`${tempDir}/jobs.db`);

      const res = await fetch(`${baseUrl}/api/backups`, { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain("Database is not available");
    });
  });

  describe("GET /api/backups/:filename/download", () => {
    it("should download a valid gzipped snapshot matching live DB data", async () => {
      const createRes = await fetch(`${baseUrl}/api/backups`, { method: "POST" });
      const createBody = await createRes.json();
      const filename = createBody.data.filename as string;

      const downloadRes = await fetch(`${baseUrl}/api/backups/${filename}/download`);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-type")).toBe("application/gzip");
      expect(downloadRes.headers.get("content-disposition")).toBe(
        `attachment; filename="${filename}"`,
      );
      expect(downloadRes.headers.get("cache-control")).toBe("no-store");
      expect(downloadRes.headers.get("x-content-type-options")).toBe("nosniff");

      const bytes = new Uint8Array(await downloadRes.arrayBuffer());
      const snapshot = parseAndVerifyBackupSnapshot(bytes);
      expect(snapshot.format).toBe("job-ops-backup");
      expect(snapshot.type).toBe("manual");
      expect(Array.isArray(snapshot.tables.users)).toBe(true);
    });

    it("should return 404 for non-existent backup and 400 for invalid filename", async () => {
      const missingRes = await fetch(`${baseUrl}/api/backups/jobs_2026_01_01.json.gz/download`);
      const missingBody = await missingRes.json();
      expect(missingRes.status).toBe(404);
      expect(missingBody.ok).toBe(false);

      const invalidRes = await fetch(`${baseUrl}/api/backups/invalid_filename.txt/download`);
      const invalidBody = await invalidRes.json();
      expect(invalidRes.status).toBe(400);
      expect(invalidBody.ok).toBe(false);
      expect(invalidBody.error.message).toContain("Invalid");
    });
  });

  describe("DELETE /api/backups/:filename", () => {
    it("should delete a backup", async () => {
      const createRes = await fetch(`${baseUrl}/api/backups`, {
        method: "POST",
      });
      const createBody = await createRes.json();
      const filename = createBody.data.filename;

      const deleteRes = await fetch(`${baseUrl}/api/backups/${filename}`, {
        method: "DELETE",
      });
      const deleteBody = await deleteRes.json();

      expect(deleteRes.status).toBe(200);
      expect(deleteBody.ok).toBe(true);
      expect(deleteBody.data.message).toContain("deleted successfully");

      const listRes = await fetch(`${baseUrl}/api/backups`);
      const listBody = await listRes.json();
      expect(listBody.data.backups).toHaveLength(0);
    });

    it("should return 404 for non-existent backup", async () => {
      const res = await fetch(`${baseUrl}/api/backups/jobs_2026_01_01.json.gz`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain("not found");
    });

    it("should return 400 for invalid filename", async () => {
      const res = await fetch(`${baseUrl}/api/backups/invalid_filename.txt`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error.message).toContain("Invalid");
    });
  });

  describe("demo mode restrictions", () => {
    it("blocks creating, downloading, and deleting backups in demo mode", async () => {
      const demoServer = await startServer({ env: { DEMO_MODE: "true" } });
      try {
        const postRes = await fetch(`${demoServer.baseUrl}/api/backups`, { method: "POST" });
        expect(postRes.status).toBe(403);

        const downloadRes = await fetch(
          `${demoServer.baseUrl}/api/backups/jobs_2026_01_01.json.gz/download`,
        );
        expect(downloadRes.status).toBe(403);

        const deleteRes = await fetch(`${demoServer.baseUrl}/api/backups/jobs_2026_01_01.json.gz`, {
          method: "DELETE",
        });
        expect(deleteRes.status).toBe(403);
      } finally {
        await stopServer(demoServer);
      }
    });
  });
});
