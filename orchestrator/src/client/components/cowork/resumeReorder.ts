import { bulletsFromHtml, bulletsToHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document } from "@shared/types";

export const RESUME_BULLET_TRANSFER_TYPE = "application/x-jobops-resume-bullet";
export const EXPERIENCE_TRANSFER_TYPE =
  "application/x-jobops-resume-experience";
export const SKILL_TRANSFER_TYPE = "application/x-jobops-resume-skill";

/** Destination is a gap in the original list, before removing the source. */
export function moveItem<T>(items: T[], from: number, gap: number): T[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(gap) ||
    from < 0 ||
    from >= items.length ||
    gap < 0 ||
    gap > items.length
  )
    return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(gap > from ? gap - 1 : gap, 0, item);
  return next;
}

export function moveResumeBullet(
  document: ReactiveResumeV5Document,
  source: { experienceId: string; index: number },
  destinationId: string,
  gap: number,
): ReactiveResumeV5Document {
  const origin = document.sections.experience.items.find(
    (e) => e.id === source.experienceId && !e.hidden,
  );
  const destination = document.sections.experience.items.find(
    (e) => e.id === destinationId && !e.hidden,
  );
  if (!origin || !destination) return document;
  const from = bulletsFromHtml(origin.description);
  const to = bulletsFromHtml(destination.description);
  if (
    !Number.isInteger(source.index) ||
    source.index < 0 ||
    source.index >= from.length ||
    !Number.isInteger(gap) ||
    gap < 0 ||
    gap > to.length
  )
    return document;
  const next = structuredClone(document);
  const sourceItem = next.sections.experience.items.find(
    (e) => e.id === source.experienceId,
  );
  const targetItem = next.sections.experience.items.find(
    (e) => e.id === destinationId,
  );
  if (!sourceItem || !targetItem) return document;
  if (origin.id === destination.id)
    sourceItem.description = bulletsToHtml(moveItem(from, source.index, gap));
  else {
    const [bullet] = from.splice(source.index, 1);
    to.splice(gap, 0, bullet);
    sourceItem.description = bulletsToHtml(from);
    targetItem.description = bulletsToHtml(to);
  }
  return next;
}
