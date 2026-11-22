import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRequestOrigin } from "./request-origin";

function request({
  protocol = "http",
  host = "localhost:3000",
  trustProxy = false,
  forwardedProto,
  forwardedHost,
}: {
  protocol?: string;
  host?: string;
  trustProxy?: boolean;
  forwardedProto?: string;
  forwardedHost?: string;
} = {}): Request {
  const headers: Record<string, string | undefined> = {
    host,
    "x-forwarded-proto": forwardedProto,
    "x-forwarded-host": forwardedHost,
  };
  return {
    protocol,
    app: { get: () => trustProxy },
    header: (name: string) => headers[name],
  } as unknown as Request;
}

afterEach(() => vi.unstubAllEnvs());

describe("resolveRequestOrigin", () => {
  it("normalizes the configured origin ahead of request headers", () => {
    vi.stubEnv("JOBOPS_PUBLIC_BASE_URL", " https://example.com:8443/path?q=1 ");
    expect(resolveRequestOrigin(request())).toBe("https://example.com:8443");
  });

  it.each([undefined, "", "   ", "not a url", "mailto:test@example.com"])(
    "falls back to the request for unusable configuration %s",
    (configured) => {
      vi.stubEnv("JOBOPS_PUBLIC_BASE_URL", configured);
      expect(resolveRequestOrigin(request())).toBe("http://localhost:3000");
    },
  );

  it.each([false, true])("gates forwarded headers on proxy trust %s", (trustProxy) => {
    vi.stubEnv("JOBOPS_PUBLIC_BASE_URL", "");
    expect(
      resolveRequestOrigin(
        request({
          trustProxy,
          forwardedProto: " https , http ",
          forwardedHost: " public.example , internal.example ",
        }),
      ),
    ).toBe(trustProxy ? "https://public.example" : "http://localhost:3000");
  });

  it("retains request protocol and host for blank forwarded headers", () => {
    vi.stubEnv("JOBOPS_PUBLIC_BASE_URL", "");
    expect(
      resolveRequestOrigin(
        request({
          trustProxy: true,
          forwardedProto: " ,https",
          forwardedHost: " ",
        }),
      ),
    ).toBe("http://localhost:3000");
  });

  it.each([{ protocol: "" }, { host: "" }, { protocol: " ", host: " " }])(
    "returns null when protocol or host is missing: %j",
    (input) => {
      vi.stubEnv("JOBOPS_PUBLIC_BASE_URL", "");
      expect(resolveRequestOrigin(request(input))).toBeNull();
    },
  );
});
