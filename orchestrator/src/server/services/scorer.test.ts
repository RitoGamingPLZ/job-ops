vi.mock("./candidate-experience", () => ({
  buildCandidateExperienceContext: vi.fn(async () => null),
}));

import { createJob } from "@shared/testing/factories";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getEffectiveSettingsMock,
  getSettingMock,
  resolveLlmModelMock,
  createConfiguredLlmServiceMock,
  callJsonMock,
} = vi.hoisted(() => ({
  getEffectiveSettingsMock: vi.fn(),
  getSettingMock: vi.fn(),
  resolveLlmModelMock: vi.fn(),
  createConfiguredLlmServiceMock: vi.fn(),
  callJsonMock: vi.fn(),
}));

vi.mock("./settings", () => ({
  getEffectiveSettings: getEffectiveSettingsMock,
}));

vi.mock("../repositories/settings", () => ({
  getSetting: getSettingMock,
}));

vi.mock("./modelSelection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modelSelection")>();
  return {
    ...actual,
    resolveLlmModel: resolveLlmModelMock,
    createConfiguredLlmService: createConfiguredLlmServiceMock,
  };
});

describe("salary penalty", () => {
  beforeEach(() => {
    getSettingMock.mockResolvedValue(null);
    getEffectiveSettingsMock.mockResolvedValue({
      penalizeMissingSalary: { value: true, default: true, override: null },
      missingSalaryPenalty: { value: 10, default: 10, override: null },
      scoringInstructions: { value: "", default: "", override: null },
      scoringPromptTemplate: { value: "", default: "", override: null },
    } as any);
    resolveLlmModelMock.mockResolvedValue("gpt-4.1-mini");
    callJsonMock.mockResolvedValue({
      success: true,
      data: { score: 80, reason: "Good match" },
    });
    createConfiguredLlmServiceMock.mockResolvedValue({
      callJson: callJsonMock,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function getScoringPrompt(): string {
    const call = callJsonMock.mock.calls.at(-1)?.[0];
    return call?.messages?.[0]?.content ?? "";
  }

  function getPromptProfile(): Record<string, any> {
    const prompt = getScoringPrompt();
    const match = prompt.match(/CANDIDATE PROFILE:\n(?<profile>[\s\S]*?)\n\nSCORING INSTRUCTIONS:/);
    expect(match?.groups?.profile).toBeDefined();
    return JSON.parse(match?.groups?.profile ?? "{}");
  }

  it("sends minified source job JSON with nulls and no generated state", async () => {
    const { scoreJobSuitability } = await import("./scorer");
    getEffectiveSettingsMock.mockResolvedValue({
      penalizeMissingSalary: { value: false, default: false, override: null },
      missingSalaryPenalty: { value: 10, default: 10, override: null },
      scoringInstructions: { value: "", default: "", override: null },
    } as any);

    await scoreJobSuitability(
      createJob({
        salary: null,
        jobDescription: "<p>Build <strong>TypeScript</strong> services.</p>",
        jobLevel: "senior",
        salaryMinAmount: 80_000,
        companyIndustry: "Fintech",
        skills: "TypeScript, Node.js",
        emails: "jobs@example.com",
        suitabilityScore: 42,
        jobBrief: '{"stale":true}',
        tailoredSummary: "Private tailored summary",
        pdfPath: "/private/resume.pdf",
      }),
      {},
    );

    const match = getScoringPrompt().match(/JOB DATA \(JSON\):\n(?<job>[^\n]+)\n\n/);
    const job = JSON.parse(match?.groups?.job ?? "{}");
    expect(job).toMatchObject({
      salary: null,
      jobLevel: "senior",
      salaryMinAmount: 80_000,
      companyIndustry: "Fintech",
      skills: "TypeScript, Node.js",
      emails: "jobs@example.com",
      jobDescription: "Build TypeScript services.",
    });
    expect(job).not.toHaveProperty("suitabilityScore");
    expect(job).not.toHaveProperty("jobBrief");
    expect(job).not.toHaveProperty("tailoredSummary");
    expect(job).not.toHaveProperty("pdfPath");
    expect(getScoringPrompt()).not.toContain("<strong>");
  });

  describe("profile prompt sanitization", () => {
    it("omits globally excluded projects from scoring", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: { value: "", default: "", override: null },
      } as any);
      getSettingMock.mockImplementation(async (key) =>
        key === "resumeProjects"
          ? JSON.stringify({
              maxProjects: 1,
              lockedProjectIds: ["included"],
              aiSelectableProjectIds: [],
            })
          : null,
      );

      await scoreJobSuitability(createJob({ id: "project-policy-score" }), {
        sections: {
          projects: {
            items: ["included", "excluded"].map((id) => ({
              id,
              name: `${id} project`,
              description: id,
              summary: id,
              date: "2026",
              visible: false,
            })),
          },
        },
      });

      expect(getScoringPrompt()).toContain("included project");
      expect(getScoringPrompt()).not.toContain("excluded project");
    });

    it("includes top-level education and the full top-level CV content", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: { value: "", default: "", override: null },
      } as any);

      await scoreJobSuitability(
        createJob({
          id: "test-job-profile-top-level",
          title: "Software Engineer Intern",
        }),
        {
          basics: {
            label: "Software Engineer",
            summary: "Builds React and TypeScript applications.",
            location: "Sheffield",
            email: "private@example.com",
            phone: "+44 7000 000000",
            website: { url: "https://private.example.com" },
          },
          education: [
            {
              id: "education-private-id",
              school: "University of Lancashire",
              degree: "BSc Software Engineering",
              location: "Preston",
              period: "2022 - 2025",
              description: "Computer Science and Software Engineering.",
              website: { url: "https://university.example.com" },
            },
          ],
          experience: Array.from({ length: 6 }, (_, index) => ({
            company: `Company ${index + 1}`,
            position: "Software Engineer",
            summary: `Experience summary ${index + 1}`,
            roles:
              index === 0
                ? [
                    {
                      id: "role-private-id",
                      position: "Frontend Developer",
                      period: "2024",
                      description: "Built React features.",
                    },
                  ]
                : [],
          })),
        },
      );

      const promptProfile = getPromptProfile();
      expect(promptProfile.basics).toEqual({
        label: "Software Engineer",
        summary: "Builds React and TypeScript applications.",
        location: "Sheffield",
      });
      expect(promptProfile.education).toEqual([
        {
          school: "University of Lancashire",
          degree: "BSc Software Engineering",
          location: "Preston",
          period: "2022 - 2025",
          description: "Computer Science and Software Engineering.",
        },
      ]);
      expect(promptProfile.experience).toHaveLength(6);
      expect(promptProfile.experience[5]).toEqual({
        company: "Company 6",
        position: "Software Engineer",
        summary: "Experience summary 6",
      });
      expect(promptProfile.experience[0].roles).toEqual([
        {
          position: "Frontend Developer",
          period: "2024",
          description: "Built React features.",
        },
      ]);
      expect(getScoringPrompt()).not.toContain("private@example.com");
      expect(getScoringPrompt()).not.toContain("+44 7000 000000");
      expect(getScoringPrompt()).not.toContain("education-private-id");
      expect(getScoringPrompt()).not.toContain("role-private-id");
      expect(getScoringPrompt()).not.toContain("https://university.example.com");
    });

    it("includes education from nested resume sections", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: { value: "", default: "", override: null },
      } as any);

      await scoreJobSuitability(createJob({ id: "test-job-profile-sections" }), {
        sections: {
          education: {
            title: "Education",
            hidden: false,
            items: [
              {
                school: "University of Sheffield",
                degree: "BSc Computer Science",
                area: "Software Engineering",
                location: "Sheffield",
              },
            ],
          },
        },
        metadata: {
          layout: "private-renderer-layout",
        },
      });

      const promptProfile = getPromptProfile();
      expect(promptProfile.education).toEqual([
        {
          school: "University of Sheffield",
          degree: "BSc Computer Science",
          area: "Software Engineering",
          location: "Sheffield",
        },
      ]);
      expect(getScoringPrompt()).not.toContain("private-renderer-layout");
    });

    it("excludes hidden and invisible CV items from prompt content", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: { value: "", default: "", override: null },
      } as any);

      await scoreJobSuitability(createJob({ id: "test-job-profile-hidden-items" }), {
        sections: {
          skills: {
            items: [
              { name: "Frontend", keywords: ["React"], visible: true },
              {
                name: "Hidden Skill",
                keywords: ["PrivateSkill"],
                hidden: true,
              },
              {
                name: "Invisible Skill",
                keywords: ["InvisibleSkill"],
                visible: false,
              },
            ],
          },
          education: {
            items: [
              { school: "Visible University", degree: "BSc Computing" },
              {
                school: "Hidden University",
                degree: "Private Degree",
                hidden: true,
              },
              {
                school: "Invisible University",
                degree: "Invisible Degree",
                visible: false,
              },
            ],
          },
        },
      });

      const promptProfile = getPromptProfile();
      expect(promptProfile.skills).toEqual([{ name: "Frontend", keywords: ["React"] }]);
      expect(promptProfile.education).toEqual([
        { school: "Visible University", degree: "BSc Computing" },
      ]);
      expect(getScoringPrompt()).not.toContain("PrivateSkill");
      expect(getScoringPrompt()).not.toContain("InvisibleSkill");
      expect(getScoringPrompt()).not.toContain("Hidden University");
      expect(getScoringPrompt()).not.toContain("Invisible University");
    });
  });

  describe("isSalaryMissing detection", () => {
    it("uses accepted salary patches before applying the missing-salary penalty", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      callJsonMock.mockResolvedValue({
        success: true,
        data: {
          score: 80,
          reason: "Good match",
          jobPatches: [
            {
              field: "salaryMinAmount",
              value: 45_000,
              confidence: "high",
              evidence: "Salary: £45,000 per year",
            },
          ],
        },
      });

      const result = await scoreJobSuitability(
        createJob({
          salary: null,
          salaryMinAmount: null,
          salaryMaxAmount: null,
          jobDescription: "Salary: £45,000 per year",
        }),
        {},
      );

      expect(result.score).toBe(80);
      expect(result.reason).not.toContain("missing salary");
      expect(result.jobUpdates).toEqual({
        salaryMinAmount: 45_000,
        salarySource: "ai_job_fact_review",
      });
    });

    it("should detect null salary as missing", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(70); // 80 - 10
      expect(result.reason).toContain(
        "Score reduced by 10 points due to missing salary information",
      );
    });

    it("should detect empty string salary as missing", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: "",
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(70);
      expect(result.reason).toContain("missing salary information");
    });

    it("should detect whitespace-only salary as missing", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: "   ",
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(70);
      expect(result.reason).toContain("missing salary information");
    });

    it("should NOT penalize jobs with non-empty salary", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: "Competitive",
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(80); // No penalty
      expect(result.reason).not.toContain("missing salary");
    });

    it("should NOT penalize jobs with actual salary value", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: "£40,000 - £50,000",
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(80); // No penalty
      expect(result.reason).not.toContain("missing salary");
    });
  });

  describe("penalty application", () => {
    it("includes custom scoring instructions in the scorer prompt", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: {
          value: "Open to relocating, so do not mark down for location discrepancies.",
          default: "",
          override: "Open to relocating, so do not mark down for location discrepancies.",
        },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        title: "Software Engineer",
      });

      await scoreJobSuitability(job, {});

      expect(callJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 2,
          messages: [
            expect.objectContaining({
              content: expect.stringContaining(
                "Open to relocating, so do not mark down for location discrepancies.",
              ),
            }),
          ],
        }),
      );
    });

    it("passes maxRetries: 2 on scoring LLM calls", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: { value: "", default: "", override: null },
        scoringPromptTemplate: {
          value: "{{jobTitle}}",
          default: "{{jobTitle}}",
          override: null,
        },
      });
      resolveLlmModelMock.mockResolvedValue("gpt-4o-mini");
      createConfiguredLlmServiceMock.mockResolvedValue({
        callJson: callJsonMock,
      });
      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 85, reason: "Strong fit" },
      });

      await scoreJobSuitability(
        createJob({ id: "retry-check-job", title: "Backend Engineer" }),
        {},
      );

      expect(callJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 2,
        }),
      );
    });

    it("uses per-run scoring instructions instead of global scoring settings", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: {
          value: "Global instruction that should not be used.",
          default: "",
          override: "Global instruction that should not be used.",
        },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      await scoreJobSuitability(
        createJob({
          id: "test-job-per-run-instructions",
          title: "Software Engineer",
        }),
        {},
        {
          scoringInstructions: "Prefer roles above GBP 60k and lower-score graduate programmes.",
        },
      );

      const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
      expect(prompt).toContain("Prefer roles above GBP 60k and lower-score graduate programmes.");
      expect(prompt).not.toContain("Global instruction that should not be used.");
    });

    it("uses a custom scoring prompt template override", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
        scoringInstructions: {
          value: "Prioritize backend work.",
          default: "",
          override: "Prioritize backend work.",
        },
        scoringPromptTemplate: {
          value: "Custom scoring {{jobTitle}} {{scoringInstructionsText}} {{unknownToken}}",
          default: "",
          override: "Custom scoring {{jobTitle}} {{scoringInstructionsText}} {{unknownToken}}",
        },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: {
          score: 80,
          reason: "Good match",
          jobBrief: {
            role_summary: "Build backend services.",
            they_want: ["TypeScript"],
            specifics: ["Node.js"],
            company_offers: [],
            practical_details: ["Salary: Not stated"],
            missing_or_unclear: ["Sponsorship"],
            repeated_signals: ["Ownership"],
          },
        },
      });

      const result = await scoreJobSuitability(
        createJob({
          id: "test-job-custom-template",
          title: "Backend Engineer",
        }),
        {},
      );

      expect(callJsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              content: expect.stringContaining(
                "Custom scoring Backend Engineer Prioritize backend work. {{unknownToken}}",
              ),
            }),
          ],
          jsonSchema: expect.objectContaining({
            schema: expect.objectContaining({
              required: ["score", "reason", "jobBrief", "jobPatches", "jobWarnings"],
            }),
          }),
        }),
      );
      expect(getScoringPrompt()).toContain('"jobBrief"');
      expect(getScoringPrompt()).toContain('"jobPatches"');
      expect(getScoringPrompt()).toContain(
        "Do not guess, infer from general knowledge, estimate, annualise compensation",
      );
      expect(getScoringPrompt()).toContain("JOB DATA (JSON):");
      expect(getScoringPrompt()).toContain('"jobDescription":"Job description content"');
      expect(JSON.parse(result.jobBrief as string)).toEqual(
        expect.objectContaining({ role_summary: "Build backend services." }),
      );
    });

    it("should not apply penalty when disabled", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(80); // No penalty when disabled
      expect(result.reason).not.toContain("missing salary");
    });

    it("should clamp score to minimum 0 (high penalty on medium score)", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 100, default: 100, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 50, reason: "Average match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(0); // Clamped, not negative
      expect(result.reason).toContain("Score reduced by 100 points");
    });

    it("should clamp score to minimum 0 (low score with penalty)", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 5, reason: "Weak match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(0); // 5 - 10 = -5, clamped to 0
      expect(result.reason).toContain("Score reduced by 10 points");
    });

    it("should handle penalty of 0", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 0, default: 0, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 80, reason: "Good match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(80); // No change with 0 penalty
      expect(result.reason).toContain("Score reduced by 0 points");
    });

    it("should apply penalty with correct amount", async () => {
      const { scoreJobSuitability } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: true, default: true, override: null },
        missingSalaryPenalty: { value: 25, default: 25, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: 90, reason: "Excellent match" },
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });
      const result = await scoreJobSuitability(job, {});

      expect(result.score).toBe(65); // 90 - 25
      expect(result.reason).toContain(
        "Score reduced by 25 points due to missing salary information",
      );
    });
  });

  describe("LlmNotConfiguredError", () => {
    it("should throw LlmNotConfiguredError when API key is not configured", async () => {
      const { scoreJobSuitability, LlmNotConfiguredError } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: false,
        error: "LLM API key not configured",
      });

      const job = createJob({
        id: "test-job-1",
        salary: null,
        title: "Software Engineer",
      });

      await expect(scoreJobSuitability(job, {})).rejects.toThrow(LlmNotConfiguredError);
    });

    it("should throw LlmNotConfiguredError when the provider rejects the credentials", async () => {
      const { scoreJobSuitability, LlmNotConfiguredError } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: false,
        error: "LLM API error: 401 - Invalid API key",
      });

      const job = createJob({
        id: "test-job-2",
        title: "Software Engineer",
      });

      await expect(scoreJobSuitability(job, {})).rejects.toThrow(LlmNotConfiguredError);
    });

    it("should throw ScoringUnavailableError for transient provider faults", async () => {
      const { scoreJobSuitability, ScoringUnavailableError } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: false,
        error: "No content in response",
      });

      const job = createJob({
        id: "test-job-2",
        title: "Software Engineer",
      });

      await expect(scoreJobSuitability(job, {})).rejects.toThrow(ScoringUnavailableError);
    });

    it("should throw ScoringUnavailableError when the AI returns no numeric score", async () => {
      const { scoreJobSuitability, ScoringUnavailableError } = await import("./scorer");
      getEffectiveSettingsMock.mockResolvedValue({
        penalizeMissingSalary: { value: false, default: false, override: null },
        missingSalaryPenalty: { value: 10, default: 10, override: null },
      } as any);

      callJsonMock.mockResolvedValue({
        success: true,
        data: { score: "not-a-number", reason: "Confused model" },
      });

      const job = createJob({
        id: "test-job-3",
        title: "Software Engineer",
      });

      await expect(scoreJobSuitability(job, {})).rejects.toThrow(ScoringUnavailableError);
    });
  });
});
