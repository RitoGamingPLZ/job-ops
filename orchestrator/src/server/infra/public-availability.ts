import { logger } from "@infra/logger";
import { isLocalOrPrivateHostname } from "@infra/public-hostname";
import { isHttpUrl } from "@infra/url";
import type { JobOpsPublicAvailabilityResponse } from "@shared/types";

const READINESS_TIMEOUT_MS = 5_000;
const READINESS_CACHE_TTL_MS = 5 * 60_000;

type ReadinessCacheEntry = {
  baseUrl: string | null;
  checkedAt: number;
  response: JobOpsPublicAvailabilityResponse;
};

let readinessCache: ReadinessCacheEntry | null = null;
let readinessLastSuccessAt: number | null = null;

function normalizeBaseUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed || !isHttpUrl(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

function resolveReadinessBaseUrl(args: {
  requestOrigin?: string | null;
}): string | null {
  const fromEnv = normalizeBaseUrl(process.env.JOBOPS_PUBLIC_BASE_URL ?? null);
  if (fromEnv) return fromEnv;
  return normalizeBaseUrl(args.requestOrigin);
}

function makePublicAvailabilityResponse(
  status: JobOpsPublicAvailabilityResponse["status"],
  args: {
    baseUrl: string | null;
    checkedAt: number;
    reason: string | null;
  },
): JobOpsPublicAvailabilityResponse {
  return {
    status,
    isPubliclyAvailable: status === "ready",
    publicBaseUrl: args.baseUrl,
    healthUrl: args.baseUrl ? `${args.baseUrl}/health` : null,
    checkedAt: args.checkedAt,
    lastSuccessAt: readinessLastSuccessAt,
    reason: args.reason,
  };
}

async function fetchWithTimeout(
  input: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export function resolvePublicBaseUrl(args: {
  requestOrigin?: string | null;
}): string | null {
  const fromRequest = normalizeBaseUrl(args.requestOrigin);
  if (fromRequest) return fromRequest;
  return normalizeBaseUrl(process.env.JOBOPS_PUBLIC_BASE_URL ?? null);
}

export async function getJobOpsPublicAvailability(
  args: { requestOrigin?: string | null; force?: boolean } = {},
): Promise<JobOpsPublicAvailabilityResponse> {
  const baseUrl = resolveReadinessBaseUrl({
    requestOrigin: args.requestOrigin,
  });
  const checkedAt = Date.now();
  const force = Boolean(args.force);

  const cached = readinessCache;
  if (
    !force &&
    cached &&
    cached.baseUrl === baseUrl &&
    checkedAt - cached.checkedAt < READINESS_CACHE_TTL_MS
  ) {
    return cached.response;
  }

  let response: JobOpsPublicAvailabilityResponse;

  if (!baseUrl) {
    response = makePublicAvailabilityResponse("unconfigured", {
      baseUrl: null,
      checkedAt,
      reason:
        "No public JobOps base URL is configured. Set JOBOPS_PUBLIC_BASE_URL.",
    });
  } else {
    let hostname: string | null = null;
    try {
      hostname = new URL(baseUrl).hostname;
    } catch {
      hostname = null;
    }

    if (!hostname || isLocalOrPrivateHostname(hostname)) {
      response = makePublicAvailabilityResponse("unavailable", {
        baseUrl,
        checkedAt,
        reason:
          "Configured public URL must be internet-reachable (not localhost/private network).",
      });
    } else {
      const healthUrl = `${baseUrl}/health`;

      try {
        const healthResponse = await fetchWithTimeout(
          healthUrl,
          READINESS_TIMEOUT_MS,
        );

        if (!healthResponse.ok) {
          response = makePublicAvailabilityResponse("unavailable", {
            baseUrl,
            checkedAt,
            reason: `Health check returned HTTP ${healthResponse.status}.`,
          });
        } else {
          readinessLastSuccessAt = checkedAt;
          response = makePublicAvailabilityResponse("ready", {
            baseUrl,
            checkedAt,
            reason: null,
          });
        }
      } catch (error) {
        const reason =
          error instanceof Error && error.name === "AbortError"
            ? `Health check timed out after ${READINESS_TIMEOUT_MS}ms.`
            : error instanceof Error
              ? `Health check failed: ${error.message}.`
              : "Health check failed.";

        response = makePublicAvailabilityResponse("unavailable", {
          baseUrl,
          checkedAt,
          reason,
        });
      }
    }
  }

  readinessCache = {
    baseUrl,
    checkedAt,
    response,
  };

  if (response.status === "ready") {
    logger.info("Public availability check passed", {
      route: "public-availability",
      publicBaseUrl: response.publicBaseUrl,
      checkedAt: response.checkedAt,
    });
  } else {
    logger.warn("Public availability check failed", {
      route: "public-availability",
      status: response.status,
      publicBaseUrl: response.publicBaseUrl,
      reason: response.reason,
      checkedAt: response.checkedAt,
    });
  }

  return response;
}
