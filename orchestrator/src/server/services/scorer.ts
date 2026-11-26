/**
 * Service for scoring job suitability using AI.
 */

import { logger } from "@infra/logger";
import { asRecord } from "@shared/utils/type-conversion";
import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import type { Job, JobBrief, UpdateJobInput } from "@shared/types";
import { stripHtmlTags } from "@shared/utils/string";
import { buildCandidateExperienceContext } from "./candidate-experience";
import { withHostedUsageReservation } from "./hosted-usage";
import {
  type JobFactPatch,
  PATCHABLE_JOB_FIELDS,
  validateAndApplyJobPatches,
} from "./job-fact-patches";
import { isConfigurationFailure } from "./llm/policies/configuration-error";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import { renderPromptTemplate } from "./prompt-templates";
import { filterProfileProjectsForAi } from "./resumeProjects";
import { getEffectiveSettings } from "./settings";

export class LlmNotConfiguredError extends Error {
  constructor(message?: string) {
    super(message ?? "LLM API key not configured");
    this.name = "LlmNotConfiguredError";
  }
}

/**
 * A scoring attempt failed for a reason that is not a configuration problem —
 * a transient provider fault, an unusable completion, an outage. The job can
 * simply be scored again later; the user's settings need no attention.
 */
export class ScoringUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringUnavailableError";
  }
}

interface SuitabilityResult {
  score: number | null; // 0-100, or null when scoring failed
  reason: string; // Explanation
  jobBrief: string | null;
  jobUpdates?: UpdateJobInput;
}

type ScoringPreferences = {
  instructions: string;
  promptTemplate: string;
};

type ProfileRecord = Record<string, unknown>;

/** JSON schema for suitability scoring response */
const SCORING_SCHEMA: JsonSchemaDefinition = {
  name: "job_suitability_score",
  schema: {
    type: "object",
    properties: {
      score: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Suitability score from 0 to 100",
      },
      reason: {
        type: "string",
        description: "Brief 1-2 sentence explanation of the score",
      },
      jobBrief: {
        type: "object",
        properties: {
          role_summary: {
            type: "string",
            description: "One sentence summarizing what the person would do",
          },
          they_want: {
            type: "array",
            maxItems: 6,
            items: { type: "string" },
          },
          specifics: {
            type: "array",
            maxItems: 18,
            items: {
              type: "string",
              description: "A concise highlight of at most 4 words",
            },
          },
          company_offers: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
          practical_details: {
            type: "array",
            maxItems: 8,
            items: { type: "string" },
          },
          missing_or_unclear: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
          repeated_signals: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
        },
        required: [
          "role_summary",
          "they_want",
          "specifics",
          "company_offers",
          "practical_details",
          "missing_or_unclear",
          "repeated_signals",
        ],
        additionalProperties: false,
      },
      jobPatches: {
        type: "array",
        maxItems: PATCHABLE_JOB_FIELDS.length,
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: [...PATCHABLE_JOB_FIELDS] },
            value: {
              anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            evidence: { type: "string" },
          },
          required: ["field", "value", "confidence", "evidence"],
          additionalProperties: false,
        },
      },
      jobWarnings: {
        type: "array",
        maxItems: 10,
        items: { type: "string" },
      },
    },
    required: ["score", "reason", "jobBrief", "jobPatches", "jobWarnings"],
    additionalProperties: false,
  },
};

