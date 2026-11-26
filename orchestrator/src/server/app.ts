/**
 * Express app factory (useful for tests).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { forbidden, unauthorized } from "@infra/errors";
import { apiErrorHandler, fail, notFoundApiHandler, requestContextMiddleware } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { verifyToken } from "@server/auth/jwt";
import { getJobOpsAppConfig } from "@server/config/app-mode";
import { isDemoMode } from "@server/config/demo";
import { getBlobStore } from "@server/infra/blob-store";
import * as usersRepo from "@server/repositories/users";
import { proxyChallengeViewerRequest } from "@server/services/challenge-viewer";
import { getActivePdfKeyPrefix } from "@server/services/pdf-storage";
import { isOperatorContext } from "@server/services/server-credentials";
import { currentUserHasPermission } from "@server/services/user-permissions";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import { corsDelegate } from "@infra/cors-policy";
import { securityHeadersMiddleware } from "@infra/security-headers";
import cors from "cors";
import express from "express";
import { apiRouter } from "./api/index";
import { internalScrapeRouter } from "./api/routes/internal-scrape";
import { internalCareersSiteRouter } from "./api/routes/internal-careers-site";
import { internalRenderPdfRouter } from "./api/routes/internal-render-pdf";
import { ojcpManifestHandler, ojcpMcpHandler } from "./ojcp";

const __dirname =
  typeof import.meta.url === "string" && import.meta.url.startsWith("file:")
    ? dirname(fileURLToPath(import.meta.url))
    : process.cwd();
const UMAMI_UPSTREAM_ORIGIN = "https://umami.dakheera47.com";
const UMAMI_PROXY_TIMEOUT_MS = 5_000;
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const REQUEST_HEADERS_TO_SKIP = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "transfer-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-forwarded-server",
]);
const ALLOWED_UMAMI_PROXY_PATHS = new Set(["/script.js", "/api/send"]);
const ALLOWED_UMAMI_PROXY_METHODS = new Map<string, string[]>([
  ["/script.js", ["GET", "HEAD"]],
  ["/api/send", ["POST"]],
]);
const ANALYTICS_DISABLED_TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const UMAMI_SCRIPT_PATTERN =
  /\s*<script\b[^>]*\ssrc\s*=\s*["']https:\/\/umami\.dakheera47\.com\/script\.js["'][^>]*>\s*<\/script>/gi;
const OPENPANEL_SCRIPT_PATTERN =
  /\s*<script>\s*window\.op =[\s\S]*?window\.op\("init", \{[\s\S]*?\n\s*}\);\s*<\/script>\s*<script src="https:\/\/openpanel\.dev\/op1\.js" defer async><\/script>/;

/** The public OJCP job-search endpoint is opt-in; it is off unless the operator enables it. */
function isOjcpEnabled(): boolean {
  const normalized = process.env.OJCP_ENABLED?.trim().toLowerCase();
  return normalized ? ANALYTICS_DISABLED_TRUTHY_VALUES.has(normalized) : false;
}

function isStatsRoute(path: string): boolean {
  return path === "/stats" || path.startsWith("/stats/");
}

function isAnalyticsDisabled(): boolean {
  const normalized = process.env.JOBOPS_DISABLE_ANALYTICS?.trim().toLowerCase();
  return normalized ? ANALYTICS_DISABLED_TRUTHY_VALUES.has(normalized) : false;
}

function renderHtmlWithAnalyticsConfig(html: string): string {
  if (!isAnalyticsDisabled()) return html;
  const withoutAnalytics = html
    .replace(UMAMI_SCRIPT_PATTERN, "")
    .replace(OPENPANEL_SCRIPT_PATTERN, "");
  if (!withoutAnalytics.includes("</head>")) return withoutAnalytics;
  return withoutAnalytics.replace(
    "</head>",
    "    <script>window.__JOBOPS_ANALYTICS_DISABLED__=true;</script>\n  </head>",
  );
}

