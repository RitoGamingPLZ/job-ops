import { vi } from "vitest";

export function createPipelineRepoMock(id: string) {
  return {
    createPipelineRun: vi.fn(async () => ({
      id,
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      jobsDiscovered: 0,
      jobsProcessed: 0,
      errorMessage: null,
    })),
    updatePipelineRun: vi.fn(async () => undefined),
  };
}

export function createPipelineStepsMock() {
  return {
    loadProfileStep: vi.fn(async () => ({})),
    discoverJobsStep: vi.fn(async () => ({
      discoveredJobs: [],
      sourceErrors: [],
      pendingChallenges: [],
    })),
    importJobsStep: vi.fn(async () => ({ created: 0, skipped: 0, fuzzyMerged: 0 })),
    scoreJobsStep: vi.fn(async () => ({ unprocessedJobs: [], scoredJobs: [] })),
    selectJobsStep: vi.fn(() => []),
    notifyPipelineWebhookStep: vi.fn(async () => undefined),
  };
}
