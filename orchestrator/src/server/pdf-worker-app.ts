import { notFound } from "@infra/errors";
import { apiErrorHandler, requestContextMiddleware } from "@infra/http";
import { logger } from "@infra/logger";
import { securityHeadersMiddleware } from "@infra/security-headers";
import express from "express";
import { internalRenderPdfRouter } from "./api/routes/internal-render-pdf";

/**
 * Minimal Express app for the Cloudflare PDF render container.
 * Skips database initialization, extractor discovery, and background schedulers
 * so cold-start readiness takes milliseconds instead of tens of seconds.
 */
export function createPdfWorkerApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeadersMiddleware);
  app.use(requestContextMiddleware());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const level = req.path === "/health" ? "debug" : "info";
      logger[level]("HTTP request completed", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/internal/render-pdf", internalRenderPdfRouter);

  app.use((req, _res, next) => {
    next(notFound(`Route not found: ${req.method} ${req.path}`));
  });
  app.use(apiErrorHandler);

  return app;
}