const SCORING_OUTPUT_INSTRUCTIONS = `
Perform these tasks in one response:
1. JOB FACT REVIEW (candidate-independent): compare JOB DATA with the original listing. Use only those sources, never the candidate profile. Propose a patch only for a missing or clearly incorrect whitelisted field with an exact supporting listing excerpt. Do not guess, infer from general knowledge, estimate, annualise compensation, or paraphrase/invent evidence. Use high confidence for clear corrections; medium may only fill missing values; omit ambiguous corrections. Candidate evaluation must use the proposed corrected facts.
2. JOB BRIEF: use only stated job information, remain neutral, remove employer fluff, never judge candidate fit, and use "Not stated" for missing practical details. Write specifics (Highlights) as concise phrases of at most 4 words each. Preserve negations, numbers, and essential qualifiers; omit a highlight if it cannot be shortened accurately.
3. CANDIDATE EVALUATION: score the candidate against the listing, corrected facts, and scoring instructions.

Patchable fields: ${PATCHABLE_JOB_FIELDS.join(", ")}.
Value conventions: salaryInterval is hourly|daily|weekly|monthly|yearly; salary amounts and vacancyCount are numbers without annualisation; salaryCurrency is a 3-letter code; isRemote is boolean; workFromHomeType is remote|hybrid|onsite; all other patch values are strings. Return only changed fields. Put unsupported distinctions or explicit contradictions that cannot be represented safely in jobWarnings.

Respond with ONLY valid JSON in this exact shape:
{
  "score": <integer 0-100>,
  "reason": "<1-2 sentence explanation>",
  "jobBrief": {
    "role_summary": "<one sentence describing what the person would do>",
    "they_want": ["<up to 6 stated requirements>"],
    "specifics": ["<up to 18 concrete tools, responsibilities, domain or working-pattern details; at most 4 words per item>"],
    "company_offers": ["<up to 5 concrete offerings>"],
    "practical_details": ["<up to 8 key-value details such as Salary: Not stated>"],
    "missing_or_unclear": ["<up to 5 important missing details>"],
    "repeated_signals": ["<up to 5 repeated themes>"]
  },
  "jobPatches": [{"field":"<whitelisted field>","value":<string|number|boolean>,"confidence":"high|medium|low","evidence":"<exact listing excerpt>"}],
  "jobWarnings": ["<unrepresentable or contradictory stated fact>"]
}
No markdown, code fences, or text outside the JSON.`.trim();

const NON_SOURCE_JOB_FIELDS = new Set<keyof Job>([
  "id",
  "locationMatch",
  "status",
  "outcome",
  "closedAt",
  "suitabilityScore",
  "suitabilityReason",
  "jobBrief",
  "tailoredSummary",
  "tailoredHeadline",
  "tailoredSkills",
  "selectedProjectIds",
  "pdfPath",
  "pdfSource",
  "pdfRegenerating",
  "pdfFreshness",
  "pdfFingerprint",
  "pdfGeneratedAt",
  "appliedDuplicateMatch",
  "discoveredAt",
  "processedAt",
  "readyAt",
  "appliedAt",
  "createdAt",
  "updatedAt",
]);

/**
 * Check if a job's salary field is missing/empty.
 * Returns true for null, empty string, or whitespace-only strings.
 */
function isSalaryMissing(job: Job): boolean {
  return !job.salary?.trim() && job.salaryMinAmount == null && job.salaryMaxAmount == null;
}

/**
 * Apply salary penalty to a score if enabled.
 * Returns the adjusted score, adjusted reason, and whether penalty was applied.
 */
function applySalaryPenalty(
  job: Job,
  originalScore: number,
  originalReason: string,
  settings: { penalizeMissingSalary: boolean; missingSalaryPenalty: number },
): { score: number; reason: string; penaltyApplied: boolean } {
  if (!settings.penalizeMissingSalary || !isSalaryMissing(job)) {
    return {
      score: originalScore,
      reason: originalReason,
      penaltyApplied: false,
    };
  }

  const penalty = settings.missingSalaryPenalty;
  const adjustedScore = Math.max(0, originalScore - penalty);
  const penaltyText = `Score reduced by ${penalty} points due to missing salary information.`;
  const adjustedReason = `${originalReason} ${penaltyText}`;

  logger.info("Applied salary penalty", {
    jobId: job.id,
    originalScore,
    penalty,
    finalScore: adjustedScore,
  });

  return { score: adjustedScore, reason: adjustedReason, penaltyApplied: true };
}

/**
 * Score a job's suitability based on profile and job description.
 * Includes retry logic for when AI returns garbage responses.
 */
