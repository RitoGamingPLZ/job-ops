import type { Server } from "node:http";
import { AppError } from "@infra/errors";
import { getRequestContext, runWithRequestContext } from "@infra/request-context";
import type { sendMessageForJob } from "@server/services/ghostwriter";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ghostwriterRouter } from "./ghostwriter";

type Stream = NonNullable<Parameters<typeof sendMessageForJob>[0]["stream"]>;
const services = vi.hoisted(() => ({
  sendMessageForJob: vi.fn(),
  regenerateMessageForJob: vi.fn(),
  editMessageForJob: vi.fn(),
  editMessage: vi.fn(),
  sendMessage: vi.fn(),
  regenerateMessage: vi.fn(),
}));
vi.mock("@server/services/ghostwriter", () => services);

const routes = [
  ["messages", "sendMessageForJob", "callback-thread"],
  ["messages/assistant-1/regenerate", "regenerateMessageForJob", "callback-thread"],
  ["messages/user-1/edit", "editMessageForJob", "callback-thread"],
  ["threads/url-thread/messages/user-1/edit", "editMessage", "callback-thread"],
  ["threads/url-thread/messages", "sendMessage", "url-thread"],
  ["threads/url-thread/messages/assistant-1/regenerate", "regenerateMessage", "url-thread"],
] as const;

describe("Ghostwriter route streams", () => {
  let server: Server;
  let baseUrl: string;
  const endCounts = new Map<string, () => number>();
  const headersSent = new Map<string, () => boolean>();

  beforeEach(async () => {
    vi.resetAllMocks();
    endCounts.clear();
    headersSent.clear();
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const requestId = req.header("x-request-id") ?? "unknown";
      if (requestId !== "unknown") res.setHeader("x-request-id", requestId);
      const end = vi.spyOn(res, "end");
      endCounts.set(requestId, () => end.mock.calls.length);
      headersSent.set(requestId, () => res.headersSent);
      runWithRequestContext({ requestId, tenantId: req.header("x-tenant-id") }, next);
    });
    app.use("/api/jobs/:id/chat", ghostwriterRouter);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    baseUrl = `http://127.0.0.1:${address.port}/api/jobs/job-1/chat`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  async function post(path: string, requestId?: string, tenantId = "tenant-a") {
    return fetch(`${baseUrl}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": tenantId,
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify({ content: "hello", stream: true }),
    });
  }

  it.each(routes)("serializes callbacks for %s", async (path, service, threadId) => {
    services[service].mockImplementationOnce(async ({ stream }: { stream: Stream }) => {
      expect(headersSent.get("stream-request")?.()).toBe(true);
      const ready = {
        runId: "run-1",
        threadId: "callback-thread",
        messageId: "assistant-1",
        requestId: "callback-request",
        privateField: "omit me",
      };
      stream.onReady(ready);
      stream.onDelta({
        runId: "run-1",
        messageId: "assistant-1",
        delta: "hello",
      });
      stream.onCompleted({ runId: "run-1", message: null });
      stream.onCancelled({ runId: "run-1", message: null });
      const error = {
        runId: "run-1",
        code: "UPSTREAM_ERROR",
        message: "failed",
        requestId: "callback-request",
        details: "omit me",
      };
      stream.onError(error);
    });
    const response = await post(path, "stream-request");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("connection")).toBe("keep-alive");
    expect(await response.text()).toBe(
      [
        {
          type: "ready",
          runId: "run-1",
          threadId,
          messageId: "assistant-1",
          requestId: "callback-request",
        },
        {
          type: "delta",
          runId: "run-1",
          messageId: "assistant-1",
          delta: "hello",
        },
        { type: "completed", runId: "run-1", message: null },
        { type: "cancelled", runId: "run-1", message: null },
        {
          type: "error",
          runId: "run-1",
          code: "UPSTREAM_ERROR",
          message: "failed",
          requestId: "callback-request",
        },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    );
    expect(services[service]).toHaveBeenCalledOnce();
    expect(services[service]).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1" }));
    expect(endCounts.get("stream-request")?.()).toBe(1);
  });

  it.each(routes)("converts thrown errors and ends once for %s", async (path, service) => {
    services[service].mockRejectedValueOnce(
      new AppError({
        status: 409,
        code: "CONFLICT",
        message: "already running",
        details: "private",
      }),
    );
    const response = await post(path, "error-request");
    expect(await response.text()).toBe(
      'data: {"type":"error","code":"CONFLICT","message":"already running","requestId":"error-request"}\n\n',
    );
    expect(endCounts.get("error-request")?.()).toBe(1);
  });

  it("uses unknown request ID and INTERNAL_ERROR for unexpected errors", async () => {
    services.sendMessageForJob.mockRejectedValueOnce(new Error("unexpected"));
    const response = await post("messages");
    expect(await response.text()).toBe(
      'data: {"type":"error","code":"INTERNAL_ERROR","message":"unexpected","requestId":"unknown"}\n\n',
    );
    expect(endCounts.get("unknown")?.()).toBe(1);
  });

  it("keeps concurrent tenant and job contexts through asynchronous callbacks", async () => {
    services.sendMessageForJob.mockImplementation(async ({ stream }: { stream: Stream }) => {
      const before = getRequestContext();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(getRequestContext()).toEqual(before);
      expect(before).toMatchObject({ jobId: "job-1" });
      stream.onDelta({
        runId: before?.tenantId ?? "",
        messageId: "assistant-1",
        delta: before?.requestId ?? "",
      });
    });
    const responses = await Promise.all([
      post("messages", "request-a", "tenant-a"),
      post("messages", "request-b", "tenant-b"),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    expect(bodies).toEqual([
      'data: {"type":"delta","runId":"tenant-a","messageId":"assistant-1","delta":"request-a"}\n\n',
      'data: {"type":"delta","runId":"tenant-b","messageId":"assistant-1","delta":"request-b"}\n\n',
    ]);
    expect(endCounts.get("request-a")?.()).toBe(1);
    expect(endCounts.get("request-b")?.()).toBe(1);
  });
});
