import { describe, expect, it } from "vitest";
import { getResumeState, needsRender } from "./pdf-freshness";

describe("getResumeState", () => {
  it.each([
    [{ status: "processing", readyAt: "2026-01-01" }, "preparing"],
    [{ status: "discovered", readyAt: null }, "untargeted"],
    [{ status: "discovered", readyAt: "2026-01-01" }, "unprepared"],
    [{ status: "ready", readyAt: "2026-01-01" }, "available"],
    [{ status: "applied", readyAt: null }, "available"],
    [{ status: "skipped", readyAt: null }, "available"],
  ] as const)("%o -> %s", (job, expected) => {
    expect(getResumeState(job)).toBe(expected);
  });
});

describe("needsRender", () => {
  it.each([
    [{ pdfFreshness: "missing", pdfRegenerating: false }, true],
    [{ pdfFreshness: "stale", pdfRegenerating: false }, true],
    [{ pdfFreshness: "current", pdfRegenerating: false }, false],
    [{ pdfFreshness: "uploaded", pdfRegenerating: false }, false],
    [{ pdfFreshness: "stale", pdfRegenerating: true }, false],
  ] as const)("%o -> %s", (job, expected) => {
    expect(needsRender(job)).toBe(expected);
  });
});
