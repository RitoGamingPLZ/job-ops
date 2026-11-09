import { createJob } from "@shared/testing/factories.js";
import type { JobActionResponse } from "@shared/types.js";
import { describe, expect, it } from "vitest";
import {
  canMoveToReady,
  canRescore,
  canSkip,
  canTarget,
  getFailedJobIds,
} from "./jobActions";

describe("jobActions", () => {
  it("targets only nonempty selections of pre-application jobs", () => {
    expect(canTarget([])).toBe(false);
    expect(
      canTarget(
        ["discovered", "processing", "ready"].map((status) =>
          createJob({
            status: status as "discovered" | "processing" | "ready",
          }),
        ),
      ),
    ).toBe(true);
    expect(canTarget([createJob({ status: "applied" })])).toBe(false);
  });

  it("computes eligibility for skip, move-to-ready, and rescore", () => {
    expect(
      canSkip([
        createJob({ id: "1", status: "discovered" }),
        createJob({ id: "2", status: "ready" }),
      ]),
    ).toBe(true);
    expect(canSkip([createJob({ id: "1", status: "applied" })])).toBe(false);

    expect(
      canMoveToReady([
        createJob({ id: "1", status: "discovered" }),
        createJob({ id: "2", status: "discovered" }),
      ]),
    ).toBe(true);
    expect(canMoveToReady([createJob({ id: "1", status: "ready" })])).toBe(
      false,
    );

    expect(
      canRescore([
        createJob({ id: "1", status: "discovered" }),
        createJob({ id: "2", status: "ready" }),
        createJob({ id: "3", status: "applied" }),
        createJob({ id: "4", status: "skipped" }),
        createJob({ id: "5", status: "expired" }),
      ]),
    ).toBe(true);
    expect(
      canRescore([
        createJob({ id: "1", status: "ready" }),
        createJob({ id: "2", status: "processing" }),
      ]),
    ).toBe(false);
  });

  it("extracts failed job ids from an action response", () => {
    const response: JobActionResponse = {
      action: "skip",
      requested: 3,
      succeeded: 1,
      failed: 2,
      results: [
        {
          jobId: "job-1",
          ok: true,
          job: createJob({ id: "job-1", status: "skipped" }),
        },
        {
          jobId: "job-2",
          ok: false,
          error: { code: "INVALID_REQUEST", message: "bad status" },
        },
        {
          jobId: "job-3",
          ok: false,
          error: { code: "NOT_FOUND", message: "missing" },
        },
      ],
    };

    expect(Array.from(getFailedJobIds(response))).toEqual(["job-2", "job-3"]);
  });
});
