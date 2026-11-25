import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limit";

function run(limiter: ReturnType<typeof createRateLimiter>, req: Partial<Request>) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    getHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn();
  limiter(
    { method: "POST", headers: {}, socket: { remoteAddress: "1.1.1.1" }, ...req } as Request,
    res,
    next,
  );
  return { res, next, headers };
}

describe("createRateLimiter", () => {
  beforeEach(() => {
    process.env.JOBOPS_TEST_RATE_LIMITS = "1";
    vi.useFakeTimers();
  });
  afterEach(() => {
    delete process.env.JOBOPS_TEST_RATE_LIMITS;
    vi.useRealTimers();
  });

  it("blocks after the limit and recovers after the window", () => {
    const limiter = createRateLimiter({ name: "t", windowMs: 1000, max: 2, key: () => "k" });
    expect(run(limiter, {}).next).toHaveBeenCalled();
    expect(run(limiter, {}).next).toHaveBeenCalled();
    const blocked = run(limiter, {});
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.headers["Retry-After"]).toBeDefined();
    expect(blocked.res.status).toHaveBeenCalledWith(429);

    vi.advanceTimersByTime(1100);
    expect(run(limiter, {}).next).toHaveBeenCalled();
  });

  it("keeps separate buckets per key and ignores other methods", () => {
    let who = "a";
    const limiter = createRateLimiter({
      name: "t",
      windowMs: 1000,
      max: 1,
      methods: ["POST"],
      key: () => who,
    });
    expect(run(limiter, {}).next).toHaveBeenCalled();
    who = "b";
    expect(run(limiter, {}).next).toHaveBeenCalled();
    who = "a";
    expect(run(limiter, { method: "GET" }).next).toHaveBeenCalled();
    expect(run(limiter, {}).next).not.toHaveBeenCalled();
  });
});
