vi.mock("./candidate-experience", () => ({
  buildCandidateExperienceContext: vi.fn(async () => null),
}));

import { createJob } from "@shared/testing/factories";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsRepo from "../repositories/settings";
import { scoreJobSuitability } from "./scorer";

// --- Mocks ---
const settingsMocks = vi.hoisted(() => ({
  getSetting: vi.fn().mockResolvedValue(null),
  getAllSettings: vi.fn().mockResolvedValue({}),
  getEffectiveSettings: vi.fn(),
}));

vi.mock("../repositories/settings", () => settingsMocks);
vi.mock("@server/repositories/settings", () => settingsMocks);
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: settingsMocks.getEffectiveSettings,
}));

function effectiveSettings(raw: Record<string, unknown>) {
  return {
    model: { value: raw.model ?? "gpt-4o-mini" },
    llmProvider: { value: raw.llmProvider ?? "openrouter" },
    llmBaseUrl: { value: raw.llmBaseUrl ?? null },
    llmPurposeOverrides: { value: {} },
    modelScorer: { value: null },
    modelProjectSelection: { value: null },
    scoringInstructions: { value: "" },
    scoringPromptTemplate: { value: null },
    penalizeMissingSalary: { value: false },
    missingSalaryPenalty: { value: 0 },
  };
}

// We need to mock 'fetch' globally for these tests
const globalFetch = global.fetch;

const mockJob = createJob({
  id: "test-job",
  source: "linkedin",
  title: "Senior Engineer",
  employer: "Test Corp",
  jobDescription: "Looking for a TypeScript and React expert.",
  status: "discovered",
  suitabilityScore: null,
  suitabilityReason: null,
});

const mockProfile = { name: "Test User" };

describe("AI Service Resilience", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    delete process.env.LLM_API_KEY;
    process.env.OPENROUTER_API_KEY = "mock-key"; // Ensure logic tries to call API
    vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({
      llmProvider: "openrouter",
      llmApiKey: "mock-key",
    });
    settingsMocks.getEffectiveSettings.mockImplementation(async () =>
      effectiveSettings(await settingsMocks.getAllSettings()),
    );
  });

  afterEach(() => {
    global.fetch = globalFetch;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    vi.restoreAllMocks();
  });

  describe("scoreJobSuitability (Scorer)", () => {
    it("should return parsed score when API returns valid JSON", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({ score: 85, reason: "Great match" }),
              },
            },
          ],
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await scoreJobSuitability(mockJob, mockProfile);

      expect(result.score).toBe(85);
      expect(result.reason).toBe("Great match");
    });

    it("should throw LlmNotConfiguredError if API Key is missing", async () => {
      delete process.env.OPENROUTER_API_KEY;
      vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({});

      // Should NOT call fetch
      await expect(scoreJobSuitability(mockJob, mockProfile)).rejects.toThrow(
        "LLM API key not configured",
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should throw ScoringUnavailableError on API 5xx errors", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as any);

      await expect(scoreJobSuitability(mockJob, mockProfile)).rejects.toThrow("AI scoring failed");
    });

    it("should throw ScoringUnavailableError on Malformed/Invalid JSON in API response", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "This is not JSON at all, just text." } }],
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await expect(scoreJobSuitability(mockJob, mockProfile)).rejects.toThrow("AI scoring failed");
    });

    it("should extract JSON from markdown code blocks", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Here is the score: ```json\n{ "score": 90, "reason": "Good" }\n```',
              },
            },
          ],
        }),
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await scoreJobSuitability(mockJob, mockProfile);
      expect(result.score).toBe(90);
    });
  });
});
