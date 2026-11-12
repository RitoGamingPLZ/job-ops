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
  bulletsToHtml,
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
      : descriptionWithLines(original, current, lines),
    bulletRefs: refs,
  };
}

// Keep original markup for unchanged lines, including when lines move or a
// sibling is removed. Match refs as well as text so duplicate lines stay distinct.
function descriptionWithLines(
  original: string,
  current: ResumeLine[],
  lines: ResumeLine[],
): string {
  const markup = [...original.matchAll(/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)]
    .flatMap(([list]) => [...list.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)])
    .map(([html]) => html)
    .filter((html) => htmlToPlainText(html));
  const used = new Set<number>();
  const rendered = lines.map((line) => {
    const index = current.findIndex(
      (value, index) =>
        !used.has(index) && value.ref === line.ref && value.text === line.text,
    );
    if (index >= 0 && markup[index]) {
      used.add(index);
      return markup[index];
    }
    return bulletsToHtml([line.text]).slice(4, -5).replace(/\r?\n/g, "<br>");
  });
  let index = 0;
  return joinDescription(
    splitDescription(original).introHtml,
    lines.map((line) => line.text),
    original,
  ).replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, () => rendered[index++]);
}

function matchesContactProfile(
  profile: ResumeDoc["sections"]["profiles"]["items"][number],
  item: ExperienceBullet,
): boolean {
  return (
    profile.libraryId === item.id ||
    (profile.website.url || profile.username) === string(item.data?.value)
  );
}

/** Contact selection follows document values, including contacts without library links. */
export function isContactOnResume(
  doc: ResumeDoc,
  item: ExperienceBullet,
): boolean {
  const data = item.data ?? {};
  const value = string(data.value);
  if (!value) return false;
  switch (data.type) {
    case "email":
    case "phone":
    case "location":
      return doc.basics[data.type] === value;
    case "website":
      return doc.basics.website.url === value;
    case "profile":
      return doc.sections.profiles.items.some((profile) =>
        matchesContactProfile(profile, item),
      );
    default:
      return false;
  }
}

