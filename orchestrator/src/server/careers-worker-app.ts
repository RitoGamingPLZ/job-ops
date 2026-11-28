import { notFound } from "@infra/errors";
import { apiErrorHandler, requestContextMiddleware } from "@infra/http";
import { logger } from "@infra/logger";
import { securityHeadersMiddleware } from "@infra/security-headers";
import express from "express";
import { internalCareersSiteRouter } from "./api/routes/internal-careers-site";

/**
 * Minimal Express app for the Cloudflare careers-site container.
 * Learning and crawling a careers site is stateless (the caller sends the recipe and LLM
 * connection and stores the result), so this skips database initialization, migrations, extractor
 * discovery and background schedulers. It idles at a fraction of the full server's memory and is
 * ready in about a second.
 */
export function createCareersWorkerApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeadersMiddleware);
  app.use(requestContextMiddleware());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const level = req.path === "/health" ? "debug" : "info";
      logger[level]("HTTP request completed", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/internal/careers-site", internalCareersSiteRouter);

  app.use((req, _res, next) => {
    next(notFound(`Route not found: ${req.method} ${req.path}`));
  });
  app.use(apiErrorHandler);

  return app;
}