function getUmamiUpstreamUrl(originalUrl: string): URL {
  const incomingUrl = new URL(originalUrl, "http://localhost");
  const upstreamUrl = new URL(UMAMI_UPSTREAM_ORIGIN);
  upstreamUrl.pathname = incomingUrl.pathname.replace(/^\/stats/, "") || "/";
  upstreamUrl.search = incomingUrl.search;
  return upstreamUrl;
}

function isAllowedUmamiProxyPath(pathname: string): boolean {
  return ALLOWED_UMAMI_PROXY_PATHS.has(pathname);
}

function getAllowedUmamiMethods(pathname: string): string[] {
  return ALLOWED_UMAMI_PROXY_METHODS.get(pathname) ?? [];
}

function isAllowedUmamiMethod(method: string, pathname: string): boolean {
  return getAllowedUmamiMethods(pathname).includes(method.toUpperCase());
}

function isUmamiProxyTimeoutError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function buildUmamiProxyBody(req: express.Request): BodyInit | undefined {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (Buffer.isBuffer(req.body)) return new Uint8Array(req.body);
  if (typeof req.body === "string") return req.body;
  if (req.body === undefined || req.body === null) return undefined;
  if (
    typeof req.body === "object" &&
    Object.keys(req.body as Record<string, unknown>).length === 0
  ) {
    return undefined;
  }
  return JSON.stringify(req.body);
}

function copyUmamiResponseHeaders(upstreamResponse: Response, res: express.Response): void {
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }
}

