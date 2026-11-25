import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "./cors-policy";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;
const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("isAllowedCorsOrigin", () => {
  it("allows requests without an Origin header", () => {
    expect(isAllowedCorsOrigin(req({}))).toBe(true);
  });

  it("allows same-origin and the configured public URL", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_PUBLIC_URL = "https://jobs.example.com";
    expect(isAllowedCorsOrigin(req({ origin: "https://other.test", host: "other.test" }))).toBe(
      true,
    );
    expect(isAllowedCorsOrigin(req({ origin: "https://jobs.example.com", host: "x" }))).toBe(true);
  });

  it("rejects unrelated websites", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_PUBLIC_URL = "https://jobs.example.com";
    expect(
      isAllowedCorsOrigin(req({ origin: "https://evil.test", host: "jobs.example.com" })),
    ).toBe(false);
    expect(
      isAllowedCorsOrigin(req({ origin: "http://localhost:5173", host: "jobs.example.com" })),
    ).toBe(false);
  });
});
