import { bulletsFromHtml, bulletsToHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";

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
  if (suggestion.op === "replace_summary")
    return suggestion.previousText !== undefined &&
      suggestion.previousText !== document.summary.content
      ? null
      : { old: document.summary.content };
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
  const bullets = bulletsFromHtml(experience.description);
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
    const bullets = bulletsFromHtml(experience.description);
    if (suggestion.op === "delete_bullet") bullets.splice(target.index, 1);
    else
      bullets.splice(
        target.index,
        suggestion.op === "replace_bullet" ? 1 : 0,
        suggestion.text ?? "",
      );
    experience.description = bulletsToHtml(bullets);
  }
  return next;
}
