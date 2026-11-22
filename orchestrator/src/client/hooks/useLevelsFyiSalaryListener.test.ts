import * as api from "@client/api";
import { LEVELS_SALARY_RESULT_EVENT } from "@client/lib/levels-fyi";
import { createJob } from "@shared/testing/factories.js";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLevelsFyiSalaryListener } from "./useLevelsFyiSalaryListener";

vi.mock("@client/api", () => ({
  updateJob: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("useLevelsFyiSalaryListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves same-origin salary messages via updateJob and notifies callback", async () => {
    const updatedJob = createJob({
      id: "job-1",
      salary: "$180K - $240K",
      salaryMinAmount: 180_000,
      salaryMaxAmount: 240_000,
      salaryCurrency: "USD",
      salarySource: "levels.fyi",
    });
    vi.mocked(api.updateJob).mockResolvedValue(updatedJob);
    const onJobUpdated = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useLevelsFyiSalaryListener(onJobUpdated));

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: LEVELS_SALARY_RESULT_EVENT,
          jobId: "job-1",
          salary: "$180K - $240K",
          salaryMinAmount: 180_000,
          salaryMaxAmount: 240_000,
          salaryCurrency: "USD",
          salaryInterval: "yearly",
          salarySource: "levels.fyi",
        },
      }),
    );

    await waitFor(() => {
      expect(api.updateJob).toHaveBeenCalledWith("job-1", {
        salary: "$180K - $240K",
        salaryMinAmount: 180_000,
        salaryMaxAmount: 240_000,
        salaryCurrency: "USD",
        salaryInterval: "yearly",
        salarySource: "levels.fyi",
      });
    });
    await waitFor(() => {
      expect(onJobUpdated).toHaveBeenCalledWith(updatedJob);
    });
  });

  it("ignores cross-origin and unrelated messages", async () => {
    const onJobUpdated = vi.fn();
    renderHook(() => useLevelsFyiSalaryListener(onJobUpdated));

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example.com",
        data: {
          type: LEVELS_SALARY_RESULT_EVENT,
          jobId: "job-1",
          salary: "$200K",
        },
      }),
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "UNRELATED_EVENT", jobId: "job-1", salary: "$200K" },
      }),
    );

    await Promise.resolve();
    expect(api.updateJob).not.toHaveBeenCalled();
    expect(onJobUpdated).not.toHaveBeenCalled();
  });
});
