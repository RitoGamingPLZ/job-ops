/**
 * Links between a job resume (RxResume v5 document) and the candidate library.
 *
 * Spec: docs/prd/resume-editor-candidate-library.md (§5, §6)
 * Plan: docs/prd/resume-editor-candidate-library.PLAN.md
 *
 * Storage, all inside the v5 document so it saves with the same revision:
 * - item.libraryId   on experience/projects/skills/education/awards/
 *                    certifications items = the library role/project/skill/
 *                    education/award/certification id.
 * - item.bulletRefs  on experience/projects items = one library id (or null)
 *                    per bullet line, same order as the bullets in
 *                    item.description (`splitDescription` in resume-bullets).
 *
 * "Reworded" is not stored: a linked line is reworded when its text differs
 * from its library item's text (compare with `sameLineText`).
 *
 * Every function is pure and never mutates its inputs.
 */

import type { CandidateItemKind, ExperienceBullet } from "./types/cowork";
import type { ReactiveResumeV5Document } from "./types/design-resume";

export type ResumeDoc = ReactiveResumeV5Document;
export type ResumeItem = Record<string, unknown>;

/** Resume section that holds each top-level library kind. */
export const KIND_SECTION: Partial<Record<CandidateItemKind, string>> = {
  role: "experience",
  project: "projects",
  skill: "skills",
  education: "education",
  award: "awards",
  certification: "certifications",
};

/** Library kinds that are lines inside a parent resume item. */
export const LINE_KINDS: readonly CandidateItemKind[] = [
  "bullet",
  "project_point",
];

export interface ResumeLine {
  text: string;
  ref: string | null;
}

const NOT_IMPLEMENTED = "resume-links: not implemented yet";

/** Normalised comparison (trim, collapse whitespace). */
export function sameLineText(_a: string, _b: string): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

/** Bullet lines of an experience/projects item with their refs. */
export function getItemLines(_item: ResumeItem): ResumeLine[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Writes lines back: description bullets (keeping intro prose, via
 * joinDescription) and bulletRefs in the same order.
 */
export function setItemLines(
  _item: ResumeItem,
  _lines: ResumeLine[],
): ResumeItem {
  throw new Error(NOT_IMPLEMENTED);
}

/** true when the library item (any kind) is on this resume. */
export function isOnResume(_doc: ResumeDoc, _libraryId: string): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Builds the v5 item for a top-level library item (role → experience entry
 * with position/period from the role and company/location/website from its
 * data; project; skill with ALL its keywords; education; award;
 * certification), with a fresh id, hidden: false, libraryId set, and — for
 * role/project — no bullet lines.
 */
export function libraryItemToResumeItem(_item: ExperienceBullet): ResumeItem {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Ticks a library item on (PRD R2):
 * - top-level kind: append its resume item to the end of its section; for
 *   role/project also append ALL its library children as linked lines.
 * - bullet/project_point: append as a linked line to its parent's resume
 *   item, adding the parent first (without other children) if missing.
 * No-op when already on the resume. `library` = all library items.
 */
export function addToResume(
  _doc: ResumeDoc,
  _libraryId: string,
  _library: ExperienceBullet[],
): ResumeDoc {
  throw new Error(NOT_IMPLEMENTED);
}

/** Ticks off: removes the item (and its lines) or the line. No-op if absent. */
export function removeFromResume(
  _doc: ResumeDoc,
  _libraryId: string,
): ResumeDoc {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Library item changed from `before` to `after` (R3, R9):
 * - lines with ref === id whose text still equals before.text → after.text
 *   (reworded lines are left alone);
 * - top-level items with libraryId === id get their fields re-derived from
 *   `after` (entry fields are always linked). Skills: the label follows the
 *   library; the resume keeps its own ticked keywords (keywords have no ids).
 * Returns the same object when nothing changed.
 */
export function applyLibraryUpdate(
  _doc: ResumeDoc,
  _before: ExperienceBullet,
  _after: ExperienceBullet,
): ResumeDoc {
  throw new Error(NOT_IMPLEMENTED);
}

/** "Reset to library text": sets the line text back to the library text. */
export function resetLine(
  _doc: ResumeDoc,
  _resumeItemId: string,
  _lineIndex: number,
  _library: ExperienceBullet[],
): ResumeDoc {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Migration / sync: for items and lines without links, find the library item
 * by kind + normalised text (lines: within the item's matched parent first)
 * and stamp libraryId / bulletRefs. Never changes any text.
 */
export function stampLibraryRefs(
  _doc: ResumeDoc,
  _library: ExperienceBullet[],
): { doc: ResumeDoc; linked: number } {
  throw new Error(NOT_IMPLEMENTED);
}
