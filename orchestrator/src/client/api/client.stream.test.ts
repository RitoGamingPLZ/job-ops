import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./client";

describe("API client SSE streaming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.__resetApiClientAuthForTests();
  });

  it("joins multiline data across chunks and skips malformed frames", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: invalid\r\n\r\n: comment\r\n"));
        controller.enqueue(encoder.encode('data: {"type":"started",\r\n'));
        controller.enqueue(encoder.encode('data: "requestId":"req-1"}\r\n\r'));
        controller.enqueue(encoder.encode("\n"));
        controller.close();
      },
    });
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(stream));
    const onEvent = vi.fn();

    await api.streamJobAction({ action: "skip", jobIds: ["job-1"] }, { onEvent });

    expect(onEvent.mock.calls).toEqual([[{ type: "started", requestId: "req-1" }]]);
  });

  it("propagates handler errors and cancels the stream reader", async () => {
    const encoder = new TextEncoder();
    const cancelSpy = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"started","requestId":"req-1"}\n\n'));
      },
      cancel() {
        cancelSpy();
      },
    });

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    await expect(
      api.streamJobAction(
        { action: "skip", jobIds: ["job-1"] },
        {
          onEvent: () => {
            throw new Error("handler exploded");
          },
        },
      ),
    ).rejects.toThrow("handler exploded");

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});
