import type { JobListItem } from "@shared/types.js";

export const LEVELS_LOOKUP_START_EVENT = "JOBOPS_LEVELS_LOOKUP_START";
export const LEVELS_SALARY_RESULT_EVENT = "JOBOPS_LEVELS_SALARY_RESULT";

export type LevelsSalaryResult = {
  jobId: string;
  salary: string;
  salaryMinAmount?: number | null;
  salaryMaxAmount?: number | null;
  salaryCurrency?: string | null;
  salaryInterval?: string | null;
  salarySource?: string | null;
  level?: string | null;
};

const COMPANY_SUFFIX_RE =
  /\b(?:inc\.?|incorporated|ltd\.?|limited|llc|l\.l\.c\.?|corp\.?|corporation|plc|gmbh|co\.?|company|lp|llp)\b\.?/gi;

const ROLE_SLUG_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bengineering\s+manager\b|\bem\b/i, "software-engineering-manager"],
  [
    /\b(?:machine\s+learning|ml\s+engineer|ai\s+engineer|applied\s+scientist)\b/i,
    "machine-learning-engineer",
  ],
  [/\bdata\s+scientist\b/i, "data-scientist"],
  [/\bdata\s+engineer\b/i, "data-engineer"],
  [/\bdata\s+analyst\b/i, "data-analyst"],
  [/\bproduct\s+manager\b|\bpm\b/i, "product-manager"],
  [/\bproduct\s+designer\b|\bux\s+designer\b/i, "product-designer"],
  [/\b(?:devops|site\s+reliability|sre|platform\s+engineer)\b/i, "devops"],
  [/\bsecurity\s+engineer\b|\bappsec\b/i, "security-engineer"],
  [/\b(?:qa|quality\s+assurance|test\s+engineer|sdet)\b/i, "quality-assurance"],
  [
    /\b(?:software|frontend|front-end|backend|back-end|full[\s-]?stack|web|mobile|ios|android|cloud|systems?|developer|swe)\b/i,
    "software-engineer",
  ],
];

/** Convert an employer name into a Levels.fyi company slug. */
export function slugifyCompanyForLevels(employer: string): string {
  const withoutParens = employer.replace(/\([^)]*\)/g, " ");
  const withoutSuffixes = withoutParens.replace(COMPANY_SUFFIX_RE, " ");
  return withoutSuffixes
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Infer a Levels.fyi role slug from a job title when recognizable. */
export function inferLevelsRoleSlug(title: string): string | null {
  for (const [pattern, slug] of ROLE_SLUG_RULES) {
    if (pattern.test(title)) {
      return slug;
    }
  }
  return null;
}

/** Build the best matching Levels.fyi salaries URL for a job. */
export function buildLevelsFyiSalaryUrl(job: Pick<JobListItem, "employer" | "title">): string {
  const companySlug = slugifyCompanyForLevels(job.employer);
  const roleSlug = inferLevelsRoleSlug(job.title);

  if (companySlug && roleSlug) {
    return `https://www.levels.fyi/companies/${companySlug}/salaries/${roleSlug}`;
  }
  if (companySlug) {
    return `https://www.levels.fyi/companies/${companySlug}/salaries`;
  }
  if (roleSlug) {
    return `https://www.levels.fyi/t/${roleSlug}`;
  }
  return "https://www.levels.fyi/t/software-engineer";
}

/** Broadcast active job context to the Chrome extension bridge and open Levels.fyi in a popup window. */
export function openLevelsFyiLookup(
  job: Pick<JobListItem, "id" | "employer" | "title" | "location">,
): string {
  const url = buildLevelsFyiSalaryUrl(job);
  window.postMessage(
    {
      type: LEVELS_LOOKUP_START_EVENT,
      jobId: job.id,
      title: job.title,
      employer: job.employer,
      location: job.location ?? null,
      url,
    },
    window.location.origin,
  );
  window.open(url, "jobops-levels-fyi", "popup,width=1020,height=760");
  return url;
}

function asOptionalFiniteNonNegative(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return undefined;
}

function asOptionalTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined;
}

/** Validate and normalize a salary result message posted by the extension bridge. */
export function parseLevelsSalaryMessage(data: unknown): LevelsSalaryResult | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.type !== LEVELS_SALARY_RESULT_EVENT) return null;
  if (typeof record.jobId !== "string" || !record.jobId.trim()) return null;
  if (typeof record.salary !== "string" || !record.salary.trim()) return null;

  return {
    jobId: record.jobId.trim(),
    salary: record.salary.trim().slice(0, 200),
    salaryMinAmount: asOptionalFiniteNonNegative(record.salaryMinAmount),
    salaryMaxAmount: asOptionalFiniteNonNegative(record.salaryMaxAmount),
    salaryCurrency: asOptionalTrimmedString(record.salaryCurrency),
    salaryInterval: asOptionalTrimmedString(record.salaryInterval),
    salarySource: asOptionalTrimmedString(record.salarySource),
    level: asOptionalTrimmedString(record.level),
  };
}
