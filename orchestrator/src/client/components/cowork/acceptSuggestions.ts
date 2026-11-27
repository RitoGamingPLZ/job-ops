import { getItemLines } from "@shared/resume-links";
import type { ExperienceBullet, ResumeV5Document, ResumeSuggestionV2 } from "@shared/types";
import { applySuggestions } from "./editor";
function rejectionCode(
  document: ResumeV5Document,
  s: ResumeSuggestionV2,
): "STALE" | "INVALID_TARGET" {
  if (s.op === "replace_headline" || s.op === "replace_summary") return "STALE";
  if (s.op === "replace_field") {
    const item = document.sections[s.field.section].items.find(
      (item) => item.id === s.field.itemId && !item.hidden,
    );
    return item && typeof item[s.field.name] === "string" ? "STALE" : "INVALID_TARGET";
  }
  if (s.op === "set_skill_keywords")
    return document.sections.skills.items.some((item) => item.id === s.itemId)
      ? "STALE"
      : "INVALID_TARGET";
  if ("section" in s && "itemId" in s && "previousText" in s)
    return document.sections[s.section].items.some((item) => item.id === s.itemId && !item.hidden)
      ? "STALE"
      : "INVALID_TARGET";
  if (s.op === "reorder_bullets") {
    const item = document.sections[s.section].items.find(
      (item) => item.id === s.itemId && !item.hidden,
    );
    return item &&
      JSON.stringify(getItemLines(item).map((line) => line.text)) !==
        JSON.stringify(s.previousTexts)
      ? "STALE"
      : "INVALID_TARGET";
  }
  return "INVALID_TARGET";
}

export function applyResumeEdits(
  document: ResumeV5Document,
  suggestions: ResumeSuggestionV2[],
  library: ExperienceBullet[],
) {
  const result = applySuggestions(document, suggestions, library);
  const rejected = suggestions
    .filter((s) => !result.applied.includes(s.id))
    .map((s) => ({ id: s.id, code: rejectionCode(result.document, s) }));
  return { ...result, rejected };
}
