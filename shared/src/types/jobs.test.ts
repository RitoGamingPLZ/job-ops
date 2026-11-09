import { describe, expect, it } from "vitest";
import {
  APPLICATION_STAGES,
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS,
  boardColumnForStage,
  isTargeted,
  type JobStatus,
  technicalRound,
} from "./jobs";

describe("board stage contract", () => {
  it("accepts every legacy stage and maps them into the fixed columns", () => {
    expect(BOARD_COLUMNS).toEqual([
      "targeted",
      "applied",
      "recruiter_screen",
      "technical_interview",
      "behavioural",
      "hiring_manager_screen",
      "offer",
      "closed",
    ]);
    for (const stage of APPLICATION_STAGES) {
      expect(BOARD_COLUMNS).toContain(boardColumnForStage(stage));
    }
    expect(boardColumnForStage("assessment")).toBe("technical_interview");
    expect(boardColumnForStage("onsite")).toBe("technical_interview");
    expect(boardColumnForStage("behavioural")).toBe("behavioural");
    expect(BOARD_COLUMN_LABELS.behavioural).toBe("Behaviour Question");
    expect(BOARD_COLUMN_LABELS.hiring_manager_screen).toBe("Team Match");
    expect(BOARD_COLUMN_LABELS.closed).toBe("Reject");
  });

  it("counts technical and legacy interview transitions, including repeated rounds", () => {
    expect(technicalRound([])).toBe(0);
    expect(
      technicalRound(
        [
          "assessment",
          "technical_interview",
          "behavioural",
          "technical_interview",
          "onsite",
        ].map((toStage) => ({ toStage })) as Parameters<
          typeof technicalRound
        >[0],
      ),
    ).toBe(4);
  });

  it("excludes note-only events across technical and legacy stages", () => {
    expect(
      technicalRound([
        {
          toStage: "technical_interview",
          metadata: { eventType: "status_update" },
        },
        { toStage: "technical_interview", metadata: { eventType: "note" } },
        { toStage: "assessment", metadata: { eventType: "note" } },
        { toStage: "onsite", metadata: { eventType: "note" } },
        {
          toStage: "technical_interview",
          metadata: { eventType: "status_update" },
        },
      ]),
    ).toBe(2);
  });

  it.each<JobStatus>([
    "discovered",
    "processing",
    "ready",
    "applied",
    "in_progress",
    "skipped",
    "expired",
  ])("targets %s only with a timestamp and eligible status", (status) => {
    expect(isTargeted({ status, readyAt: null })).toBe(false);
    expect(isTargeted({ status, readyAt: "2026-11-08T00:00:00Z" })).toBe(
      ["discovered", "processing", "ready"].includes(status),
    );
  });
});
