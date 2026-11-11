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

import {
  htmlToPlainText,
  joinDescription,
  splitDescription,
} from "./resume-bullets";
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

/** Normalised comparison (trim, collapse whitespace). */
export function sameLineText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
}

/** Bullet lines of an experience/projects item with their refs. */
export function getItemLines(item: ResumeItem): ResumeLine[] {
  const refs = Array.isArray(item.bulletRefs) ? item.bulletRefs : [];
  return splitDescription(string(item.description)).bullets.map(
    (text, index) => ({
      text,
      ref: typeof refs[index] === "string" ? refs[index] : null,
    }),
  );
}

/**
 * Writes lines back: description bullets (keeping intro prose, via
 * joinDescription) and bulletRefs in the same order.
 */
export function setItemLines(
  item: ResumeItem,
  lines: ResumeLine[],
): ResumeItem {
  const current = getItemLines(item);
  const refs = lines.map((line) => line.ref);
  if (
    equal(current, lines) &&
    (item.bulletRefs === undefined || equal(item.bulletRefs, refs))
  )
    return item;
  const original = string(item.description);
  return {
    ...item,
    description: equal(
      current.map((line) => line.text),
      lines.map((line) => line.text),
    )
      ? original
      : joinDescription(
          splitDescription(original).introHtml,
          lines.map((line) => line.text),
          original,
        ),
    bulletRefs: refs,
  };
}

