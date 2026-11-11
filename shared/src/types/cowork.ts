import type { ReactiveResumeV5Document } from "./design-resume";
import type { JobStatus } from "./jobs";

export type ExperienceBulletSource =
  | "resume"
  | "manual"
  | "ai_extract"
  | "job_resume";

/**
 * Candidate library item kinds (PRD docs/prd/resume-editor-candidate-library.md §6).
 * - contact:       data = { type, value, label?, network?, username?, url? }; parentId null
 * - role:          text = position; data = { company, location, website, period }
 * - bullet:        text = duty; parentId = role id
 * - project:       text = name; data = { period, website }
 * - project_point: text = point; parentId = project id
 * - skill:         text = label; data = { keywords: string[] }
 * - education:     text = degree (the one line); data = { school, location, period }
 * - award:         text = title (the one line); data = { date }
 * - certification: text = description (the one line); data = { issuer, website, date }
 * Website in role/project/certification data is the v5 { url, label } object;
 * readers also accept a plain URL string from legacy rows.
 */
export type CandidateItemKind =
  | "contact"
  | "role"
  | "bullet"
  | "project"
  | "project_point"
  | "skill"
  | "education"
  | "award"
  | "certification";

export const CANDIDATE_ITEM_KINDS: readonly CandidateItemKind[] = [
  "contact",
  "role",
  "bullet",
  "project",
  "project_point",
  "skill",
  "education",
  "award",
  "certification",
];

export interface ExperienceBullet {
  id: string;
  /** Defaults to "bullet" for rows created before the candidate library. */
  kind: CandidateItemKind;
  /** Kind-specific fields, see CandidateItemKind. null for bullet/project_point. */
  data: Record<string, unknown> | null;
  /** bullet → role id, project_point → project id; null otherwise. */
  parentId: string | null;
  /** Library order within its parent (or within its kind). */
  position: number;
  text: string; // plain text, one achievement/duty
  company: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null; // free text e.g. "2021-03", "Present"
  tags: string[]; // skills / tech / domain labels
  source: ExperienceBulletSource;
  sourceExperienceId: string | null; // v5 experience item id when imported
  createdAt: string;
  updatedAt: string;
}
export interface ExperienceBulletInput {
  text: string;
  company?: string | null;
  role?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[];
  source?: ExperienceBulletSource;
  sourceExperienceId?: string | null;
  kind?: CandidateItemKind;
  data?: Record<string, unknown> | null;
  parentId?: string | null;
  position?: number;
}

/** GET /cowork/library/:id/usage — which job resumes reference an item. */
export interface LibraryItemUsage {
  /** Unapplied jobs: library edits flow into their linked lines (R6). */
  jobIds: string[];
  /** Applied-or-later jobs: frozen, never changed by library edits. */
  frozenJobIds: string[];
}

/** POST /cowork/library/sync */
export interface LibrarySyncResult {
  created: number;
  skipped: number;
  /** Resume lines/items that got a library link stamped on them. */
  linked: number;
}
export interface RankedBullet {
  bulletId: string;
  score: number /*0-100*/;
  reason: string;
}
export interface JobResumeState {
  document: ReactiveResumeV5Document;
  revision: number;
  exists: boolean;
  updatedAt: string | null;
}
export interface ResumeListItem {
  jobId: string;
  title: string;
  employer: string;
  stage: string | null;
  updatedAt: string;
  hasPdf: boolean;
  status: JobStatus;
  readyAt: string | null;
}
export type ResumeSuggestionOp =
  | "replace_bullet"
  | "insert_bullet"
  | "delete_bullet"
  | "replace_summary"
  | "replace_headline"
  | "set_skills"
  | "replace_field";
export interface ResumeSuggestion {
  id: string;
  op: ResumeSuggestionOp;
  experienceId?: string; // v5 sections.experience item id (bullet ops)
  bulletIndex?: number; // replace/delete: target index; insert: position to insert at
  previousText?: string; // replace/delete: text the AI saw (client matches by text first, index second)
  text?: string; // new bullet / summary / headline (plain text)
  skills?: { name: string; keywords: string[] }[];
  sourceBulletIds?: string[]; // library bullets it drew on
  field?: { section: string; itemId: string; name: string }; // replace_field: name = a plain-string v5 field of that item
  reason: string;
}
export interface CoworkChatContext {
  document: ReactiveResumeV5Document;
  referencedBulletIds: string[];
  focus?: ResumeFocusRef[]; // max 20
}
export type ResumeFocusKind =
  | "section"
  | "item"
  | "bullet"
  | "skill"
  | "summary"
  | "headline";
export interface ResumeFocusRef {
  kind: ResumeFocusKind;
  section?: string; // v5 section key, e.g. "experience","education","awards","certifications","projects","skills"
  itemId?: string; // v5 item id (item/bullet/skill)
  bulletIndex?: number; // bullet: index in that item's <li> bullets (splitDescription semantics)
  label: string; // chip text, e.g. "Experience › Citi — Senior Programmer"
}
