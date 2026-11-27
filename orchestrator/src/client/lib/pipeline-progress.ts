import type { PipelineProgressState } from "@shared/types";

export const TERMINAL_PIPELINE_STEPS: ReadonlySet<PipelineProgressState["step"]> = new Set([
  "completed",
  "cancelled",
  "failed",
]);