export async function scoreJobSuitability(
  job: Job,
  profile: Record<string, unknown>,
  options: { scoringInstructions?: string; skipHostedUsage?: boolean } = {},
): Promise<SuitabilityResult> {
  if (!options.skipHostedUsage) {
    return withHostedUsageReservation({ action: "tailoring" }, async () => ({
      result: await scoreJobSuitability(job, profile, {
        ...options,
        skipHostedUsage: true,
      }),
      usedUnits: 1,
    }));
  }

  const [model, settings, aiProfile] = await Promise.all([
    resolveLlmModel("scoring"),
    getEffectiveSettings(),
    filterProfileProjectsForAi(profile),
  ]);
  const scoringInstructions = Object.hasOwn(options, "scoringInstructions")
    ? (options.scoringInstructions ?? "")
    : (settings.scoringInstructions?.value ?? "");

  const promptProfile = sanitizeProfileForPrompt(aiProfile);
  const experience = await buildCandidateExperienceContext();
  if (experience !== null) promptProfile.experience = experience;
  const prompt = buildScoringPrompt(job, promptProfile, {
    instructions: scoringInstructions,
    promptTemplate:
      settings.scoringPromptTemplate?.value ?? getDefaultPromptTemplate("scoringPromptTemplate"),
  });

  const llm = await createConfiguredLlmService("scoring");
  const result = await llm.callJson<{
    score: number;
    reason: string;
    jobBrief?: JobBrief;
    jobPatches?: JobFactPatch[];
    jobWarnings?: string[];
  }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: SCORING_SCHEMA,
    maxRetries: 2,
    jobId: job.id,
  });

  if (!result.success) {
    if (isConfigurationFailure(result.error)) {
      logger.warn("Scoring failed — pausing pipeline", {
        jobId: job.id,
        error: result.error,
      });
      throw new LlmNotConfiguredError(
        `AI scoring failed: ${result.error}. Check your LLM configuration in Settings → Integrations, then resume scoring.`,
      );
    }
    logger.warn("Scoring failed", {
      jobId: job.id,
      error: result.error,
    });
    throw new ScoringUnavailableError(`AI scoring failed: ${result.error}`);
  }

  const { score, reason } = result.data;

  // Validate we got a reasonable response
  if (typeof score !== "number" || Number.isNaN(score)) {
    logger.warn("Invalid score in AI response", {
      jobId: job.id,
    });
    throw new ScoringUnavailableError(
      "AI returned invalid scoring data (no numeric score in the response)",
    );
  }

  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
  const clampedReason = reason || "No explanation provided";
  const patchResult = validateAndApplyJobPatches(job, result.data.jobPatches ?? []);

  if (patchResult.accepted.length > 0 || patchResult.rejected.length > 0) {
    logger.info("Reviewed AI job fact patches", {
      jobId: job.id,
      accepted: patchResult.accepted,
      rejected: patchResult.rejected,
    });
  }
  if (result.data.jobWarnings?.length) {
    logger.warn("AI job fact review warnings", {
      jobId: job.id,
      warnings: result.data.jobWarnings,
    });
  }

  // Apply salary penalty if enabled
  const penaltyResult = applySalaryPenalty(patchResult.patchedJob, clampedScore, clampedReason, {
    penalizeMissingSalary: settings.penalizeMissingSalary.value,
    missingSalaryPenalty: settings.missingSalaryPenalty.value,
  });

  return {
    score: penaltyResult.score,
    reason: penaltyResult.reason,
    jobBrief:
      job.jobDescription?.trim() && result.data.jobBrief
        ? JSON.stringify(result.data.jobBrief)
        : null,
    jobUpdates: patchResult.updates,
  };
}

function buildScoringPrompt(
  job: Job,
  profile: Record<string, unknown>,
  preferences: ScoringPreferences,
): string {
  const jobDescription = stripHtmlTags(job.jobDescription ?? "") || null;
  const jobJson = JSON.stringify({
    ...Object.fromEntries(
      Object.entries(job).filter(([key]) => !NON_SOURCE_JOB_FIELDS.has(key as keyof Job)),
    ),
    jobDescription,
  });

  return `${renderPromptTemplate(preferences.promptTemplate, {
    profileJson: JSON.stringify(profile),
    jobTitle: job.title,
    employer: job.employer,
    location: job.location || "Not specified",
    salary: job.salary || "Not specified",
    degreeRequired: job.degreeRequired || "Not specified",
    disciplines: job.disciplines || "Not specified",
    jobDescription: jobDescription || "No description available",
    scoringInstructionsText: preferences.instructions
      ? preferences.instructions
      : "No additional custom scoring instructions.",
  })}\n\nJOB DATA (JSON):\n${jobJson}\n\n${SCORING_OUTPUT_INSTRUCTIONS}`;
}

