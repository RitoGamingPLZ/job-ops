vi.mock("../repositories/job-resumes", () => ({
  getJobResume: vi.fn(async () => null),
}));

import { createJob } from "@shared/testing/factories";
import type { ResumeProfile } from "@shared/types";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callJson: vi.fn(),
  experience: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock("./candidate-experience", () => ({
  buildCandidateExperienceContext: mocks.experience,
}));
vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: async () => ({ callJson: mocks.callJson }),
  resolveLlmModel: async () => "mock-model",
}));
vi.mock("./hosted-usage", () => ({
  withHostedUsageReservation: async (
    _args: unknown,
    work: () => Promise<{ result: unknown }>,
  ) => (await work()).result,
}));
vi.mock("../repositories/settings", () => ({ getSetting: async () => null }));
vi.mock("./settings", () => ({
  getEffectiveSettings: async () => ({
    scoringInstructions: { value: "" },
    penalizeMissingSalary: { value: false },
    missingSalaryPenalty: { value: 0 },
  }),
}));
vi.mock("./resumeProjects", () => ({
  filterProfileProjectsForAi: async (profile: unknown) => profile,
}));
vi.mock("../repositories/jobs", () => ({ getJobById: mocks.getJob }));
vi.mock("./writing-style", () => ({
  getWritingStyle: async () => ({
    tone: "professional",
    formality: "medium",
    constraints: "",
    doNotUse: "",
    languageMode: "manual",
    manualLanguage: "english",
    summaryMaxWords: null,
    maxKeywordsPerSkill: null,
  }),
  stripLanguageDirectivesFromConstraints: (s: string) => s,
  stripWordLimitFromConstraints: (s: string) => s,
  stripKeywordLimitFromConstraints: (s: string) => s,
}));
const profile: ResumeProfile = {
  basics: { name: "Candidate", summary: "Summary", label: "Engineer" },
  sections: {
    experience: {
      items: [
        {
          id: "legacy",
          location: "",
          company: "LegacyEmployer",
          position: "Dev",
          summary: "LEGACY_DUTY",
          date: "2020",
          visible: true,
        },
      ],
    },
  },
};
vi.mock("./profile", () => ({ getProfile: async () => profile }));

import { buildJobChatPromptContext } from "./ghostwriter-context";
import { pickProjectIdsForJob } from "./projectSelection";
import { scoreJobSuitability } from "./scorer";
import { generateTailoring } from "./summary";

const job = createJob({
  id: "job",
  title: "Engineer",
  employer: "HiringCo",
  jobDescription: "Build APIs",
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  mocks.experience.mockResolvedValue(null);
  mocks.getJob.mockResolvedValue(job);
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      score: 80,
      reason: "Good",
      summary: "Tailored",
      headline: "Engineer",
      skills: [],
      selectedProjectIds: ["p1"],
    },
  });
});
async function prompts() {
  await scoreJobSuitability(job, profile as Record<string, unknown>);
  const scoring = mocks.callJson.mock.calls.at(-1)?.[0].messages;
  await generateTailoring(job.jobDescription ?? "", profile);
  const tailoring = mocks.callJson.mock.calls.at(-1)?.[0].messages;
  await pickProjectIdsForJob({
    jobDescription: job.jobDescription ?? "",
    eligibleProjects: [
      {
        id: "p1",
        isVisibleInBase: true,
        name: "API",
        description: "API project",
        date: "2025",
        summaryText: "Built APIs",
      },
    ],
    desiredCount: 1,
  });
  const projects = mocks.callJson.mock.calls.at(-1)?.[0].messages;
  const chat = await buildJobChatPromptContext(job.id);
  return { scoring, tailoring, projects, ghostwriter: chat.profileSnapshot };
}
it("preserves byte-identical pre-library prompts when the library is empty", async () => {
  expect(await prompts()).toMatchSnapshot();
  vi.useRealTimers();
});
it("replaces experience in existing profile fields and includes it in project selection", async () => {
  mocks.experience.mockResolvedValue(
    "LibraryEmployer\nLead (2025 – Present)\n- LIBRARY_DUTY [Rust]\n\nSkills: Rust (1)",
  );
  const output = await prompts();
  for (const value of Object.values(output)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    expect(text).toContain("LIBRARY_DUTY");
    expect(text).not.toContain("LEGACY_DUTY");
  }
  vi.useRealTimers();
});
