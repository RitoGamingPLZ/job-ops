import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { vi } from "vitest";
import { runLegacyUpgrade } from "../db/legacy-upgrade";
import { runPortableMigrations } from "../db/portable-migrations";

export function useSqliteTestDb(env: Record<string, string> = {}) {
  let template: Buffer | undefined;
  let cleanup: (() => Promise<void>) | undefined;

  return {
    async open() {
      vi.resetModules();
      const tempDir = await mkdtemp(join(tmpdir(), "job-ops-repository-test-"));
      const originalEnv = process.env;
      process.env = { ...originalEnv, DATA_DIR: tempDir, NODE_ENV: "test", ...env };
      let closeDb: (() => void) | undefined;
      cleanup = async () => {
        try {
          closeDb?.();
        } finally {
          process.env = originalEnv;
          await rm(tempDir, { recursive: true, force: true });
        }
      };

      if (!template) {
        const sqlite = new Database(":memory:");
        try {
          runLegacyUpgrade(sqlite);
          runPortableMigrations(sqlite);
          template = sqlite.serialize();
        } finally {
          sqlite.close();
        }
      }

      await writeFile(join(tempDir, "jobs.db"), template);
      const database = await import("../db/index");
      closeDb = database.closeDb;
      return database;
    },
    async close() {
      await cleanup?.();
      cleanup = undefined;
    },
  };
}
