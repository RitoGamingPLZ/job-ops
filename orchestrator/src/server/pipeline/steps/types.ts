import type { Job } from "@shared/types";

export type ScoredJob = Job & {
  suitabilityScore: number | null;
  suitabilityReason: string;
};