function sanitizeProfileForPrompt(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    basics: sanitizeBasics(profile.basics),
    skills: sanitizeItems(profile, "skills", [
      "name",
      "description",
      "level",
      "proficiency",
      "keywords",
    ]),
    experience: sanitizeItems(profile, "experience", [
      "company",
      "position",
      "location",
      "date",
      "period",
      "summary",
      "description",
    ]),
    projects: sanitizeItems(profile, "projects", [
      "name",
      "description",
      "date",
      "period",
      "summary",
      "keywords",
    ]),
    education: sanitizeItems(profile, "education", [
      "school",
      "institution",
      "degree",
      "area",
      "grade",
      "location",
      "date",
      "period",
      "summary",
      "description",
    ]),
    languages: sanitizeItems(profile, "languages", ["language", "fluency", "level"]),
    awards: sanitizeItems(profile, "awards", [
      "title",
      "awarder",
      "date",
      "summary",
      "description",
    ]),
    certifications: sanitizeItems(profile, "certifications", [
      "title",
      "issuer",
      "date",
      "summary",
      "description",
    ]),
    publications: sanitizeItems(profile, "publications", [
      "title",
      "publisher",
      "date",
      "summary",
      "description",
    ]),
    volunteer: sanitizeItems(profile, "volunteer", [
      "organization",
      "position",
      "location",
      "date",
      "period",
      "summary",
      "description",
    ]),
    interests: sanitizeItems(profile, "interests", ["name", "summary", "description", "keywords"]),
  };
}

function sanitizeBasics(value: unknown): ProfileRecord {
  const record = asRecord(value);
  if (!record) return {};
  return pickDefined(record, ["label", "headline", "summary", "location"]);
}

function sanitizeItems(
  profile: ProfileRecord,
  sectionKey: string,
  allowedKeys: string[],
): ProfileRecord[] {
  return collectSectionItems(profile, sectionKey)
    .filter(isVisibleCvItem)
    .map((item) => sanitizeCvItem(item, allowedKeys))
    .filter((item) => Object.keys(item).length > 0);
}

function collectSectionItems(profile: ProfileRecord, sectionKey: string): ProfileRecord[] {
  const sections = asRecord(profile.sections) ?? {};
  const section = asRecord(sections[sectionKey]);

  if (section) {
    if (!isVisibleCvItem(section)) return [];
    if (Array.isArray(section.items)) {
      return section.items.filter((item): item is ProfileRecord => asRecord(item) !== null);
    }
  }

  const topLevelSection = profile[sectionKey];
  if (Array.isArray(topLevelSection)) {
    return topLevelSection.filter((item): item is ProfileRecord => asRecord(item) !== null);
  }
  const topLevelRecord = asRecord(topLevelSection);
  if (topLevelRecord) {
    if (!isVisibleCvItem(topLevelRecord)) return [];
    if (Array.isArray(topLevelRecord.items)) {
      return topLevelRecord.items.filter((item): item is ProfileRecord => asRecord(item) !== null);
    }
  }

  return [];
}

function sanitizeCvItem(item: ProfileRecord, allowedKeys: string[]): ProfileRecord {
  const sanitized = pickDefined(item, allowedKeys);
  if (Array.isArray(item.roles)) {
    const roles = item.roles
      .filter((role): role is ProfileRecord => asRecord(role) !== null)
      .filter(isVisibleCvItem)
      .map((role) => pickDefined(role, ["position", "period", "summary", "description"]))
      .filter((role) => Object.keys(role).length > 0);
    if (roles.length > 0) sanitized.roles = roles;
  }
  return sanitized;
}

function pickDefined(source: ProfileRecord, keys: string[]): ProfileRecord {
  const result: ProfileRecord = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

function isVisibleCvItem(item: ProfileRecord): boolean {
  if (item.hidden === true) return false;
  if (item.visible === false) return false;
  return true;
}