/** Set one basic contact (radio semantics) or add/remove one profile. Pure. */
export function setContactOnResume(
  doc: ResumeDoc,
  item: ExperienceBullet,
  checked: boolean,
): ResumeDoc {
  if (isContactOnResume(doc, item) === checked) return doc;
  const data = item.data ?? {};
  const value = string(data.value);
  switch (data.type) {
    case "email":
    case "phone":
    case "location":
      return {
        ...doc,
        basics: { ...doc.basics, [data.type]: checked ? value : "" },
      };
    case "website":
      return {
        ...doc,
        basics: {
          ...doc.basics,
          website: {
            ...doc.basics.website,
            url: checked ? value : "",
            label: checked ? string(data.label) : "",
          },
        },
      };
    case "profile": {
      const section = doc.sections.profiles;
      const items = checked
        ? [
            ...section.items,
            {
              id: globalThis.crypto.randomUUID(),
              hidden: false,
              icon: "",
              libraryId: item.id,
              network: string(data.network),
              username: string(data.username),
              website: {
                url: typeof data.url === "string" ? data.url : value,
                label: string(data.label),
              },
            },
          ]
        : section.items.filter(
            (profile) => !matchesContactProfile(profile, item),
          );
      return {
        ...doc,
        sections: { ...doc.sections, profiles: { ...section, items } },
      };
    }
    default:
      return doc;
  }
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
function websiteValue(value: unknown, existing?: unknown) {
  const fallback =
    existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {};
  const website =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : { url: value };
  return {
    url: typeof website.url === "string" ? website.url : string(fallback.url),
    label:
      typeof website.label === "string"
        ? website.label
        : string(fallback.label),
  };
}
/** Canonical display/identity text for structured library constituents. */
export function foldResumeParts(...parts: unknown[]): string {
  return parts
    .map((value) => htmlToPlainText(string(value)).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

const FOLDED_FIELDS: Partial<Record<CandidateItemKind, string[]>> = {
  education: ["degree", "area", "grade", "description"],
  award: ["title", "awarder", "description"],
  certification: ["title", "description"],
};

function fields(item: ExperienceBullet, existing: ResumeItem = {}): ResumeItem {
  const data = item.data ?? {};
  const website = websiteValue(data.website, existing.website);
  const structured = (key: string, fallback = "") =>
    typeof data[key] === "string"
      ? data[key]
      : typeof existing[key] === "string"
        ? existing[key]
        : fallback;
  const primary = (key: string) =>
    typeof data[key] === "string" &&
    item.text !==
      foldResumeParts(
        ...(FOLDED_FIELDS[item.kind] ?? []).map((key) => data[key]),
      )
      ? item.text
      : structured(key, item.text);
  switch (item.kind) {
    case "role":
      return {
        company: string(structured("company")).trim()
          ? structured("company")
          : "—",
        position: item.text,
        location: structured("location"),
        period: structured("period"),
        website,
      };
    case "project":
      return { name: item.text, period: structured("period"), website };
    case "skill":
      return { name: item.text };
    case "education":
      return {
        degree: primary("degree"),
        school: string(structured("school")).trim()
          ? structured("school")
          : "—",
        location: structured("location"),
        period: structured("period"),
        area: structured("area"),
        grade: structured("grade"),
        description: structured("description"),
      };
    case "award":
      return {
        title: primary("title"),
        date: structured("date"),
        awarder: structured("awarder"),
        description: structured("description"),
      };
    case "certification":
      return {
        title: primary("title"),
        issuer: structured("issuer"),
        date: structured("date"),
        website,
        description: structured("description"),
      };
    default:
      throw new Error("A library line requires its parent resume item");
  }
}

export type LibraryFieldPatch = {
  text?: string;
  data?: Record<string, unknown>;
};

/** Full library PATCH for a supported linked scalar field; prose stays local. */
export function linkedFieldPatch(
  item: ExperienceBullet,
  section: string,
  field: string,
  text: string,
): LibraryFieldPatch | null {
  if (KIND_SECTION[item.kind] !== section) return null;
  const textField = { role: "position", project: "name", skill: "name" }[
    item.kind as "role" | "project" | "skill"
  ];
  if (field === textField) return { text };
  const dataFields: Partial<Record<CandidateItemKind, string[]>> = {
    role: ["company", "location", "period"],
    project: ["period"],
    education: ["degree", "area", "grade", "school", "location", "period"],
    award: ["title", "awarder", "date"],
    certification: ["title", "issuer", "date"],
  };
  if (!dataFields[item.kind]?.includes(field)) return null;
  const data = { ...item.data, [field]: text };
  const foldedFields = FOLDED_FIELDS[item.kind];
  if (!foldedFields?.includes(field)) return { data };
  // Preserve the effective primary value when a library text edit superseded
  // its old constituents, or when this is a legacy row without constituents.
  const primary = foldedFields[0];
  if (field !== primary) data[primary] = fields(item)[primary];
  return {
    data,
    text: foldResumeParts(...foldedFields.map((key) => data[key])),
  };
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
  let insertionIndex = section.items.length;
  if (kind === "role") {
    section.items.forEach((entry, index) => {
      if (sameLineText(string(entry.company), string(item.company)))
        insertionIndex = index + 1;
    });
  }
  const items = [...section.items];
  items.splice(insertionIndex, 0, item);
  return {
    ...doc,
    sections: {
      ...doc.sections,
      [key]: { ...section, items },
    },
  };
}

/**
 * Ticks a library item on (PRD R2):
 * - top-level kind: append its resume item to the end of its section, except
 *   a role goes right after the last experience entry with the same company
 *   (end of its job) when there is one; for role/project also append ALL its
 *   library children as linked lines.
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
  if (item.kind === "contact") return setContactOnResume(doc, item, true);
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
 *   `after` for changed library fields, preserving unrelated resume values.
 *   Skills: the label follows the library; the resume keeps its own ticked
 *   keywords (keywords have no ids).
 * Returns the same object when nothing changed.
 */
export function applyLibraryUpdate(
  doc: ResumeDoc,
  before: ExperienceBullet,
  after: ExperienceBullet,
): ResumeDoc {
  if (before.kind === "contact") {
    if (equal(before.data, after.data) || !isContactOnResume(doc, before))
      return doc;
    if (before.data?.type === "profile" && after.data?.type === "profile") {
      const section = doc.sections.profiles;
      const data = after.data;
      return {
        ...doc,
        sections: {
          ...doc.sections,
          profiles: {
            ...section,
            items: section.items.map((profile) =>
              matchesContactProfile(profile, before)
                ? {
                    ...profile,
                    libraryId: after.id,
                    network: string(data.network),
                    username: string(data.username),
                    website: {
                      ...profile.website,
                      url:
                        typeof data.url === "string"
                          ? data.url
                          : string(data.value),
                      label: string(data.label),
                    },
                  }
                : profile,
            ),
          },
        },
      };
    }
    return setContactOnResume(
      setContactOnResume(doc, before, false),
      after,
      true,
    );
  }
  return mapItems(doc, (item) => {
    let next = item;
    if (item.libraryId === before.id) {
      // Legacy URL-only rows have no label; missing fields retain resume values.
      const previous = fields(before, item);
      const derived = Object.fromEntries(
        Object.entries(fields(after, item)).filter(
          ([key, value]) => !equal(previous[key], value),
        ),
      );
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
  switch (kind) {
    case "role":
      return string(item.position);
    case "project":
    case "skill":
      return string(item.name);
    case "education":
      return foldResumeParts(
        item.degree,
        item.area,
        item.grade,
        item.description,
      );
    case "award":
      return foldResumeParts(item.title, item.awarder, item.description);
    case "certification":
      return foldResumeParts(item.title, item.description);
    default:
      return "";
  }
}

/**
 * Migration / sync: for items and lines without links, find the library item
 * by kind + normalised text (lines: only children of the item's matched
 * parent; an item with no matched parent gets no line links) and stamp
 * libraryId / bulletRefs. Never changes any text. Refs to ids missing from
 * the library (deleted items on frozen resumes) count as unlinked
 * everywhere and are left as they are.
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
    if (
      (kind === "role" || kind === "project") &&
      library.some(
        (value) => value.id === next.libraryId && value.kind === kind,
      )
    ) {
      let changed = false;
      const lines = getItemLines(next).map((line) => {
        if (line.ref) return line;
        const match = library.find(
          (value) =>
            value.kind === (kind === "role" ? "bullet" : "project_point") &&
            value.parentId === next.libraryId &&
            sameLineText(value.text, line.text),
        );
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
