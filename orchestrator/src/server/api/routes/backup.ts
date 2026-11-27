import { requireSystemAdmin } from "../require-admin";
import { badRequest, conflict, notFound, unprocessableEntity } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import {
  BackupRestoreInProgressError,
  createBackup,
  deleteBackup,
  getBackupStorageInfo,
  getNextBackupTime,
  hydrateBackupSettingsFromDb,
  isValidBackupFilename,
  listBackups,
  readBackup,
  restoreBackup,
} from "@server/services/backup/index";
import { type Request, type Response, Router } from "express";

export const backupRouter = Router();

function normalizeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * GET /api/backups - List all backups with metadata
 */
backupRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    if (!requireSystemAdmin(res)) return;
    try {
      await hydrateBackupSettingsFromDb({ startScheduler: false });
      const backups = await listBackups();
      const nextScheduled = getNextBackupTime();
      const storage = getBackupStorageInfo();
      ok(res, { backups, nextScheduled, storage });
    } catch (error) {
      logger.error("Failed to list backups", {
        route: "GET /api/backups",
        error: sanitizeUnknown(error),
      });
      throw error;
    }
  }),
);

/**
 * POST /api/backups - Create a manual backup
 */
backupRouter.post(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    if (!requireSystemAdmin(res)) return;
    try {
      if (isDemoMode()) {
        return sendDemoBlocked(res, "Manual backup creation is disabled in the public demo.", {
          route: "POST /api/backups",
        });
      }

      const filename = await createBackup("manual");
      const backups = await listBackups();
      const backup = backups.find((b) => b.filename === filename);

      if (!backup) {
        throw new Error("Backup was created but not found in list");
      }

      ok(res, backup);
    } catch (error) {
      logger.error("Failed to create backup", {
        route: "POST /api/backups",
        error: sanitizeUnknown(error),
      });
      throw error;
    }
  }),
);

/**
 * GET /api/backups/:filename/download - Download a backup archive
 */
backupRouter.get(
  "/:filename/download",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireSystemAdmin(res)) return;

    const filename = normalizeParam(req.params.filename);
    if (isDemoMode()) {
      return sendDemoBlocked(res, "Downloading backups is disabled in the public demo.", {
        route: "GET /api/backups/:filename/download",
        filename,
      });
    }

    if (!filename || !isValidBackupFilename(filename)) {
      fail(res, badRequest("Invalid backup filename"));
      return;
    }

    try {
      const backup = await readBackup(filename);
      if (!backup) {
        fail(res, notFound(`Backup not found: ${filename}`));
        return;
      }

      res.setHeader("Content-Type", backup.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${backup.filename}"`);
      res.setHeader("Content-Length", String(backup.size));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(Buffer.from(backup.body));
    } catch (error) {
      logger.error("Failed to download backup", {
        route: "GET /api/backups/:filename/download",
        filename,
        error: sanitizeUnknown(error),
      });
      throw error;
    }
  }),
);

/**
 * POST /api/backups/:filename/restore - Replace the database contents with a backup.
 * All other write requests are rejected with 503 until it finishes.
 */
backupRouter.post(
  "/:filename/restore",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireSystemAdmin(res)) return;
    const filename = normalizeParam(req.params.filename);
    if (isDemoMode()) {
      return sendDemoBlocked(res, "Restoring backups is disabled in the public demo.", {
        route: "POST /api/backups/:filename/restore",
        filename,
      });
    }

    if (!filename || !isValidBackupFilename(filename)) {
      fail(res, badRequest("Invalid backup filename"));
      return;
    }

    try {
      const result = await restoreBackup(filename);
      ok(res, { message: `Restored database from ${filename}`, ...result });
    } catch (error) {
      logger.error("Failed to restore backup", {
        route: "POST /api/backups/:filename/restore",
        filename,
        error: sanitizeUnknown(error),
      });

      if (error instanceof BackupRestoreInProgressError) {
        fail(res, conflict(error.message));
        return;
      }
      const message = error instanceof Error ? error.message : "";
      if (message.includes("not found")) {
        fail(res, notFound(message));
        return;
      }
      if (
        message.startsWith("Failed to decompress") ||
        message.includes("checksum") ||
        message.includes("mismatch") ||
        message.startsWith("Unsupported backup") ||
        message.startsWith("Invalid") ||
        message.startsWith("Backup ") ||
        message.includes("newer version") ||
        message.includes("Legacy")
      ) {
        fail(res, unprocessableEntity(message));
        return;
      }
      throw error;
    }
  }),
);

/**
 * DELETE /api/backups/:filename - Delete a specific backup
 */
backupRouter.delete(
  "/:filename",
  asyncRoute(async (req: Request, res: Response) => {
    if (!requireSystemAdmin(res)) return;
    const filename = normalizeParam(req.params.filename);
    try {
      if (isDemoMode()) {
        return sendDemoBlocked(res, "Deleting backups is disabled in the public demo.", {
          route: "DELETE /api/backups/:filename",
          filename,
        });
      }

      if (!filename) {
        fail(res, badRequest("Filename is required"));
        return;
      }

      await deleteBackup(filename);
      ok(res, { message: `Backup ${filename} deleted successfully` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to delete backup", {
        route: "DELETE /api/backups/:filename",
        filename,
        error: sanitizeUnknown(error),
      });

      if (message.includes("not found")) {
        fail(res, notFound(message));
        return;
      }
      if (message.includes("Invalid")) {
        fail(res, badRequest(message));
        return;
      }
      throw error;
    }
  }),
);
