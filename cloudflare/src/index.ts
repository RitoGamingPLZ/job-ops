import { AppStore } from "./app-store";
import { ScrapeCoordinatorDO, ScraperContainer } from "./scrape-coordinator";
import type { Env } from "./types";
import { constantTimeEqual, getBearerToken, jsonError, normalizePath } from "./utils";

export { AppStore, ScrapeCoordinatorDO, ScraperContainer };
export type { Env };

function isWriteFrozen(env: Env): boolean {
  return env.WRITE_FREEZE?.trim() === "1";
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const secret = (env.CRON_SECRET || env.WEBHOOK_SECRET || env.INTERNAL_SYNC_SECRET)?.trim();
  if (!secret) return false;
  const provided = getBearerToken(request);
  return constantTimeEqual(provided, secret);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let normalizedPath: string;
    try {
      normalizedPath = normalizePath(url.pathname);
    } catch {
      return jsonError(request, "INVALID_REQUEST", "Malformed URL path", { status: 400 });
    }

    // Lightweight Worker-level liveness endpoint (does not wake any DO).
    if (normalizedPath === "/_cf/health") {
      return Response.json({
        ok: true,
        data: {
          service: "job-ops-worker",
          status: "ok",
          writeFreeze: isWriteFrozen(env),
        },
      });
    }

    // Block external access to internal sync routes.
    if (normalizedPath === "/api/internal" || normalizedPath.startsWith("/api/internal/")) {
      return jsonError(request, "FORBIDDEN", "Forbidden", { status: 403 });
    }

    // AppStore DO export/import/on-task-done routes (authenticated).
    if (normalizedPath.startsWith("/_cf/do/")) {
      if (!isAuthorizedAdmin(request, env)) {
        return jsonError(request, "UNAUTHORIZED", "Unauthorized", { status: 401 });
      }
      if (!env.APP_STORE) {
        return jsonError(
          request,
          "SERVICE_UNAVAILABLE",
          "APP_STORE Durable Object binding is not configured.",
          { status: 503 },
        );
      }
      return env.APP_STORE.getByName("primary").fetch(request);
    }

    // ScrapeCoordinator DO routes (authenticated).
    if (normalizedPath.startsWith("/_cf/scrape/")) {
      if (!isAuthorizedAdmin(request, env)) {
        return jsonError(request, "UNAUTHORIZED", "Unauthorized", { status: 401 });
      }
      if (!env.SCRAPE_COORDINATOR) {
        return jsonError(
          request,
          "SERVICE_UNAVAILABLE",
          "SCRAPE_COORDINATOR Durable Object binding is not configured.",
          { status: 503 },
        );
      }
      return env.SCRAPE_COORDINATOR.getByName("primary").fetch(request);
    }

    // Enforce WRITE_FREEZE=1 on mutating /api/* requests during maintenance.
    const method = request.method.toUpperCase();
    if (
      isWriteFrozen(env) &&
      (normalizedPath === "/api" || normalizedPath.startsWith("/api/")) &&
      (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
    ) {
      return jsonError(
        request,
        "SERVICE_UNAVAILABLE",
        "Database is temporarily in read-only maintenance mode (WRITE_FREEZE=1).",
        {
          status: 503,
          headers: { "retry-after": "30" },
        },
      );
    }

    const isApiOrServerRoute =
      normalizedPath === "/api" ||
      normalizedPath.startsWith("/api/") ||
      normalizedPath === "/health" ||
      normalizedPath === "/.well-known/ojcp.json" ||
      normalizedPath === "/ojcp" ||
      normalizedPath.startsWith("/ojcp/") ||
      normalizedPath === "/challenge-viewer" ||
      normalizedPath.startsWith("/challenge-viewer/") ||
      normalizedPath === "/stats" ||
      normalizedPath.startsWith("/stats/") ||
      normalizedPath.startsWith("/pdfs/");

    if (isApiOrServerRoute) {
      if (!env.APP_STORE) {
        return jsonError(
          request,
          "SERVICE_UNAVAILABLE",
          "APP_STORE Durable Object binding is not configured.",
          { status: 503 },
        );
      }
      return env.APP_STORE.getByName("primary").fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (env.APP_STORE) {
      return env.APP_STORE.getByName("primary").fetch(request);
    }

    return jsonError(
      request,
      "SERVICE_UNAVAILABLE",
      "Neither ASSETS nor APP_STORE is configured.",
      { status: 503 },
    );
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.APP_STORE) {
      console.error("Scheduled cron tick skipped: APP_STORE binding is missing.");
      return;
    }
    const targetStub = env.APP_STORE.getByName("primary");
    const secret = (env.CRON_SECRET || env.WEBHOOK_SECRET)?.trim();
    const request = new Request("http://app-store/api/webhook/cron", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        scheduledTime: controller.scheduledTime,
        cron: controller.cron,
      }),
    });

    ctx.waitUntil(
      targetStub
        .fetch(request)
        .then(async (response) => {
          await response.body?.cancel();
          if (!response.ok) {
            console.error(`Scheduled cron tick failed with HTTP ${response.status}`);
          }
        })
        .catch((error: unknown) => {
          console.error("Scheduled cron tick error:", error);
        }),
    );
  },
} satisfies ExportedHandler<Env>;
