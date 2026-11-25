import { describe, expect, it } from "vitest";
import {
  getDefaultPromptTemplate,
  LEGACY_RESUME_GENERATION_PROMPT_TEMPLATE,
} from "./prompt-template-definitions";
import { getDefaultModelForProvider, settingsRegistry } from "./settings-registry";

describe("settingsRegistry helpers", () => {
  it("treats only the exact legacy generation default as unset", () => {
    const parse = settingsRegistry.resumeGenerationPromptTemplate.parse;
    expect(parse(LEGACY_RESUME_GENERATION_PROMPT_TEMPLATE)).toBeNull();
    const custom = `${LEGACY_RESUME_GENERATION_PROMPT_TEMPLATE} Custom priority.`;
    expect(parse(custom)).toBe(custom);
    expect(parse("Focus on leadership")).toBe("Focus on leadership");
  });
  it("uses a bare API Route default and preserves explicit model choices", () => {
    expect(getDefaultModelForProvider("api_route")).toBe("gpt-6.1-sol");
    expect(getDefaultModelForProvider("api-route", "claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
  describe("searchCities defaults", () => {
    it("defaults to empty when no location env is configured", () => {
      const previousSearchCities = process.env.SEARCH_CITIES;
      const previousJobspyLocation = process.env.JOBSPY_LOCATION;

      delete process.env.SEARCH_CITIES;
      delete process.env.JOBSPY_LOCATION;

      try {
        expect(settingsRegistry.searchCities.default()).toBe("");
      } finally {
        if (previousSearchCities === undefined) {
          delete process.env.SEARCH_CITIES;
        } else {
          process.env.SEARCH_CITIES = previousSearchCities;
        }

        if (previousJobspyLocation === undefined) {
          delete process.env.JOBSPY_LOCATION;
        } else {
          process.env.JOBSPY_LOCATION = previousJobspyLocation;
        }
      }
    });

    it("uses explicit SEARCH_CITIES or legacy JOBSPY_LOCATION env values", () => {
      const previousSearchCities = process.env.SEARCH_CITIES;
      const previousJobspyLocation = process.env.JOBSPY_LOCATION;

      process.env.SEARCH_CITIES = "Leeds|London";
      process.env.JOBSPY_LOCATION = "Manchester";

      try {
        expect(settingsRegistry.searchCities.default()).toBe("Leeds|London");
        delete process.env.SEARCH_CITIES;
        expect(settingsRegistry.searchCities.default()).toBe("Manchester");
      } finally {
        if (previousSearchCities === undefined) {
          delete process.env.SEARCH_CITIES;
        } else {
          process.env.SEARCH_CITIES = previousSearchCities;
        }

        if (previousJobspyLocation === undefined) {
          delete process.env.JOBSPY_LOCATION;
        } else {
          process.env.JOBSPY_LOCATION = previousJobspyLocation;
        }
      }
    });

    it("does not default jobspyCountryIndeed to UK when no env is configured", () => {
      const previousJobspyCountryIndeed = process.env.JOBSPY_COUNTRY_INDEED;
      delete process.env.JOBSPY_COUNTRY_INDEED;

      try {
        expect(settingsRegistry.jobspyCountryIndeed.default()).toBe("");
      } finally {
        if (previousJobspyCountryIndeed === undefined) {
          delete process.env.JOBSPY_COUNTRY_INDEED;
        } else {
          process.env.JOBSPY_COUNTRY_INDEED = previousJobspyCountryIndeed;
        }
      }
    });

    it("defaults location scope and strictness to explicit local matching", () => {
      expect(settingsRegistry.locationSearchScope.default()).toBe("selected_only");
      expect(settingsRegistry.locationMatchStrictness.default()).toBe("exact_only");
    });
  });

  describe("string parsing (parseNonEmptyStringOrNull)", () => {
    it("returns null for undefined", () => {
      expect(settingsRegistry.model.parse(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(settingsRegistry.searchCities.parse("")).toBeNull();
    });

    it("returns the string for non-empty string", () => {
      expect(settingsRegistry.searchCities.parse("London")).toBe("London");
    });

    it("uses shared default prompt templates for prompt settings", () => {
      expect(settingsRegistry.ghostwriterSystemPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("ghostwriterSystemPromptTemplate"),
      );
      expect(settingsRegistry.resumeGenerationPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("resumeGenerationPromptTemplate"),
      );
      expect(settingsRegistry.tailoringPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("tailoringPromptTemplate"),
      );
      expect(settingsRegistry.scoringPromptTemplate.default()).toBe(
        getDefaultPromptTemplate("scoringPromptTemplate"),
      );
    });
  });

  describe("number parsing and clamping", () => {
    it("returns null for empty/invalid values", () => {
      expect(settingsRegistry.ukvisajobsMaxJobs.parse("")).toBeNull();
      expect(settingsRegistry.ukvisajobsMaxJobs.parse("abc")).toBeNull();
      expect(settingsRegistry.ukvisajobsMaxJobs.parse(undefined)).toBeNull();
    });

    it("parses valid numbers", () => {
      expect(settingsRegistry.ukvisajobsMaxJobs.parse("42")).toBe(42);
    });

    it("uses env-backed defaults for jobindex per-term caps", () => {
      const previousJobindexMaxJobsPerTerm = process.env.JOBINDEX_MAX_JOBS_PER_TERM;

      process.env.JOBINDEX_MAX_JOBS_PER_TERM = "75";

      try {
        expect(settingsRegistry.jobindexMaxJobsPerTerm.default()).toBe(75);
        expect(settingsRegistry.jobindexMaxJobsPerTerm.parse("25")).toBe(25);
      } finally {
        if (previousJobindexMaxJobsPerTerm === undefined) {
          delete process.env.JOBINDEX_MAX_JOBS_PER_TERM;
        } else {
          process.env.JOBINDEX_MAX_JOBS_PER_TERM = previousJobindexMaxJobsPerTerm;
        }
      }
    });

    it("clamps backupHour to 0-23", () => {
      expect(settingsRegistry.backupHour.parse("25")).toBe(23);
      expect(settingsRegistry.backupHour.parse("-1")).toBe(0);
      expect(settingsRegistry.backupHour.parse("12")).toBe(12);
    });

    it("clamps backupMaxCount to 1-5", () => {
      expect(settingsRegistry.backupMaxCount.parse("10")).toBe(5);
      expect(settingsRegistry.backupMaxCount.parse("0")).toBe(1);
      expect(settingsRegistry.backupMaxCount.parse("3")).toBe(3);
    });

    it("clamps missingSalaryPenalty to 0-100", () => {
      expect(settingsRegistry.missingSalaryPenalty.parse("150")).toBe(100);
      expect(settingsRegistry.missingSalaryPenalty.parse("-10")).toBe(0);
      expect(settingsRegistry.missingSalaryPenalty.parse("50")).toBe(50);
    });
  });

  describe("boolean (bit-bool) parsing and serialization", () => {
    it("parses bit bools correctly", () => {
      expect(settingsRegistry.renderMarkdownInJobDescriptions.parse("1")).toBe(true);
      expect(settingsRegistry.renderMarkdownInJobDescriptions.parse("0")).toBe(false);
      expect(settingsRegistry.ghostwriterStopSlopEnabled.parse("1")).toBe(true);
      expect(settingsRegistry.ghostwriterStopSlopEnabled.parse("0")).toBe(false);
    });

    it("serializes bit bools correctly", () => {
      expect(settingsRegistry.renderMarkdownInJobDescriptions.serialize(true)).toBe("1");
      expect(settingsRegistry.renderMarkdownInJobDescriptions.serialize(false)).toBe("0");
      expect(settingsRegistry.ghostwriterStopSlopEnabled.serialize(true)).toBe("1");
      expect(settingsRegistry.ghostwriterStopSlopEnabled.serialize(false)).toBe("0");
    });
  });

  describe("JSON array parsing", () => {
    it("parses valid JSON arrays", () => {
      expect(settingsRegistry.searchTerms.parse('["dev", "engineer"]')).toEqual([
        "dev",
        "engineer",
      ]);
    });

    it("returns null for invalid JSON or non-arrays", () => {
      expect(settingsRegistry.searchTerms.parse('{"not": "array"}')).toBeNull();
      expect(settingsRegistry.searchTerms.parse("invalid json")).toBeNull();
      expect(settingsRegistry.searchTerms.parse("")).toBeNull();
      expect(settingsRegistry.searchTerms.parse(undefined)).toBeNull();
    });

    it("serializes arrays back to JSON", () => {
      expect(settingsRegistry.searchTerms.serialize(["dev", "engineer"])).toBe(
        '["dev","engineer"]',
      );
      expect(settingsRegistry.searchTerms.serialize(null)).toBeNull();
    });

    it("parses valid workplace type arrays", () => {
      expect(settingsRegistry.workplaceTypes.parse('["remote","onsite"]')).toEqual([
        "remote",
        "onsite",
      ]);
    });

    it("rejects invalid workplace type arrays", () => {
      expect(settingsRegistry.workplaceTypes.parse('["remote","satellite"]')).toBeNull();
      expect(settingsRegistry.workplaceTypes.parse("[]")).toBeNull();
    });
  });

  describe("Resume projects settings", () => {
    it("parses and serializes resume projects", () => {
      const obj = {
        maxProjects: 10,
        lockedProjectIds: ["1", "2"],
        aiSelectableProjectIds: ["3"],
      };
      const json = JSON.stringify(obj);

      expect(settingsRegistry.resumeProjects.parse(json)).toEqual(obj);
      expect(settingsRegistry.resumeProjects.parse("invalid")).toBeNull();

      expect(settingsRegistry.resumeProjects.serialize(obj)).toBe(json);
      expect(settingsRegistry.resumeProjects.serialize(null)).toBeNull();
    });
  });

  describe("writing-style language settings", () => {
    it("defaults to manual english", () => {
      const previousLanguageMode = process.env.CHAT_STYLE_LANGUAGE_MODE;
      const previousManualLanguage = process.env.CHAT_STYLE_MANUAL_LANGUAGE;

      delete process.env.CHAT_STYLE_LANGUAGE_MODE;
      delete process.env.CHAT_STYLE_MANUAL_LANGUAGE;

      try {
        expect(settingsRegistry.chatStyleLanguageMode.default()).toBe("manual");
        expect(settingsRegistry.chatStyleManualLanguage.default()).toBe("english");
      } finally {
        if (previousLanguageMode === undefined) {
          delete process.env.CHAT_STYLE_LANGUAGE_MODE;
        } else {
          process.env.CHAT_STYLE_LANGUAGE_MODE = previousLanguageMode;
        }

        if (previousManualLanguage === undefined) {
          delete process.env.CHAT_STYLE_MANUAL_LANGUAGE;
        } else {
          process.env.CHAT_STYLE_MANUAL_LANGUAGE = previousManualLanguage;
        }
      }
    });

    it("parses and serializes supported language settings", () => {
      expect(settingsRegistry.chatStyleLanguageMode.parse("manual")).toBe("manual");
      expect(settingsRegistry.chatStyleLanguageMode.parse("match-resume")).toBe("match-resume");
      expect(settingsRegistry.chatStyleLanguageMode.parse("match-job-description")).toBe(
        "match-job-description",
      );
      expect(settingsRegistry.chatStyleLanguageMode.parse("auto")).toBeNull();
      expect(settingsRegistry.chatStyleLanguageMode.parse("")).toBeNull();
      expect(settingsRegistry.chatStyleLanguageMode.serialize("match-job-description")).toBe(
        "match-job-description",
      );
      expect(settingsRegistry.chatStyleLanguageMode.serialize(null)).toBeNull();

      expect(settingsRegistry.chatStyleManualLanguage.parse("english")).toBe("english");
      expect(settingsRegistry.chatStyleManualLanguage.parse("german")).toBe("german");
      expect(settingsRegistry.chatStyleManualLanguage.parse("italian")).toBeNull();
      expect(settingsRegistry.chatStyleManualLanguage.parse("")).toBeNull();
      expect(settingsRegistry.chatStyleManualLanguage.serialize("spanish")).toBe("spanish");
      expect(settingsRegistry.chatStyleManualLanguage.serialize(null)).toBeNull();
    });
  });

  describe("LLM provider parsing", () => {
    it("normalizes the documented openai-compatible alias", () => {
      expect(settingsRegistry.llmProvider.parse("openai-compatible")).toBe("openai_compatible");
      expect(settingsRegistry.llmProvider.parse("OPENAI-COMPATIBLE")).toBe("openai_compatible");
    });

    it("accepts gemini_cli including hyphenated alias", () => {
      expect(settingsRegistry.llmProvider.parse("gemini_cli")).toBe("gemini_cli");
      expect(settingsRegistry.llmProvider.parse("gemini-cli")).toBe("gemini_cli");
    });

    it("accepts claude_cli including hyphenated alias", () => {
      expect(settingsRegistry.llmProvider.parse("claude_cli")).toBe("claude_cli");
      expect(settingsRegistry.llmProvider.parse("claude-cli")).toBe("claude_cli");
    });

    it("accepts GLM provider aliases", () => {
      expect(settingsRegistry.llmProvider.parse("glm")).toBe("glm");
      expect(settingsRegistry.llmProvider.parse("zhipu-ai")).toBe("glm");
      expect(settingsRegistry.llmProvider.parse("bigmodel")).toBe("glm");
    });

    it("accepts the Claude alias for Anthropic", () => {
      expect(settingsRegistry.llmProvider.parse("claude")).toBe("anthropic");
    });

    it("uses provider-specific default models", () => {
      expect(getDefaultModelForProvider("atlascloud")).toBe("deepseek-ai/deepseek-v3.2");
      expect(getDefaultModelForProvider("openai")).toBe("gpt-5.4-mini");
      expect(getDefaultModelForProvider("anthropic")).toBe("claude-sonnet-4-6");
      expect(getDefaultModelForProvider("glm")).toBe("glm-5.1");
      expect(getDefaultModelForProvider("gemini")).toBe("google/gemini-3.1-flash-lite");
      expect(getDefaultModelForProvider("gemini_cli")).toBe("google/gemini-3.1-flash-lite");
      expect(getDefaultModelForProvider("claude_cli")).toBe("claude-sonnet-5");
      expect(getDefaultModelForProvider("codex")).toBe("gpt-5.4-mini");
      expect(getDefaultModelForProvider("ollama")).toBe("");
      expect(getDefaultModelForProvider("litellm")).toBe("");
      expect(getDefaultModelForProvider("openrouter")).toBe("google/gemini-3.1-flash-lite");
    });
  });

  describe("LLM purpose override parsing", () => {
    it("normalizes structured purpose overrides and drops empty purpose entries", () => {
      const raw = JSON.stringify({
        scoring: { model: "  llama3.2  " },
        tailoring: {
          provider: "openai-compatible",
          baseUrl: "https://api.openai.com",
          model: "gpt-5.4-mini",
        },
        projectSelection: {},
      });

      expect(settingsRegistry.llmPurposeOverrides.parse(raw)).toEqual({
        scoring: { model: "llama3.2" },
        tailoring: {
          provider: "openai_compatible",
          baseUrl: "https://api.openai.com",
          model: "gpt-5.4-mini",
        },
      });
    });

    it("returns null for malformed stored purpose overrides", () => {
      expect(
        settingsRegistry.llmPurposeOverrides.parse(JSON.stringify({ tailoring: { baseUrl: 123 } })),
      ).toBeNull();
      expect(
        settingsRegistry.llmPurposeOverrides.parse(
          JSON.stringify({ tailoring: { provider: "unknown" } }),
        ),
      ).toBeNull();
    });

    it("normalizes whitespace-only purpose override base URLs as empty", () => {
      expect(
        settingsRegistry.llmPurposeOverrides.parse(
          JSON.stringify({
            scoring: { baseUrl: "   ", model: "  llama3.2  " },
            tailoring: { baseUrl: "\t\n" },
          }),
        ),
      ).toEqual({ scoring: { model: "llama3.2" } });
    });

    it("returns null for malformed stored purpose API keys", () => {
      expect(
        settingsRegistry.llmPurposeApiKeys.parse(JSON.stringify({ tailoring: 123 })),
      ).toBeNull();
      expect(
        settingsRegistry.llmPurposeApiKeys.parse(
          JSON.stringify({ tailoring: "sk-test", extra: "sk-extra" }),
        ),
      ).toBeNull();
    });

    it("normalizes purpose API keys and serializes empty keys as null", () => {
      expect(
        settingsRegistry.llmPurposeApiKeys.parse(
          JSON.stringify({ tailoring: "  sk-test  ", scoring: "" }),
        ),
      ).toEqual({ tailoring: "sk-test" });
      expect(settingsRegistry.llmPurposeApiKeys.serialize({})).toBeNull();
      expect(
        settingsRegistry.llmPurposeApiKeys.serialize({
          tailoring: "",
          scoring: null,
        }),
      ).toBeNull();
    });

    it("serializes empty purpose overrides as null", () => {
      expect(settingsRegistry.llmPurposeOverrides.serialize({})).toBeNull();
      expect(
        settingsRegistry.llmPurposeOverrides.serialize({
          tailoring: { model: "gpt-5.4-mini" },
        }),
      ).toBe(JSON.stringify({ tailoring: { model: "gpt-5.4-mini" } }));
    });
  });
});

describe("pipeline schedule settings", () => {
  it("defaults to disabled at 07:00 and accepts only local hours", () => {
    expect(settingsRegistry.pipelineScheduleEnabled.default()).toBe(false);
    expect(settingsRegistry.pipelineScheduleHour.default()).toBe(7);
    for (const hour of [0, 7, 23])
      expect(settingsRegistry.pipelineScheduleHour.schema.safeParse(hour).success).toBe(true);
    for (const hour of [-1, 24, 7.5])
      expect(settingsRegistry.pipelineScheduleHour.schema.safeParse(hour).success).toBe(false);
    expect(settingsRegistry.pipelineScheduleEnabled.serialize(true)).toBe("1");
    expect(settingsRegistry.pipelineScheduleHour.parse("24")).toBeNull();
  });
});
