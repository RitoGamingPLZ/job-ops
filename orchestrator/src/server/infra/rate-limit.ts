/**
 * In-memory sliding-window rate limiter.
 *
 * The server runs as a single process (one Durable Object / container, or one
 * Docker container), so process memory is the right place for abuse limits.
 * Buckets are keyed by tenant/user (or IP before sign-in), never shared.
 */

import { tooManyRequests } from "@infra/errors";
import { fail } from "@infra/http";
import { getUserId, getTenantId } from "@infra/request-context";
import type { NextFunction, Request, RequestHandler, Response } from "express";

type Bucket = { hits: number[] };

const MAX_BUCKETS = 10_000;

export type RateLimitOptions = {
  /** Distinguishes limiters that share one process. */
  name: string;
  windowMs: number;
  max: number;
  /** Only these methods count (default: every non-preflight method). */
  methods?: string[];
  /** Defaults to the signed-in user, falling back to the client IP. */
  key?: (req: Request) => string;
};

export function clientIp(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

function actorKey(req: Request): string {
  const userId = getUserId();
  const tenantId = getTenantId();
  if (userId) return `user:${tenantId ?? "-"}:${userId}`;
  if (tenantId) return `tenant:${tenantId}`;
  return `ip:${clientIp(req)}`;
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    // Preflight and test bypass traffic are not user abuse.
    if (req.method === "OPTIONS" || (options.methods && !options.methods.includes(req.method))) {
      next();
      return;
    }
    if (process.env.NODE_ENV === "test" && process.env.JOBOPS_TEST_RATE_LIMITS !== "1") {
      next();
      return;
    }

    const now = Date.now();
    const key = (options.key ?? actorKey)(req);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) {
        // Drop the oldest entries instead of growing without bound.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }

    const windowStart = now - options.windowMs;
    bucket.hits = bucket.hits.filter((at) => at > windowStart);

    if (bucket.hits.length >= options.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.hits[0] + options.windowMs - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      fail(res, tooManyRequests(`Too many requests. Try again in ${retryAfterSeconds}s.`));
      return;
    }

    bucket.hits.push(now);
    next();
  };
}
