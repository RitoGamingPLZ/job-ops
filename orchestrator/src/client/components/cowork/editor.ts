import {
  bulletsFromHtml,
  joinDescription,
  splitDescription,
} from "@shared/resume-bullets";
import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import { normalizeWhitespace } from "@shared/utils/string";

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
    return suggestion.previousText !== undefined &&
      suggestion.previousText !== document.basics.headline
      ? null
      : { old: document.basics.headline };
  if (suggestion.op === "replace_summary") {
    const plainText = bulletsFromHtml(document.summary.content).join("\n");
    return suggestion.previousText !== undefined &&
      normalizeWhitespace(suggestion.previousText) !==
        normalizeWhitespace(plainText)
      ? null
      : { old: plainText };
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
    next.summary.content = (suggestion.text ?? "").replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
    );
  else if (suggestion.op === "set_skills")
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
