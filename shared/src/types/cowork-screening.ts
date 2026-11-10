import type { ResumeFocusRef } from "./cowork";
export type RequirementImportance = "must" | "nice";
export type RequirementCategory =
  | "skill"
  | "experience"
  | "education"
  | "certification"
  | "domain"
  | "other";
export type RequirementStatus = "met" | "partial" | "in_library" | "missing";
export interface ScreeningRequirement {
  id: string;
  text: string; // short requirement, e.g. "5+ years Java backend"
  importance: RequirementImportance;
  category: RequirementCategory;
  status: RequirementStatus;
  evidence: { text: string; focus: ResumeFocusRef | null }[]; // where the resume shows it (server-validated refs)
  libraryBulletIds: string[]; // duties from the user's library that would prove it (scoped, validated)
  tip: string; // one-line advice to close the gap ("" when met)
}
export interface ScreeningReport {
  requirements: ScreeningRequirement[]; // must-haves first
  score: number; // 0-100 estimated screening pass likelihood
  summary: string; // 1-2 sentences
  jobTitle: string;
  employer: string;
}
