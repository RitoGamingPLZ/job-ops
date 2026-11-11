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

it("regenerates a job resume using its encoded id", async () => {
  const job = { id: "job/1", status: "processing" };
  const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, data: job }),
  } as Response);
  await expect(api.regenerateJobResume("job/1")).resolves.toEqual(job);
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/jobs/job%2F1/regenerate-resume",
    expect.objectContaining({ method: "POST" }),
  );
});

it("starts the missing resume batch without a body", async () => {
  const result = { jobIds: ["job-1"], alreadyRunning: false };
  const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, data: result }),
  } as Response);
  await expect(api.generateMissingResumes()).resolves.toEqual(result);
  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/jobs/actions/generate-missing-resumes",
    expect.objectContaining({ method: "POST" }),
  );
  expect(fetchSpy.mock.calls[0]?.[1]?.body).toBeUndefined();
});