/** true when the library item (any kind) is on this resume. */
export function isOnResume(doc: ResumeDoc, libraryId: string): boolean {
  let found = false;
  mapItems(doc, (item) => {
    if (
      item.libraryId === libraryId ||
      getItemLines(item).some((line) => line.ref === libraryId)
    )
      found = true;
    return item;
  });
  return found;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function fields(item: ExperienceBullet): ResumeItem {
  const data = item.data ?? {};
  const website = { url: string(data.website), label: "" };
  switch (item.kind) {
    case "role":
      return {
        company: string(data.company),
        position: item.text,
        location: string(data.location),
        period: string(data.period),
        website,
      };
    case "project":
      return { name: item.text, period: string(data.period), website };
    case "skill":
      return { name: item.text };
    case "education":
      return {
        degree: item.text,
        school: string(data.school),
        location: string(data.location),
        period: string(data.period),
        area: "",
        grade: "",
        description: "",
      };
    case "award":
      return {
        title: item.text,
        date: string(data.date),
        awarder: "",
        description: "",
      };
    case "certification":
      return {
        title: item.text,
        issuer: string(data.issuer),
        date: string(data.date),
        website,
        description: "",
      };
    default:
      throw new Error("A library line requires its parent resume item");
  }
}

/**
 * Builds the v5 item for a top-level library item (role → experience entry
 * with position/period from the role and company/location/website from its
 * data; project; skill with ALL its keywords; education; award;
 * certification), with a fresh id, hidden: false, libraryId set, and — for
 * role/project — no bullet lines.
 */
export function libraryItemToResumeItem(item: ExperienceBullet): ResumeItem {
  const base = {
    id: globalThis.crypto.randomUUID(),
    hidden: false,
    libraryId: item.id,
  };
  const derived = fields(item);
  switch (item.kind) {
    case "role":
      return {
        ...base,
        ...derived,
        description: "",
        bulletRefs: [],
        roles: [],
      };
    case "project":
      return { ...base, ...derived, description: "", bulletRefs: [] };
    case "skill":
      return {
        ...base,
        ...derived,
        icon: "",
        proficiency: "",
        level: 0,
        keywords: Array.isArray(item.data?.keywords)
          ? item.data.keywords.filter(
              (word): word is string => typeof word === "string",
            )
          : [],
      };
    case "education":
    case "award":
      return { ...base, website: { url: "", label: "" }, ...derived };
    default:
      return { ...base, ...derived };
  }
}

// Copy only changed paths; this also visits linked items in custom sections.
function mapItems(
  doc: ResumeDoc,
  update: (item: ResumeItem) => ResumeItem | null,
): ResumeDoc {
  const section = <T extends { items: ResumeItem[] }>(value: T): T => {
    const items = value.items
      .map(update)
      .filter((item): item is ResumeItem => item !== null);
    return items.length === value.items.length &&
      items.every((item, index) => item === value.items[index])
      ? value
      : { ...value, items };
  };
  const sections = Object.fromEntries(
    Object.entries(doc.sections).map(([key, value]) => [
      key,
      value &&
      typeof value === "object" &&
      "items" in value &&
      Array.isArray(value.items)
        ? section(value as { items: ResumeItem[] })
        : value,
    ]),
  );
  const customSections = doc.customSections.map(section);
  if (
    Object.keys(sections).every((key) => sections[key] === doc.sections[key]) &&
    customSections.every((value, index) => value === doc.customSections[index])
  )
    return doc;
  return {
    ...doc,
    sections: sections as ResumeDoc["sections"],
    customSections,
  };
}

function appendItem(
  doc: ResumeDoc,
  kind: CandidateItemKind,
  item: ResumeItem,
): ResumeDoc {
  const key = KIND_SECTION[kind];
  if (!key) return doc;
  const section = doc.sections[key] as { items: ResumeItem[] };
  return {
    ...doc,
    sections: {
      ...doc.sections,
      [key]: { ...section, items: [...section.items, item] },
    },
  };
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
  doc: ResumeDoc,
  libraryId: string,
  library: ExperienceBullet[],
): ResumeDoc {
  if (isOnResume(doc, libraryId)) return doc;
  const item = library.find((value) => value.id === libraryId);
  if (!item) return doc;
  if (LINE_KINDS.includes(item.kind)) {
    const parent = library.find(
      (value) =>
        value.id === item.parentId &&
        value.kind === (item.kind === "bullet" ? "role" : "project"),
    );
    if (!parent) return doc;
    const next = isOnResume(doc, parent.id)
      ? doc
      : appendItem(doc, parent.kind, libraryItemToResumeItem(parent));
    return mapItems(next, (entry) =>
      entry.libraryId === parent.id
        ? setItemLines(entry, [
            ...getItemLines(entry),
            { text: item.text, ref: item.id },
          ])
        : entry,
    );
  }
  let entry = libraryItemToResumeItem(item);
  if (item.kind === "role" || item.kind === "project") {
    entry = setItemLines(
      entry,
      library
        .filter(
          (child) =>
            child.parentId === item.id &&
            child.kind === (item.kind === "role" ? "bullet" : "project_point"),
        )
        .sort((a, b) => a.position - b.position)
        .map((child) => ({ text: child.text, ref: child.id })),
    );
  }
  return appendItem(doc, item.kind, entry);
}

/** Ticks off: removes the item (and its lines) or the line. No-op if absent. */
export function removeFromResume(doc: ResumeDoc, libraryId: string): ResumeDoc {
  return mapItems(doc, (item) => {
    if (item.libraryId === libraryId) return null;
    const lines = getItemLines(item);
    return lines.some((line) => line.ref === libraryId)
      ? setItemLines(
          item,
          lines.filter((line) => line.ref !== libraryId),
        )
      : item;
  });
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
  doc: ResumeDoc,
  before: ExperienceBullet,
  after: ExperienceBullet,
): ResumeDoc {
  return mapItems(doc, (item) => {
    let next = item;
    if (item.libraryId === before.id) {
      const derived = fields(after);
      if (
        Object.entries(derived).some(([key, value]) => !equal(item[key], value))
      )
        next = { ...item, ...derived };
    }
    const lines = getItemLines(next);
    if (
      lines.some(
        (line) =>
          line.ref === before.id &&
          sameLineText(line.text, before.text) &&
          line.text !== after.text,
      )
    ) {
      next = setItemLines(
        next,
        lines.map((line) =>
          line.ref === before.id && sameLineText(line.text, before.text)
            ? { ...line, text: after.text }
            : line,
        ),
      );
    }
    return next;
  });
}

/** "Reset to library text": sets the line text back to the library text. */
export function resetLine(
  doc: ResumeDoc,
  resumeItemId: string,
  lineIndex: number,
  library: ExperienceBullet[],
): ResumeDoc {
  return mapItems(doc, (item) => {
    if (item.id !== resumeItemId) return item;
    const lines = getItemLines(item);
    const line = lines[lineIndex];
    const original = line?.ref
      ? library.find((value) => value.id === line.ref)
      : undefined;
    if (!line || !original || line.text === original.text) return item;
    return setItemLines(
      item,
      lines.map((value, index) =>
        index === lineIndex ? { ...value, text: original.text } : value,
      ),
    );
  });
}

function entryText(item: ResumeItem, kind: CandidateItemKind): string {
  const fold = (...values: unknown[]) =>
    values
      .map((value) => htmlToPlainText(string(value)))
      .filter(Boolean)
      .join(" · ");
  switch (kind) {
    case "role":
      return string(item.position);
    case "project":
    case "skill":
      return string(item.name);
    case "education":
      return fold(item.degree, item.area, item.grade, item.description);
    case "award":
      return fold(item.title, item.awarder, item.description);
    case "certification":
      return fold(item.title, item.description);
    default:
      return "";
  }
}

/**
 * Migration / sync: for items and lines without links, find the library item
 * by kind + normalised text (lines: within the item's matched parent first)
 * and stamp libraryId / bulletRefs. Never changes any text.
 */
export function stampLibraryRefs(
  doc: ResumeDoc,
  library: ExperienceBullet[],
): { doc: ResumeDoc; linked: number } {
  let linked = 0;
  const stamp = (item: ResumeItem, kind: CandidateItemKind): ResumeItem => {
    let next = item;
    if (!item.libraryId) {
      const matches = library.filter(
        (value) =>
          value.kind === kind &&
          sameLineText(value.text, entryText(item, kind)),
      );
      const match =
        matches.find((value) =>
          kind === "role"
            ? sameLineText(string(value.data?.company), string(item.company)) &&
              sameLineText(string(value.data?.period), string(item.period))
            : kind === "education"
              ? sameLineText(string(value.data?.school), string(item.school))
              : kind === "project"
                ? sameLineText(string(value.data?.period), string(item.period))
                : true,
        ) ?? (matches.length === 1 ? matches[0] : undefined);
      if (match) {
        next = { ...next, libraryId: match.id };
        linked++;
      }
    }
    if (kind === "role" || kind === "project") {
      let changed = false;
      const lines = getItemLines(next).map((line) => {
        if (line.ref) return line;
        const matches = library.filter(
          (value) =>
            value.kind === (kind === "role" ? "bullet" : "project_point") &&
            sameLineText(value.text, line.text),
        );
        const match =
          matches.find((value) => value.parentId === next.libraryId) ??
          matches[0];
        if (!match) return line;
        changed = true;
        linked++;
        return { ...line, ref: match.id };
      });
      if (changed)
        next = { ...next, bulletRefs: lines.map((line) => line.ref) };
    }
    return next;
  };
  let next = doc;
  for (const [kind, key] of Object.entries(KIND_SECTION)) {
    const section = next.sections[key] as { items: ResumeItem[] };
    const items = section.items.map((item) =>
      stamp(item, kind as CandidateItemKind),
    );
    if (items.some((item, index) => item !== section.items[index]))
      next = {
        ...next,
        sections: { ...next.sections, [key]: { ...section, items } },
      };
  }
  const customSections = next.customSections.map((section) => {
    const kind = Object.entries(KIND_SECTION).find(
      ([, key]) => key === section.type,
    )?.[0] as CandidateItemKind | undefined;
    if (!kind) return section;
    const items = section.items.map((item) => stamp(item, kind));
    return items.some((item, index) => item !== section.items[index])
      ? { ...section, items }
      : section;
  });
  if (
    customSections.some(
      (section, index) => section !== next.customSections[index],
    )
  )
    next = {
      ...next,
      customSections: customSections as ResumeDoc["customSections"],
    };
  return { doc: next, linked };
}