function buildUmamiProxyHeaders(req: express.Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || REQUEST_HEADERS_TO_SKIP.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

export function createAuthGuard() {
  const testAuthBypassEnabled =
    process.env.NODE_ENV === "test" && process.env.JOBOPS_TEST_AUTH_BYPASS === "1";

  async function getAuthorizationContext(req: express.Request): Promise<{
    userId: string;
    tenantId: string;
    username: string;
    isSystemAdmin: boolean;
  } | null> {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const payload = await verifyToken(token);
      const user = await usersRepo.getUserById(payload.userId);
      const appConfig = getJobOpsAppConfig();
      if (
        !user ||
        user.isDisabled ||
        user.workspaceId !== payload.tenantId ||
        (appConfig.appMode === "hosted" && user.workspaceId !== appConfig.hostedTenantId)
      ) {
        return null;
      }
      return {
        userId: user.id,
        tenantId: user.workspaceId,
        username: user.username,
        isSystemAdmin: user.isSystemAdmin,
      };
    } catch {
      return null;
    }
  }

  function isPublicReadOnlyRoute(method: string, path: string): boolean {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path.split("?")[0] || path;

    // Explicitly allowed public API routes
    if (normalizedPath === "/api/demo/info") return true;
    if (normalizedPath === "/api/app/status") return true;
    if (
      normalizedMethod === "POST" &&
      normalizedPath === "/api/billing/webhook" &&
      getJobOpsAppConfig().appMode === "hosted"
    )
      return true;
    if (normalizedMethod === "POST" && normalizedPath === "/ojcp/mcp") return isOjcpEnabled();
    if (normalizedMethod === "POST" && normalizedPath === "/api/webhook/trigger")
      return Boolean(process.env.WEBHOOK_SECRET?.trim());
    if (normalizedMethod === "POST" && normalizedPath === "/api/webhook/cron")
      return Boolean((process.env.CRON_SECRET || process.env.WEBHOOK_SECRET)?.trim());
    if (normalizedPath.startsWith("/api/internal/d1-sync/")) {
      return Boolean(process.env.INTERNAL_SYNC_SECRET?.trim());
    }
    if (normalizedPath.startsWith("/api/internal/scrape/")) {
      return Boolean((process.env.INTERNAL_SYNC_SECRET || process.env.CRON_SECRET)?.trim());
    }

    // Auth endpoints must be accessible without existing auth.
    if (
      normalizedMethod === "POST" &&
      (normalizedPath === "/api/auth/login" ||
        normalizedPath === "/api/auth/logout" ||
        normalizedPath === "/api/auth/signup" ||
        normalizedPath === "/api/auth/setup")
    )
      return true;
    if (normalizedMethod === "GET" && normalizedPath === "/api/auth/bootstrap-status") return true;
    // Invitation links are bearer secrets: previewing and redeeming one needs no session.
    if (
      normalizedMethod === "GET" &&
      /^\/api\/auth\/invitations\/[a-z0-9_-]+$/.test(normalizedPath)
    )
      return true;
    if (
      normalizedMethod === "POST" &&
      /^\/api\/auth\/invitations\/[a-z0-9_-]+\/accept$/.test(normalizedPath)
    )
      return true;
    if (normalizedMethod === "GET" && normalizedPath === "/api/auth/sso/providers") return true;
    if (
      normalizedMethod === "POST" &&
      /^\/api\/auth\/sso\/(google|github|oidc)\/(start|callback)$/.test(normalizedPath)
    )
      return true;
    if (
      ["GET", "HEAD"].includes(normalizedMethod) &&
      /^\/api\/design-resume\/assets\/[^/]+\/content$/.test(normalizedPath)
    )
      return getJobOpsAppConfig().appMode !== "hosted";

    return false;
  }

  function isProtectedDemoRoute(path: string): boolean {
    const normalizedPath = path.split("?")[0] || path;

    if (normalizedPath === "/api/auth/me") return true;
    // Linking and listing connected accounts act on a real user, so they stay
    // behind auth in demo mode. requiresAuth consults isPublicReadOnlyRoute
    // first, which keeps the sign-in routes reachable.
    if (normalizedPath.startsWith("/api/auth/sso/")) return true;
    if (normalizedPath.startsWith("/api/workspaces")) return true;
    if (normalizedPath === "/api/settings/codex-auth") return true;
    return false;
  }

  function isPublicDemoRoute(path: string): boolean {
    if (!isDemoMode()) return false;

    const normalizedPath = path.split("?")[0] || path;
    if (!normalizedPath.startsWith("/api/")) return false;

    return !isProtectedDemoRoute(normalizedPath);
  }

  function requiresAuth(method: string, path: string): boolean {
    const normalizedPath =
      path
        .split("?")[0]
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase() || "/";

    if (isPublicReadOnlyRoute(method, normalizedPath)) return false;
    if (isPublicDemoRoute(normalizedPath)) return false;
    // OPTIONS is always exempt for CORS preflight.
    if (method.toUpperCase() === "OPTIONS") return false;

    // Umami's public script posts browser beacons to /stats/api/send. The
    // proxy route still validates method/path before forwarding.
    if (isStatsRoute(normalizedPath)) return false;

    // Stored PDFs hold personal resumes: never serve them anonymously.
    if (normalizedPath.startsWith("/pdfs/")) return true;

    // All other /api/* paths require auth regardless of HTTP method.
    if (normalizedPath === "/api" || normalizedPath.startsWith("/api/")) return true;

    // Non-API routes (SPA, /health, static) remain publicly readable via GET/HEAD.
    return !["GET", "HEAD"].includes(method.toUpperCase());
  }

  const middleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    void (async () => {
      if (!requiresAuth(req.method, req.path)) {
        next();
        return;
      }

      if (testAuthBypassEnabled) {
        runWithRequestContext(
          {
            userId: "test-user",
            tenantId: DEFAULT_TENANT_ID,
            username: "test",
            isSystemAdmin: true,
          },
          () => next(),
        );
        return;
      }

      const userCount = await usersRepo.countUsers();
      if (userCount === 0) {
        fail(
          res,
          unauthorized(isDemoMode() ? "Authentication required" : "Initial setup is required"),
        );
        return;
      }

      const authContext = await getAuthorizationContext(req);
      if (authContext) {
        runWithRequestContext(authContext, () => next());
        return;
      }
      fail(res, unauthorized("Authentication required"));
    })().catch(next);
  };

  return {
    middleware,
    getAuthorizationContext,
  };
}

