import type { CorsOptions, CorsOptionsDelegate } from "cors";
import type { Request } from "express";

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const key of ["APP_PUBLIC_URL", "JOBOPS_PUBLIC_BASE_URL"]) {
    const origin = originOf(process.env[key]?.trim());
    if (origin) origins.add(origin);
  }
  for (const raw of (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = originOf(raw.trim());
    if (origin) origins.add(origin);
  }
  return origins;
}

/**
 * Same-origin requests and the configured public URL are allowed; other
 * websites cannot read API responses with a visitor's browser session.
 * Non-browser clients (no Origin header) are unaffected.
 */
export function isAllowedCorsOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;

  const requestOrigin = originOf(origin);
  if (!requestOrigin) return false;

  const host = req.headers.host;
  if (host && new URL(requestOrigin).host === host) return true;
  if (configuredOrigins().has(requestOrigin)) return true;

  if (process.env.NODE_ENV !== "production") {
    const { hostname } = new URL(requestOrigin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  }
  return false;
}

export const corsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  const options: CorsOptions = { origin: isAllowedCorsOrigin(req) };
  callback(null, options);
};
