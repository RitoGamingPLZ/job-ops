import {
  htmlToPlainText,
  introTextToHtml,
  splitDescription,
} from "@shared/resume-bullets";
import {
  addToResume,
  getItemLines,
  isOnResume,
  removeFromResume,
  setItemLines,
} from "@shared/resume-links";
import type {
  ExperienceBullet,
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestionV2,
} from "@shared/types";
import { normalizeWhitespace } from "@shared/utils/string";

/** previousText arrives as decoded plain text; compare against the field's plain text. */
const sameText = (previousText: string | undefined, current: string) =>
  previousText === undefined ||
  normalizeWhitespace(previousText) === htmlToPlainText(current);

export const BULLET_TRANSFER_TYPE = "application/x-jobops-bullet";
export type BulletReference = { id: string; text: string };
export function readBulletTransfer(value: string): BulletReference | null {
  try {
    const data = JSON.parse(value);
    return typeof data.id === "string" && typeof data.text === "string"
      ? { id: data.id, text: data.text }
      : null;
  } catch {
    return null;
  }
}
export const FOCUS_TRANSFER_TYPE = "application/x-jobops-resume-focus";
export const MAX_FOCUS = 20;
export function readFocusTransfer(value: string): ResumeFocusRef | null {
  try {
    const data = JSON.parse(value);
    return data &&
      typeof data.kind === "string" &&
      typeof data.label === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}
export function focusKey(ref: ResumeFocusRef) {
  return [ref.kind, ref.section, ref.itemId, ref.bulletIndex].join(":");
}
/** Add a ref unless it is already there or the list is full. */
export function addFocus(list: ResumeFocusRef[], ref: ResumeFocusRef) {
  return list.length >= MAX_FOCUS ||
    list.some((item) => focusKey(item) === focusKey(ref))
    ? list
    : [...list, ref];
}

type Item = Record<string, unknown> & { id: string; hidden?: boolean };
const FIELD_NAMES: Record<string, string[]> = {
  experience: ["company", "position", "location", "period"],
  education: [
    "school",
    "degree",
    "area",
    "grade",
    "location",
    "period",
    "description",
  ],
  awards: ["title", "awarder", "date", "description"],
  certifications: ["title", "issuer", "date", "description"],
  projects: ["name", "period", "description"],
  skills: ["name"],
};
function sectionItems(document: ReactiveResumeV5Document, section: string) {
  return document.sections[section] as
    | { hidden?: boolean; items: Item[] }
    | undefined;
}
function fieldItem(
  document: ReactiveResumeV5Document,
  field: Extract<ResumeSuggestionV2, { op: "replace_field" }>["field"],
) {
  if (!FIELD_NAMES[field.section]?.includes(field.name)) return null;
  const section = sectionItems(document, field.section);
  return section?.hidden
    ? null
    : (section?.items.find((i) => i.id === field.itemId && !i.hidden) ?? null);
}
export function fieldVisible(
  document: ReactiveResumeV5Document,
  suggestion: ResumeSuggestionV2,
) {
  return (
    suggestion.op === "replace_field" &&
    fieldItem(document, suggestion.field) !== null
  );
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const permutation = <T>(order: T[], original: T[]) =>
  order.length === original.length &&
  new Set(order).size === original.length &&
  order.every((id) => original.includes(id));
export function dropBullet(
  bullets: string[],
  index: number,
  text: string,
  mode: "insert" | "replace",
): string[] {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > bullets.length ||
    (mode === "replace" && index === bullets.length)
  )
    return bullets;
  const next = [...bullets];
  next.splice(index, mode === "replace" ? 1 : 0, text);
  return next;
}

export function suggestionTarget(
  document: ReactiveResumeV5Document,
  s: ResumeSuggestionV2,
  library: ExperienceBullet[] = [],
): { old: string; index?: number } | null {
  switch (s.op) {
    case "create_library_item":
      return { old: "" };
    case "save_to_library":
      return { old: "Current resume fields" };
    case "include_library_item":
    case "exclude_library_item":
      return library.some(
        (row) =>
          row.id === s.libraryId &&
          (s.op === "exclude_library_item" ||
            (row.kind !== "bullet" && row.kind !== "project_point") ||
            library.some(
              (parent) =>
                parent.id === row.parentId &&
                parent.kind === (row.kind === "bullet" ? "role" : "project"),
            )),
      )
        ? { old: "" }
        : null;
    case "replace_headline":
      return sameText(s.previousText, document.basics.headline)
        ? { old: document.basics.headline }
        : null;
    case "replace_summary":
      return sameText(s.previousText, document.summary.content)
        ? { old: htmlToPlainText(document.summary.content) }
        : null;
    case "replace_field": {
      const item = fieldItem(document, s.field);
      const current = String(item?.[s.field.name] ?? "");
      return item &&
        !(s.field.name === "description" && /<(ul|ol|li)\b/i.test(current)) &&
        sameText(s.previousText, current)
        ? { old: htmlToPlainText(current) }
        : null;
    }
    case "set_skill_keywords": {
      const item = document.sections.skills.items.find(
        (i) => i.id === s.itemId,
      );
      return item && equal(item.keywords, s.previousKeywords)
        ? { old: item.keywords.join(", ") }
        : null;
    }
    case "add_entry": {
      const section = sectionItems(document, s.section);
      return section && s.index >= 0 && s.index <= section.items.length
        ? { old: "" }
        : null;
    }
    case "remove_entry":
      return sectionItems(document, s.section)?.items.some(
        (i) => i.id === s.itemId,
      )
        ? { old: s.section }
        : null;
    case "reorder_entries": {
      const section = sectionItems(document, s.section);
      return section &&
        permutation(
          s.itemIds,
          section.items.map((i) => i.id),
        )
        ? { old: s.section }
        : null;
    }
    default: {
      const section = sectionItems(document, s.section);
      const item = section?.items.find((i) => i.id === s.itemId && !i.hidden);
      if (!item || section?.hidden) return null;
      const lines = getItemLines(item);
      if (s.op === "replace_intro")
        return sameText(
          s.previousText,
          splitDescription(String(item.description ?? "")).introHtml,
        )
          ? { old: s.previousText }
          : null;
      if (s.op === "reorder_bullets")
        return equal(
          s.previousTexts,
          lines.map((l) => l.text),
        ) &&
          permutation(
            s.order,
            lines.map((_, i) => i),
          )
          ? { old: s.previousTexts.join("\n") }
          : null;
      if (s.op === "insert_bullet") {
        const ref =
          s.libraryId ??
          (s.sourceBulletIds?.length === 1 ? s.sourceBulletIds[0] : undefined);
        if (
          ref &&
          (!library.some(
            (row) =>
              row.id === ref &&
              row.kind ===
                (s.section === "experience" ? "bullet" : "project_point") &&
              row.parentId === item.libraryId,
          ) ||
            isOnResume(document, ref))
        )
          return null;
        return s.bulletIndex >= 0 && s.bulletIndex <= lines.length
          ? { old: "", index: s.bulletIndex }
          : null;
      }
      if (s.op === "replace_bullet" && !s.text.trim()) return null;
      // Retain the guarded text match when earlier edits moved this line.
      const index =
        lines[s.bulletIndex]?.text === s.previousText
          ? s.bulletIndex
          : lines.findIndex((l) => l.text === s.previousText);
      return index >= 0 ? { old: lines[index].text, index } : null;
    }
  }
}

function newEntry(
  s: Extract<ResumeSuggestionV2, { op: "add_entry" }>,
): Item | null {
  const fields: Record<string, unknown> = Object.fromEntries(
    FIELD_NAMES[s.section].map((name) => [name, ""]),
  );
  Object.assign(fields, {
    description: "",
    website: { url: "", label: "" },
    hidden: false,
  });
  if (s.section === "experience") fields.roles = [];
  if (s.section === "skills")
    Object.assign(fields, {
      icon: "",
      proficiency: "",
      level: 0,
      keywords: [],
    });
  const item = { ...fields, ...s.item, id: `cowork-entry-${s.id}` } as Item;
  for (const [key, fallback] of Object.entries(fields)) {
    const value = item[key];
    if (Array.isArray(fallback)) {
      if (
        !Array.isArray(value) ||
        (key === "keywords" && value.some((v) => typeof v !== "string"))
      )
        return null;
    } else if (key === "website") {
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as Record<string, unknown>).url !== "string" ||
        typeof (value as Record<string, unknown>).label !== "string"
      )
        return null;
    } else if (typeof value !== typeof fallback) return null;
  }
  return item;
}
function applyResolvedSuggestion(
  document: ReactiveResumeV5Document,
  s: ResumeSuggestionV2,
  target: { old: string; index?: number },
  library: ExperienceBullet[],
): ReactiveResumeV5Document | null {
  if (s.op === "create_library_item" || s.op === "save_to_library") return null;
  if (s.op === "exclude_library_item")
    return removeFromResume(document, s.libraryId);
  if (s.op === "include_library_item") {
    const linked = library.find((row) => row.id === s.libraryId);
    const next = structuredClone(addToResume(document, s.libraryId, library));
    for (const section of Object.values(next.sections)) {
      if (
        !section ||
        typeof section !== "object" ||
        !("items" in section) ||
        !Array.isArray(section.items)
      )
        continue;
      for (const item of section.items as Item[])
        if (
          item.libraryId === s.libraryId ||
          (linked?.parentId && item.libraryId === linked.parentId)
        ) {
          item.hidden = false;
          (section as { hidden?: boolean }).hidden = false;
        }
    }
    return next;
  }
  const next = structuredClone(document);
  if (s.op === "replace_headline") next.basics.headline = s.text;
  else if (s.op === "replace_summary")
    next.summary.content = escapeHtml(s.text);
  else if (s.op === "replace_field") {
    const item = fieldItem(next, s.field);
    if (!item) return null;
    item[s.field.name] =
      s.field.name === "description" ? introTextToHtml(s.text) : s.text;
  } else if (s.op === "set_skill_keywords") {
    const item = next.sections.skills.items.find((i) => i.id === s.itemId);
    if (!item) return null;
    item.keywords = [...s.keywords];
  } else if (
    s.op === "add_entry" ||
    s.op === "remove_entry" ||
    s.op === "reorder_entries"
  ) {
    const section = sectionItems(next, s.section);
    if (!section) return null;
    if (s.op === "add_entry") {
      const item = newEntry(s);
      if (!item || section.items.some((i) => i.id === item.id)) return null;
      section.items.splice(s.index, 0, item);
    } else if (s.op === "remove_entry")
      section.items = section.items.filter((i) => i.id !== s.itemId);
    else {
      if (
        !permutation(
          s.itemIds,
          section.items.map((i) => i.id),
        )
      )
        return null;
      section.items = s.itemIds.map(
        (id) => section.items.find((i) => i.id === id) as Item,
      );
    }
  } else if ("section" in s && "itemId" in s) {
    const section = sectionItems(next, s.section);
    const item = section?.items.find((i) => i.id === s.itemId);
    if (!item || !section) return null;
    if (s.op === "replace_intro") {
      item.description =
        (s.text ? introTextToHtml(s.text) : "") +
        (
          String(item.description).match(
            /<(ul|ol)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
          ) ?? []
        ).join("");
    } else {
      let lines = getItemLines(item);
      if (s.op === "reorder_bullets") {
        if (
          !permutation(
            s.order,
            lines.map((_, i) => i),
          ) ||
          !equal(
            s.previousTexts,
            lines.map((l) => l.text),
          )
        )
          return null;
        lines = s.order.map((i) => lines[i]);
      } else {
        const currentTarget = suggestionTarget(next, s, library);
        const index =
          s.op === "insert_bullet" ? target.index : currentTarget?.index;
        if (!currentTarget || index === undefined || index > lines.length)
          return null;
        if (s.op === "delete_bullet") lines.splice(index, 1);
        else
          lines.splice(index, s.op === "replace_bullet" ? 1 : 0, {
            text: s.text,
            ref:
              s.op === "replace_bullet"
                ? (lines[index]?.ref ?? null)
                : (s.libraryId ??
                  (s.sourceBulletIds?.length === 1
                    ? s.sourceBulletIds[0]
                    : null)),
          });
      }
      section.items[section.items.indexOf(item)] = setItemLines(
        item,
        lines,
      ) as Item;
    }
  }
  return next;
}
export function applySuggestion(
  document: ReactiveResumeV5Document,
  suggestion: ResumeSuggestionV2,
  library: ExperienceBullet[] = [],
) {
  const target = suggestionTarget(document, suggestion, library);
  return target
    ? applyResolvedSuggestion(document, suggestion, target, library)
    : null;
}
/** Resolve indices against one snapshot; edit from the end to retain their meaning. */
export function applySuggestions(
  document: ReactiveResumeV5Document,
  suggestions: ResumeSuggestionV2[],
  library: ExperienceBullet[] = [],
): { document: ReactiveResumeV5Document; applied: string[] } {
  const resolved = suggestions.flatMap((suggestion, order) => {
    const target = suggestionTarget(document, suggestion, library);
    return target ? [{ suggestion, target, order }] : [];
  });
  const group = (s: ResumeSuggestionV2) =>
    "itemId" in s ? `${"section" in s ? s.section : "skills"}:${s.itemId}` : "";
  resolved.sort(
    (a, b) =>
      group(a.suggestion).localeCompare(group(b.suggestion)) ||
      (b.target.index ?? -1) - (a.target.index ?? -1) ||
      Number(a.suggestion.op === "insert_bullet") -
        Number(b.suggestion.op === "insert_bullet") ||
      (a.suggestion.op === "insert_bullet"
        ? b.order - a.order
        : a.order - b.order),
  );
  let next = document;
  const applied: string[] = [];
  const edited = new Set<string>();
  for (const { suggestion: s, target } of resolved) {
    const key = `${group(s)}:${target.index}`;
    if (
      target.index !== undefined &&
      s.op !== "insert_bullet" &&
      edited.has(key)
    )
      continue;
    // Validate links and structural targets again against preceding operations.
    if (target.index === undefined && !suggestionTarget(next, s, library))
      continue;
    if (
      s.op === "insert_bullet" &&
      (s.libraryId || s.sourceBulletIds?.length === 1) &&
      !suggestionTarget(next, s, library)
    )
      continue;
    const result = applyResolvedSuggestion(next, s, target, library);
    if (result) {
      next = result;
      applied.push(s.id);
      if (target.index !== undefined && s.op !== "insert_bullet")
        edited.add(key);
    }
  }
  return { document: next, applied };
}