export function createApp() {
  getJobOpsAppConfig();

  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeadersMiddleware);
  const authGuard = createAuthGuard();
  const corsMiddleware = cors(corsDelegate);

  app.use((req, res, next) => {
    if (isStatsRoute(req.path)) {
      next();
      return;
    }
    corsMiddleware(req, res, next);
  });
  app.use(requestContextMiddleware());
  if (getJobOpsAppConfig().appMode === "hosted") {
    app.use("/api/billing/webhook", express.raw({ limit: "1mb", type: "application/json" }));
  }
  app.use("/stats", express.raw({ limit: "1mb", type: "*/*" }));
  app.use(
    "/api/design-resume/assets",
    express.raw({
      limit: "10mb",
      type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"],
    }),
  );
  // Resume file import sends base64 JSON payloads, which expand beyond the raw
  // file size. Scope the larger JSON limit to that endpoint only.
  app.use("/api/design-resume/import/file", express.json({ limit: "15mb" }));
  // Ghostwriter chat can include up to three base64 screenshot attachments, so
  // keep a larger JSON limit scoped to this endpoint to allow the maximum
  // validated payload through to route-level validation.
  app.use("/api/jobs/:id/chat", express.json({ limit: "12mb" }));
  // Container <-> D1 hydration/sync batches can exceed Express's 100kb default.
  app.use("/api/internal/d1-sync", express.json({ limit: "25mb" }));
  // Authorize before parsing; inline pictures need a bounded limit above 100kb.
  // These internal routes use their shared secret instead of end-user sessions.
  app.use("/internal/render-pdf", internalRenderPdfRouter);
  app.use("/internal/careers-site", internalCareersSiteRouter);
  // Internal scraper container pool alias (`POST /scrape` -> `POST /api/internal/scrape/run`)
  app.post("/scrape", express.json({ limit: "2mb" }), (req, res, next) => {
    req.url = "/run";
    internalScrapeRouter(req, res, next);
  });
  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info("HTTP request completed", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      });
    });
    next();
  });

  // Optional authentication for protected routes
  app.use(authGuard.middleware);

  if (isOjcpEnabled()) {
    app.get("/.well-known/ojcp.json", ojcpManifestHandler);
  }
  if (isOjcpEnabled()) {
    app.all("/ojcp/mcp", ojcpMcpHandler);
  }

  // API routes
  app.use("/api", apiRouter);
  app.use(notFoundApiHandler());

  app.get("/challenge-viewer/solved", (_req, res) => {
    res.status(200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Challenge solved · Job Ops</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#4ade80;font-family:system-ui,sans-serif;text-align:center}h1{font-size:2rem;font-weight:600;margin-bottom:.5rem}p{color:#a1a1aa;font-size:1.1rem}</style></head>
<body><main><h1>Challenge solved</h1><p>This tab will close shortly. You can return to Job Ops.</p></main></body></html>`);
  });

  app.use("/challenge-viewer/session", (req, res) => {
    void proxyChallengeViewerRequest(req, res);
  });

  app.all(/^\/stats(?:\/.*)?$/, async (req, res) => {
    if (isAnalyticsDisabled()) {
      res.status(404).type("text/plain; charset=utf-8").send("Not found");
      return;
    }

    const upstreamUrl = getUmamiUpstreamUrl(req.originalUrl);
    if (!isAllowedUmamiProxyPath(upstreamUrl.pathname)) {
      res.status(404).type("text/plain; charset=utf-8").send("Not found");
      return;
    }
    if (!isAllowedUmamiMethod(req.method, upstreamUrl.pathname)) {
      res
        .setHeader("Allow", getAllowedUmamiMethods(upstreamUrl.pathname).join(", "))
        .status(405)
        .type("text/plain; charset=utf-8")
        .send("Method not allowed");
      return;
    }

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: req.method,
        headers: buildUmamiProxyHeaders(req),
        body: buildUmamiProxyBody(req),
        redirect: "manual",
        signal: AbortSignal.timeout(UMAMI_PROXY_TIMEOUT_MS),
      });

      res.status(upstreamResponse.status);
      copyUmamiResponseHeaders(upstreamResponse, res);

      if (req.method === "HEAD") {
        res.end();
        return;
      }
      if (!upstreamResponse.body) {
        res.end();
        return;
      }

      await pipeline(Readable.fromWeb(upstreamResponse.body as NodeReadableStream), res);
    } catch (error) {
      if (isUmamiProxyTimeoutError(error)) {
        logger.warn("Umami proxy timed out", {
          route: req.path,
          method: req.method,
          upstreamUrl: upstreamUrl.toString(),
          requestId: (res.getHeader("x-request-id") as string | undefined) ?? undefined,
        });
        res.status(504).type("text/plain; charset=utf-8").send("Upstream timeout");
        return;
      }

      logger.error("Umami proxy failed", {
        route: req.path,
        method: req.method,
        upstreamUrl: upstreamUrl.toString(),
        requestId: (res.getHeader("x-request-id") as string | undefined) ?? undefined,
        error: sanitizeUnknown(error),
      });
      res.status(502).type("text/plain; charset=utf-8").send("Upstream error");
    }
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Serve generated/uploaded PDFs from the active BlobStore (R2 in DO, local disk otherwise)
  app.get(/^\/pdfs\/(.+)$/, async (req, res, next) => {
    const rawKey = req.params[0] ?? "";
    const normalized = rawKey.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      res.status(400).type("text/plain; charset=utf-8").send("Invalid path");
      return;
    }
    try {
      if (!(await currentUserHasPermission("resumes"))) {
        fail(res, forbidden("This feature is not enabled for your account. Ask an admin."));
        return;
      }
      const key = `pdfs/${normalized}`;
      // Only the caller's own workspace folder is readable; the shared legacy
      // root belongs to the operator.
      const ownFolder = key.startsWith(`${getActivePdfKeyPrefix()}/`);
      const legacyRoot = !normalized.includes("/");
      const allowed =
        ownFolder ||
        (legacyRoot && getJobOpsAppConfig().appMode !== "hosted" && (await isOperatorContext()));
      if (!allowed) {
        next();
        return;
      }
      const blob = await getBlobStore().get(key);
      if (!blob) {
        next();
        return;
      }
      res.setHeader("Content-Type", blob.contentType ?? "application/pdf");
      res.setHeader("Content-Length", String(blob.size));
      res.send(Buffer.from(blob.body));
    } catch (error) {
      next(error);
    }
  });

  // Serve client app in production
  if (process.env.NODE_ENV === "production") {
    const packagedDocsDir = join(__dirname, "../../dist/docs");
    const workspaceDocsDir = join(__dirname, "../../../docs-site/build");
    const docsDir = existsSync(packagedDocsDir) ? packagedDocsDir : workspaceDocsDir;
    const docsIndexPath = join(docsDir, "index.html");
    let cachedDocsIndexHtml: string | null = null;

    if (existsSync(docsIndexPath)) {
      app.use("/docs", express.static(docsDir));
      app.get("/docs/*", async (req, res, next) => {
        if (!req.accepts("html")) {
          next();
          return;
        }
        if (extname(req.path)) {
          next();
          return;
        }
        if (!cachedDocsIndexHtml) {
          cachedDocsIndexHtml = await readFile(docsIndexPath, "utf-8");
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(renderHtmlWithAnalyticsConfig(cachedDocsIndexHtml));
      });
    }

    const clientDir = join(__dirname, "../../dist/client");
    const indexPath = join(clientDir, "index.html");
    let cachedIndexHtml: string | null = null;
    const serveClientHtml = async (req: express.Request, res: express.Response) => {
      if (!req.accepts("html")) {
        res.status(404).end();
        return;
      }
      if (!cachedIndexHtml) {
        cachedIndexHtml = await readFile(indexPath, "utf-8");
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderHtmlWithAnalyticsConfig(cachedIndexHtml));
    };

    // Entry HTML must be rewritten before static middleware can serve it.
    app.get(["/", "/index.html"], serveClientHtml);
    app.use(express.static(clientDir, { index: false }));
    app.get("*", serveClientHtml);
  }

  app.use(apiErrorHandler);

  return app;
}
