import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "./index";

beforeEach(() => {
  api.__resetApiClientAuthForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it.each([
  ["targetJob", api.targetJob, "POST"],
  ["untargetJob", api.untargetJob, "DELETE"],
] as const)("%s uses the targeting route and returns the job", async (_name, action, method) => {
  const job = {
    id: "job/1",
    status: "discovered",
    readyAt: method === "POST" ? "2026-11-08T00:00:00Z" : null,
  };
  const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, data: job }),
  } as Response);
  await expect(action("job/1")).resolves.toEqual(job);
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/jobs/job%2F1/target",
    expect.objectContaining({ method }),
  );
});
