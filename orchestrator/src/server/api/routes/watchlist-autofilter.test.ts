import type { Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const mocks = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("@server/watchlist/autofilter/suggest", () => ({
  suggestFilters: mocks.suggest,
}));
let server: Server;
let baseUrl: string;
let closeDb: () => void;
let tempDir: string;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ server, baseUrl, closeDb, tempDir } = await startServer({
    env: {
      BASIC_AUTH_USER: "admin",
      BASIC_AUTH_PASSWORD: "secret",
      JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
      JOBOPS_TEST_AUTH_BYPASS: "0",
    },
  }));
});
afterEach(async () => stopServer({ server, closeDb, tempDir }));
const payload = {
  sourceType: "lever",
  careersUrl: "https://jobs.lever.co/spotify",
};
async function post(body: unknown, token?: string) {
  return fetch(`${baseUrl}/api/watchlist/suggest-filters`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "autofilter-test",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function login() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "secret" }),
  });
  return (await res.json()).data.token as string;
}
it("requires the existing watchlist authentication", async () => {
  expect((await post(payload)).status).toBe(401);
  expect(mocks.suggest).not.toHaveBeenCalled();
});
it("validates input before calling suggestion service", async () => {
  const response = await post({ ...payload, careersUrl: "bad" }, await login());
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  expect(mocks.suggest).not.toHaveBeenCalled();
});
it("returns the standard success envelope and correlation id", async () => {
  mocks.suggest.mockResolvedValue({
    suggestedUrl: payload.careersUrl,
    totals: { filtered: 5, unfiltered: 100 },
  });
  const response = await post(payload, await login());
  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBe("autofilter-test");
  expect(await response.json()).toMatchObject({
    ok: true,
    data: { totals: { filtered: 5, unfiltered: 100 } },
    meta: { requestId: "autofilter-test" },
  });
});
it("maps service 422 errors", async () => {
  const { unprocessableEntity } = await import("@infra/errors");
  mocks.suggest.mockRejectedValue(unprocessableEntity("No matching filters"));
  const response = await post(payload, await login());
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: { code: "UNPROCESSABLE_ENTITY" },
  });
});

it.each([
  { name: "TimeoutError", message: "The operation was aborted due to timeout" },
  { name: "AbortError", message: "The operation was aborted" },
  { name: "Error", message: "Watchlist source timed out after 30s" },
])("maps $name ($message) to a sanitized 503 envelope", async ({ name, message }) => {
  const error = new Error(message);
  error.name = name;
  mocks.suggest.mockRejectedValue(error);
  const response = await post(payload, await login());
  expect(response.status).toBe(503);
  expect(response.headers.get("x-request-id")).toBe("autofilter-test");
  expect(await response.json()).toEqual({
    ok: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "Filter suggestion request timed out or was aborted",
    },
    meta: { requestId: "autofilter-test" },
  });
});

it("preserves missing LLM key service unavailability", async () => {
  const { serviceUnavailable } = await import("@infra/errors");
  mocks.suggest.mockRejectedValue(serviceUnavailable("LLM API key not configured"));
  const response = await post(payload, await login());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "LLM API key not configured",
    },
    meta: { requestId: "autofilter-test" },
  });
});
