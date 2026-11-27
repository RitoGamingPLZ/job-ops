import type { WatchlistSelectedSource } from "@shared/types";
import { vi } from "vitest";

export function makeSelectedSource(
  overrides: Partial<WatchlistSelectedSource> &
    Pick<WatchlistSelectedSource, "sourceType" | "careersUrl">,
): WatchlistSelectedSource {
  return {
    id: `selected-${overrides.sourceType}`,
    catalogSourceId: null,
    label: overrides.sourceType,
    cxsJobsUrl: null,
    isCustom: false,
    sortOrder: 0,
    createdAt: "2026-11-07T00:00:00Z",
    updatedAt: "2026-11-07T00:00:00Z",
    ...overrides,
  };
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function htmlResponse(html: string, init?: ResponseInit): Response {
  return new Response(html, init);
}

export function createFetchStub(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function installFakeAbortSignalTimeout(sharedController?: AbortController) {
  return vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = sharedController ?? new AbortController();
    globalThis.setTimeout(
      () => controller.abort(new DOMException("Operation timed out", "TimeoutError")),
      milliseconds,
    );
    return controller.signal;
  });
}
