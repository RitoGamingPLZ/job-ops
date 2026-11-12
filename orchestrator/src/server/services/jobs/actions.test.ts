import { runWithRequestContext } from "@infra/request-context";
import { processJob } from "@server/pipeline/index";
import * as jobsRepo from "@server/repositories/jobs";
import { getEffectiveSettings } from "@server/services/settings";
import { applySettingsUpdates } from "@server/services/settings-update";
import { createAppSettings, createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blacklistJobEmployer,
  executeJobActionForJob,
  targetJobInBackground,
} from "./actions";

vi.mock("@server/pipeline/index", () => ({ processJob: vi.fn() }));
vi.mock("@server/repositories/jobs", () => ({
  getJobById: vi.fn(),
  setJobTargeted: vi.fn(),
  updateJob: vi.fn(),
  skipJobsByEmployer: vi.fn(),
}));
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: vi.fn(),
}));
vi.mock("@server/services/settings-update", () => ({
  applySettingsUpdates: vi.fn(),
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
  vi.mocked(jobsRepo.updateJob).mockImplementation(async (_id, input) => ({
    ...job,
    readyAt: "now",
    ...input,
  }));
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
  it("shows a discovered job as processing in the response, before generation runs", async () => {
    vi.mocked(jobsRepo.setJobTargeted).mockResolvedValue({
      ...job,
      status: "discovered",
    });
    const result = await targetJobInBackground(job.id);
    expect(result.status).toBe("processing");
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(job.id, {
      status: "processing",
    });
    expect(processJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(processJob).toHaveBeenCalledOnce());
  });
  it("retries a job left in processing and keeps ready jobs ready", async () => {
    for (const status of ["processing", "ready"] as const) {
      vi.clearAllMocks();
      vi.mocked(jobsRepo.setJobTargeted).mockResolvedValue({ ...job, status });
      expect((await targetJobInBackground(job.id)).status).toBe(status);
      expect(jobsRepo.updateJob).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(processJob).toHaveBeenCalledOnce());
    }
  });
});

describe("blacklistJobEmployer", () => {
  beforeEach(() => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      createAppSettings({
        blockedCompanyKeywords: { value: [], default: [], override: null },
      }),
    );
    vi.mocked(applySettingsUpdates).mockResolvedValue({
      shouldRefreshBackupScheduler: false,
      shouldClearRxResumeCaches: false,
      updatedSettingKeys: [],
    });
  });

  it("adds the employer to the blocklist and hides every skippable job from it", async () => {
    vi.mocked(jobsRepo.getJobById)
      .mockResolvedValueOnce({ ...job, status: "discovered" })
      .mockResolvedValueOnce({ ...job, status: "skipped" });
    vi.mocked(jobsRepo.skipJobsByEmployer).mockResolvedValue(3);
    const result = await blacklistJobEmployer(job.id);
    expect(applySettingsUpdates).toHaveBeenCalledWith({
      blockedCompanyKeywords: [job.employer],
    });
    expect(jobsRepo.skipJobsByEmployer).toHaveBeenCalledWith(job.employer, [
      "discovered",
      "ready",
    ]);
    expect(result.hiddenCount).toBe(3);
    expect(result.job.status).toBe("skipped");
  });

  it("does not duplicate an employer already on the blocklist (case-insensitive)", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      createAppSettings({
        blockedCompanyKeywords: {
          value: [job.employer.toUpperCase()],
          default: [],
          override: [job.employer.toUpperCase()],
        },
      }),
    );
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      ...job,
      status: "discovered",
    });
    vi.mocked(jobsRepo.skipJobsByEmployer).mockResolvedValue(0);
    await blacklistJobEmployer(job.id);
    expect(applySettingsUpdates).not.toHaveBeenCalled();
    // Hiding existing posts isn't gated on the dedup check above.
    expect(jobsRepo.skipJobsByEmployer).toHaveBeenCalledWith(job.employer, [
      "discovered",
      "ready",
    ]);
  });

  it("blacklists an already-applied job without changing its own status", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      ...job,
      status: "applied",
    });
    vi.mocked(jobsRepo.skipJobsByEmployer).mockResolvedValue(0);
    const result = await blacklistJobEmployer(job.id);
    expect(applySettingsUpdates).toHaveBeenCalledWith({
      blockedCompanyKeywords: [job.employer],
    });
    expect(result.hiddenCount).toBe(0);
    expect(result.job.status).toBe("applied");
  });
});
