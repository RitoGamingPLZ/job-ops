import { expect, it } from "vitest";
import {
  messageTypeFromStageTarget,
  normalizeStageTarget,
  resolveStageTransitionForTarget,
  stageTargetFromMessageType,
} from "./stage-target";

it("accepts behavioural as an interview target without inferring technical rounds", () => {
  expect(normalizeStageTarget("behavioural")).toBe("behavioural");
  expect(messageTypeFromStageTarget("behavioural")).toBe("interview");
  expect(resolveStageTransitionForTarget("behavioural")).toEqual({
    toStage: "behavioural",
    outcome: null,
    reasonCode: null,
  });
  expect(stageTargetFromMessageType("interview")).toBe("technical_interview");
  expect(resolveStageTransitionForTarget("technical_interview").toStage).toBe(
    "technical_interview",
  );
});
