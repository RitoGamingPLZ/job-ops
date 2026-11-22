import { type AppErrorCode, statusToCode } from "@infra/errors";
import { mapJobActionFailure } from "@server/services/jobs/actions";
import { describe, expect, it } from "vitest";
import { appErrorFromPipelineFailure } from "./shared";

const statuses: Array<[AppErrorCode, number]> = [
  ["INVALID_REQUEST", 400],
  ["UNAUTHORIZED", 401],
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["REQUEST_TIMEOUT", 408],
  ["CONFLICT", 409],
  ["UNPROCESSABLE_ENTITY", 422],
  ["INTERNAL_ERROR", 500],
  ["UPSTREAM_ERROR", 502],
  ["SERVICE_UNAVAILABLE", 503],
];

describe("job failure status mapping", () => {
  it.each(statuses)("maps %s to %i in both consumers", (code, status) => {
    expect(statusToCode(status)).toBe(code);
    expect(
      appErrorFromPipelineFailure(
        { errorCode: code, error: "failure" },
        "fallback",
      ),
    ).toMatchObject({ code, status, message: "failure" });
    expect(
      mapJobActionFailure({
        jobId: "job-1",
        ok: false,
        error: { code, message: "failure" },
      }),
    ).toMatchObject({ code, status, message: "failure" });
  });

  it.each([
    [{}, "fallback", 400, "INVALID_REQUEST"],
    [{ error: "failure" }, "failure", 400, "INVALID_REQUEST"],
    [{ error: "Job not found" }, "Job not found", 404, "NOT_FOUND"],
    [{ error: "job not found" }, "job not found", 400, "INVALID_REQUEST"],
    [{ error: "" }, "", 400, "INVALID_REQUEST"],
    [{ errorCode: "CONFLICT" as const }, "fallback", 409, "CONFLICT"],
    [
      { errorCode: "CONFLICT" as const, error: "Job not found" },
      "Job not found",
      409,
      "CONFLICT",
    ],
  ])("preserves pipeline fallback for %j", (failure, message, status, code) => {
    expect(appErrorFromPipelineFailure(failure, "fallback")).toMatchObject({
      code,
      status,
      message,
    });
  });

  it("falls back to INTERNAL_ERROR for unknown action failure codes", () => {
    expect(
      mapJobActionFailure({
        jobId: "job-1",
        ok: false,
        error: { code: "UNKNOWN", message: "failure" },
      }),
    ).toMatchObject({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "failure",
    });
  });
});
