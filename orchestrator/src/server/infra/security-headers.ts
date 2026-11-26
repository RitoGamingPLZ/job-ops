import type { NextFunction, Request, Response } from "express";

/**
 * Baseline response hardening that cannot break the SPA: no MIME sniffing, no
 * framing by other origins, no plugin content, limited referrers. A full
 * script-src policy is deliberately left out because analytics and map tiles
 * load from third-party origins.
 */
const BASELINE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Content-Security-Policy":
    "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
};

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  const forwardedProto = req.headers["x-forwarded-proto"];
  const isHttps = req.secure || forwardedProto === "https";
  if (process.env.NODE_ENV === "production" && isHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}
