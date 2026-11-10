import {
  bulletsFromHtml,
  htmlToPlainText,
  joinDescription,
  splitDescription,
} from "@shared/resume-bullets";
import type {
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
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

/** Plain-string v5 fields replace_field may write; `description` holds HTML. */
const FIELD_NAMES: Record<string, string[]> = {
  experience: ["company", "position", "location", "period"],
  education: ["school", "degree", "area", "grade", "period"],
  awards: ["title", "awarder", "date", "description"],
  certifications: ["title", "issuer", "date", "description"],
  projects: ["name", "period", "description"],
  skills: ["name"],
};
function fieldItem(
  document: ReactiveResumeV5Document,
  field: ResumeSuggestion["field"],
): Record<string, unknown> | null {
  if (!field || !FIELD_NAMES[field.section]?.includes(field.name)) return null;
  const section = (
    document.sections as Record<
      string,
      { hidden?: boolean; items: { id: string; hidden?: boolean }[] }
    >
  )[field.section];
  const item = section?.items.find((i) => i.id === field.itemId);
  return section && !section.hidden && item && !item.hidden
    ? (item as Record<string, unknown>)
    : null;
}
/** True when a replace_field suggestion's item is rendered (visible) in the editor. */
export function fieldVisible(
  document: ReactiveResumeV5Document,
  suggestion: ResumeSuggestion,
) {
  return fieldItem(document, suggestion.field) !== null;
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );

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
  suggestion: ResumeSuggestion,
): { old: string; index?: number } | null {
  if (suggestion.op === "replace_headline")
    return sameText(suggestion.previousText, document.basics.headline)
      ? { old: document.basics.headline }
      : null;
  if (suggestion.op === "replace_summary") {
    return sameText(suggestion.previousText, document.summary.content)
      ? { old: bulletsFromHtml(document.summary.content).join("\n") }
      : null;
  }
  if (suggestion.op === "replace_field") {
    const item = fieldItem(document, suggestion.field);
    if (!item || !suggestion.field) return null;
    const current = String(item[suggestion.field.name] ?? "");
    // Lists stay with the bullet ops; the server drops these too.
    if (
      suggestion.field.name === "description" &&
      /<(ul|ol|li)\b/i.test(current)
    )
      return null;
    return sameText(suggestion.previousText, current)
      ? { old: htmlToPlainText(current) }
      : null;
  }
  if (suggestion.op === "set_skills")
    return {
      old: document.sections.skills.items
        .map((s) => [s.name, ...s.keywords].join(": "))
        .join("; "),
    };
  const experience = document.sections.experience.items.find(
    (e) => e.id === suggestion.experienceId && !e.hidden,
  );
  if (!experience) return null;
  const { bullets } = splitDescription(experience.description);
  if (suggestion.op === "insert_bullet") {
    const index = suggestion.bulletIndex ?? bullets.length;
    return Number.isInteger(index) && index >= 0 && index <= bullets.length
      ? { old: "", index }
      : null;
  }
  // An explicit previous text is a guard against applying an edit to changed content.
  const index =
    suggestion.previousText !== undefined
      ? bullets.indexOf(suggestion.previousText)
      : suggestion.bulletIndex;
  return index !== undefined && index >= 0 && index < bullets.length
    ? { old: bullets[index], index }
    : null;
}
export function applySuggestion(
  document: ReactiveResumeV5Document,
  suggestion: ResumeSuggestion,
): ReactiveResumeV5Document | null {
  const target = suggestionTarget(document, suggestion);
  if (!target) return null;
  return applyResolvedSuggestion(document, suggestion, target);
}

function applyResolvedSuggestion(
  document: ReactiveResumeV5Document,
  suggestion: ResumeSuggestion,
  target: { old: string; index?: number },
): ReactiveResumeV5Document | null {
  const next = structuredClone(document);
  if (suggestion.op === "replace_headline")
    next.basics.headline = suggestion.text ?? "";
  else if (suggestion.op === "replace_summary")
    next.summary.content = escapeHtml(suggestion.text ?? "");
  else if (suggestion.op === "replace_field") {
    const item = fieldItem(next, suggestion.field);
    if (!item || !suggestion.field) return null;
    const text = suggestion.text ?? "";
    item[suggestion.field.name] =
      suggestion.field.name === "description"
        ? `<p>${escapeHtml(text)}</p>`
        : text;
  } else if (suggestion.op === "set_skills")
    next.sections.skills.items = (suggestion.skills ?? []).map((s, index) => ({
      ...s,
      id: `cowork-skill-${suggestion.id}-${index}`,
      hidden: false,
      icon: "",
      proficiency: "",
      level: 0,
    }));
  else {
    const experience = next.sections.experience.items.find(
      (e) => e.id === suggestion.experienceId,
    );
    if (!experience || target.index === undefined) return null;
    const { introHtml, bullets } = splitDescription(experience.description);
    if (suggestion.op === "delete_bullet") bullets.splice(target.index, 1);
    else
      bullets.splice(
        target.index,
        suggestion.op === "replace_bullet" ? 1 : 0,
        suggestion.text ?? "",
      );
    experience.description = joinDescription(
      introHtml,
      bullets,
      experience.description,
    );
  }
  return next;
}

/** Resolve against one snapshot, then edit from the end so original indices hold. */
export function applySuggestions(
  document: ReactiveResumeV5Document,
  suggestions: ResumeSuggestion[],
): { document: ReactiveResumeV5Document; applied: string[] } {
  const resolved = suggestions.flatMap((suggestion, order) => {
    const target = suggestionTarget(document, suggestion);
    return target ? [{ suggestion, target, order }] : [];
  });
  resolved.sort((a, b) => {
    const group = (a.suggestion.experienceId ?? "").localeCompare(
      b.suggestion.experienceId ?? "",
    );
    if (group) return group;
    const index = (b.target.index ?? -1) - (a.target.index ?? -1);
    if (index) return index;
    // At one position replace/delete the original before inserting before it.
    const inserts =
      Number(a.suggestion.op === "insert_bullet") -
      Number(b.suggestion.op === "insert_bullet");
    if (inserts) return inserts;
    return a.suggestion.op === "insert_bullet"
      ? b.order - a.order
      : a.order - b.order;
  });
  let next = document;
  const applied: string[] = [];
  const edited = new Set<string>();
  for (const { suggestion, target } of resolved) {
    const key = `${suggestion.experienceId}:${target.index}`;
    const editsBullet =
      target.index !== undefined && suggestion.op !== "insert_bullet";
    if (editsBullet && edited.has(key)) continue;
    const result = applyResolvedSuggestion(next, suggestion, target);
    if (result) {
      next = result;
      applied.push(suggestion.id);
      if (editsBullet) edited.add(key);
    }
  }
  return { document: next, applied };
}
