/**
 * Durable Object Express server entrypoint.
 *
 * Bundled to `dist/do/do-entry.mjs` for execution inside Cloudflare Workers /
 * Durable Objects via `cloudflare:node`'s `handleAsNodeRequest`.
 */

import { createServer, type Server } from "node:http";
import type { Express } from "express";
import adzunaManifest from "../../../extractors/adzuna/manifest";
import fiveamsatManifest from "../../../extractors/fiveamsat/manifest";
import freehireManifest from "../../../extractors/freehire/src/manifest";
import golangjobsManifest from "../../../extractors/golangjobs/src/manifest";
import gradcrackerManifest from "../../../extractors/gradcracker/manifest";
import hiringcafeManifest from "../../../extractors/hiringcafe/manifest";
import jobindexManifest from "../../../extractors/jobindex/src/manifest";
import jobspyManifest from "../../../extractors/jobspy/manifest";
import naukriManifest from "../../../extractors/naukri/manifest";
import seekManifest from "../../../extractors/seek/manifest";
import startupjobsManifest from "../../../extractors/startupjobs/src/manifest";
import ukvisajobsManifest from "../../../extractors/ukvisajobs/manifest";
import wazzufManifest from "../../../extractors/wazzuf/manifest";
import workingnomadsManifest from "../../../extractors/workingnomads/src/manifest";
import { createApp } from "./app";
import { createDurableObjectDrizzleDb, type DurableObjectStorageLike, setDb } from "./db/index";
import {
  type DoSqlStorageLike,
  type PortableMigrationResult,
  runPortableMigrations,
} from "./db/portable-migrations";
import { reconcileLegacyDoSchema } from "./db/reconcile-legacy-do-schema";
import { initializeExtractorRegistry, setStaticExtractorManifests } from "./extractors/registry";
import { R2BlobStore, type R2BucketLike, setBlobStore } from "./infra/blob-store";
import {
  handleDurableObjectTaskDone,
  type OnTaskDonePayload,
  type OnTaskDonePosting,
  type OnTaskDoneResult,
} from "./services/do-on-task-done";

import { type RemotePdfRenderer, setRemotePdfRenderer } from "./services/pdf";
import {
  type CareersBrowserLauncher,
  setCareersBrowserLauncher,
} from "./watchlist/careers-site/fetch";

export type { OnTaskDonePayload, OnTaskDonePosting, OnTaskDoneResult, PortableMigrationResult };
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
  fiveamsatManifest,
  freehireManifest,
  golangjobsManifest,
  gradcrackerManifest,
  hiringcafeManifest,
  jobindexManifest,
  jobspyManifest,
  naukriManifest,
  seekManifest,
  startupjobsManifest,
  ukvisajobsManifest,
  wazzufManifest,
  workingnomadsManifest,
];

export interface DurableObjectExpressServerOptions {
  storage: DurableObjectStorageLike;
  r2Bucket?: R2BucketLike | null;
  env?: Record<string, unknown>;
  port?: number;
  remoteRenderPdf?: RemotePdfRenderer;
  /** Launches a Cloudflare Browser Run session for rendered careers-site crawling. */
  browserLauncher?: CareersBrowserLauncher;
}

export interface DurableObjectExpressServer {
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
  setCareersBrowserLauncher(options.browserLauncher ?? null);
  setDb(createDurableObjectDrizzleDb(options.storage));

  if (options.r2Bucket) {
    setBlobStore(new R2BlobStore(options.r2Bucket));
  }

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
