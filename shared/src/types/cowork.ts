import type { ReactiveResumeV5Document } from "./design-resume";

export type ExperienceBulletSource = "resume" | "manual" | "ai_extract";
export interface ExperienceBullet {
  id: string;
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
