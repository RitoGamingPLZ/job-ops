/**
 * Durable Object Express server entrypoint.
 *
 * Bundled to `dist/do/do-entry.mjs` for execution inside Cloudflare Workers /
 * Durable Objects via `cloudflare:node`'s `handleAsNodeRequest`.
 */

import { createServer, type Server } from "node:http";
import type { Express } from "express";
import adzunaManifest from "../../../extractors/adzuna/manifest";
import freehireManifest from "../../../extractors/freehire/src/manifest";
import hiringcafeManifest from "../../../extractors/hiringcafe/manifest";
import jobindexManifest from "../../../extractors/jobindex/src/manifest";
import jobspyManifest from "../../../extractors/jobspy/manifest";
import { createApp } from "./app";
import { createDurableObjectDrizzleDb, type DurableObjectStorageLike, setDb } from "./db/index";
import {
  type DoSqlStorageLike,
  type PortableMigrationResult,
  runPortableMigrations,
} from "./db/portable-migrations";
import { reconcileLegacyDoSchema } from "./db/reconcile-legacy-do-schema";
import { initializeExtractorRegistry, setStaticExtractorManifests } from "./extractors/registry";
import {
  type RemoteContainerExtractorRequest,
  type RemoteContainerExtractorRunner,
  setRemoteContainerExtractorRunner,
} from "./extractors/remote-container-runner";
import { R2BlobStore, type R2BucketLike, setBlobStore } from "./infra/blob-store";
import { setBackupBlobStore } from "./services/backup/index";
import {
  handleDurableObjectTaskDone,
  type OnTaskDonePayload,
  type OnTaskDonePosting,
  type OnTaskDoneResult,
} from "./services/do-on-task-done";
import { type RemotePdfRenderer, setRemotePdfRenderer } from "./services/pdf";
import { type RemotePdfWarmer, setRemotePdfWarmer } from "./services/pdf-warmer";
import {
  type RemoteCareersSiteRunner,
  setRemoteCareersSiteRunner,
} from "./watchlist/careers-site/remote";

export type {
  OnTaskDonePayload,
  OnTaskDonePosting,
  OnTaskDoneResult,
  PortableMigrationResult,
  RemoteContainerExtractorRequest,
  RemoteContainerExtractorRunner,
};
export { handleDurableObjectTaskDone, runPortableMigrations };

/**
 * Runs ordered app SQLite migrations against a Cloudflare Durable Object's storage.
 */
export function runDurableObjectMigrations(
  storage: DurableObjectStorageLike,
): PortableMigrationResult {
  reconcileLegacyDoSchema(storage.sql as DoSqlStorageLike);
  return runPortableMigrations(storage.sql as DoSqlStorageLike);
}

const STATIC_EXTRACTOR_MANIFESTS = [
  adzunaManifest,
  freehireManifest,
  hiringcafeManifest,
  jobindexManifest,
  jobspyManifest,
];

export interface DurableObjectExpressServerOptions {
  storage: DurableObjectStorageLike;
  r2Bucket?: R2BucketLike | null;
  backupR2Bucket?: R2BucketLike | null;
  env?: Record<string, unknown>;
  port?: number;
  remoteRenderPdf?: RemotePdfRenderer;
  remoteWarmPdf?: RemotePdfWarmer;
  remoteRunContainerExtractor?: RemoteContainerExtractorRunner;
  remoteCareersSite?: RemoteCareersSiteRunner;
}

interface DurableObjectExpressServer {
  app: Express;
  server: Server;
}

let activeServer: DurableObjectExpressServer | null = null;

/**
 * Configures Drizzle (Durable Object SQLite) + R2 BlobStore + Express on the
 * given port so `handleAsNodeRequest(port, request, env, ctx)` can dispatch
 * incoming HTTP requests directly to Express inside the Durable Object.
 */
export function createDurableObjectExpressServer(
  options: DurableObjectExpressServerOptions,
): DurableObjectExpressServer {
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (typeof value === "string" && process.env[key] !== value) {
        process.env[key] = value;
      }
    }
  }

  setRemotePdfRenderer(options.remoteRenderPdf ?? null);
  setRemotePdfWarmer(options.remoteWarmPdf ?? null);
  setRemoteContainerExtractorRunner(options.remoteRunContainerExtractor ?? null);
  setRemoteCareersSiteRunner(options.remoteCareersSite ?? null);
  setDb(createDurableObjectDrizzleDb(options.storage));

  if (options.r2Bucket) {
    setBlobStore(new R2BlobStore(options.r2Bucket));
  }

  setBackupBlobStore(
    options.backupR2Bucket ? new R2BlobStore(options.backupR2Bucket) : null,
    options.backupR2Bucket ? { kind: "r2", label: "Dedicated R2 backup bucket (backups/)" } : null,
  );

  setStaticExtractorManifests(STATIC_EXTRACTOR_MANIFESTS);
  void initializeExtractorRegistry();

  if (activeServer) {
    return activeServer;
  }

  const app = createApp();
  const server = createServer(app);
  server.listen(options.port ?? 3001);

  activeServer = { app, server };
  return activeServer;
}
