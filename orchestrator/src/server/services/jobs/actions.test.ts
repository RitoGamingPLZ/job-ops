import { runWithRequestContext } from "@infra/request-context";
import { processJob } from "@server/pipeline/index";
import * as jobsRepo from "@server/repositories/jobs";
import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeJobActionForJob, targetJobInBackground } from "./actions";

vi.mock("@server/pipeline/index", () => ({ processJob: vi.fn() }));
vi.mock("@server/repositories/jobs", () => ({
  getJobById: vi.fn(),
  setJobTargeted: vi.fn(),
}));
const job = createJob({ id: "target-job" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(jobsRepo.getJobById).mockResolvedValue(job);
  vi.mocked(jobsRepo.setJobTargeted).mockResolvedValue({
    ...job,
    readyAt: "now",
  });
  vi.mocked(processJob).mockResolvedValue({ success: true });
});
describe("target generation dispatch", () => {
  it("returns before generation finishes and collapses duplicate targets", async () => {
    let finish!: (result: { success: boolean }) => void;
    vi.mocked(processJob).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = await targetJobInBackground(job.id);
    expect(result.readyAt).toBe("now");
    expect(processJob).not.toHaveBeenCalled();
    await targetJobInBackground(job.id);
    await vi.waitFor(() => expect(processJob).toHaveBeenCalledOnce());
    finish({ success: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  it("move_to_ready uses the same background target flow, including ready-job retries", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      ...job,
      status: "ready",
    });
    expect(await executeJobActionForJob("move_to_ready", job.id)).toMatchObject(
      { ok: true },
    );
    await vi.waitFor(() => expect(processJob).toHaveBeenCalledOnce());
  });
  it("keeps pending work isolated by tenant and retains async context", async () => {
    const tenants: Array<string | undefined> = [];
    const { getRequestContext } = await import("@infra/request-context");
    vi.mocked(processJob).mockImplementation(async () => {
      tenants.push(getRequestContext()?.tenantId);
      return { success: true };
    });
    await Promise.all(
      ["tenant-a", "tenant-b"].map((tenantId) =>
        runWithRequestContext({ tenantId, requestId: tenantId }, () =>
          targetJobInBackground(job.id),
        ),
      ),
    );
    await vi.waitFor(() =>
      expect(tenants.sort()).toEqual(["tenant-a", "tenant-b"]),
    );
  });
});
