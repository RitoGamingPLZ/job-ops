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
  tailoring: vi.fn(),
  filterProjects: vi.fn(),
}));
vi.mock("./candidate-experience", () => ({
  buildCandidateExperienceContext: mocks.experience,
  buildCandidateTailoringContext: mocks.tailoring,
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
  filterProfileProjectsForAi: mocks.filterProjects,
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
  mocks.tailoring.mockImplementation(async () => ({
    experience: await mocks.experience(),
    skills: null,
  }));
  mocks.filterProjects.mockImplementation(
    async (profile: ResumeProfile) => profile,
  );
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

it("uses library skills once and only AI-filtered profile projects for tailoring", async () => {
  mocks.tailoring.mockResolvedValue({
    experience: "LibraryEmployer\nLead\nLIBRARY_DUTY",
    skills: { items: [{ name: "Languages", keywords: ["Rust"] }] },
  });
  mocks.filterProjects.mockImplementation(async (profile: ResumeProfile) => ({
    ...profile,
    sections: {
      ...profile.sections,
      projects: {
        items: [{ name: "Allowed project", description: "Included" }],
      },
    },
  }));
  await generateTailoring("Build APIs", {
    ...profile,
    sections: {
      ...profile.sections,
      skills: { items: [{ name: "Legacy", keywords: ["Java"] }] },
      projects: { items: [{ name: "Old project" }] },
    },
  } as ResumeProfile);
  const text = JSON.stringify(mocks.callJson.mock.calls.at(-1)?.[0].messages);
  for (const fact of ["Rust", "Allowed project", "LIBRARY_DUTY"])
    expect(text).toContain(fact);
  for (const fact of ["Java", "Old project", "LEGACY_DUTY"])
    expect(text).not.toContain(fact);
  expect(text.match(/Rust/g)).toHaveLength(1);
  expect(text.match(/Allowed project/g)).toHaveLength(1);
  expect(mocks.tailoring).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
it("does not resurrect cleared skills or experience, retaining filtered profile projects", async () => {
  mocks.experience.mockResolvedValue("");
  mocks.tailoring.mockResolvedValue({ experience: "", skills: { items: [] } });
  const output = await prompts();
  for (const value of Object.values(output))
    expect(
      typeof value === "string" ? value : JSON.stringify(value),
    ).not.toContain("LEGACY_DUTY");
  expect(output.ghostwriter).not.toContain("Experience:");
  await generateTailoring("Build APIs", {
    ...profile,
    sections: {
      ...profile.sections,
      skills: { items: [{ name: "Languages", keywords: ["Java"] }] },
      projects: { items: [{ name: "Allowed project" }] },
    },
  } as ResumeProfile);
  const text = JSON.stringify(mocks.callJson.mock.calls.at(-1)?.[0].messages);
  expect(text).not.toContain("Java");
  expect(text).not.toContain("LEGACY_DUTY");
  expect(text).toContain("Allowed project");
  vi.useRealTimers();
});
