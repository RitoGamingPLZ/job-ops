/**
 * Durable Object Express server entrypoint.
 *
 * Bundled to `dist/do/do-entry.mjs` for execution inside Cloudflare Workers /
 * Durable Objects via `cloudflare:node`'s `handleAsNodeRequest`.
 */

import { createServer, type Server } from "node:http";
import type { Express } from "express";
import { createApp } from "./app";
import {
  createDurableObjectDrizzleDb,
  type DurableObjectStorageLike,
  setDb,
} from "./db/index";
import {
  R2BlobStore,
  type R2BucketLike,
  setBlobStore,
} from "./infra/blob-store";

export interface DurableObjectExpressServerOptions {
  storage: DurableObjectStorageLike;
  r2Bucket?: R2BucketLike | null;
  env?: Record<string, unknown>;
  port?: number;
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

  setDb(createDurableObjectDrizzleDb(options.storage));

  if (options.r2Bucket) {
    setBlobStore(new R2BlobStore(options.r2Bucket));
  }

  if (activeServer) {
    return activeServer;
  }

  const app = createApp();
  const server = createServer(app);
  server.listen(options.port ?? 3001);

  activeServer = { app, server };
  return activeServer;
}
