import { getItemLines, setItemLines } from "@shared/resume-links";
import type { ReactiveResumeV5Document } from "@shared/types";

export const RESUME_BULLET_TRANSFER_TYPE = "application/x-jobops-resume-bullet";
export const EXPERIENCE_TRANSFER_TYPE = "application/x-jobops-resume-experience";
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
  const from = getItemLines(origin);
  const to = getItemLines(destination);
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
  const sourceItem = next.sections.experience.items.find((e) => e.id === source.experienceId);
  const targetItem = next.sections.experience.items.find((e) => e.id === destinationId);
  if (!sourceItem || !targetItem) return document;
  const items = next.sections.experience.items;
  const sourceIndex = items.indexOf(sourceItem);
  const targetIndex = items.indexOf(targetItem);
  if (origin.id === destination.id)
    items[sourceIndex] = setItemLines(
      sourceItem,
      moveItem(from, source.index, gap),
    ) as typeof sourceItem;
  else {
    const [bullet] = from.splice(source.index, 1);
    to.splice(gap, 0, bullet);
    items[sourceIndex] = setItemLines(sourceItem, from) as typeof sourceItem;
    items[targetIndex] = setItemLines(targetItem, to) as typeof targetItem;
  }
  return next;
}

export const SECTION_TRANSFER_TYPE = "application/x-jobops-resume-section";
export const DEFAULT_SECTION_ORDER = [
  "summary",
  "skills",
  "certifications",
  "experience",
  "projects",
  "education",
  "awards",
];

/**
 * One-column reading order: main then sidebar, then any unconfigured defaults.
 * Keeps configured keys the editor does not render (e.g. profiles).
 */
export function sectionOrder(
  layout: ReactiveResumeV5Document["metadata"]["layout"] | undefined,
): string[] {
  const pages = layout?.pages ?? [];
  const configured = [
    ...pages.flatMap((page) => page.main ?? []),
    ...pages.flatMap((page) => page.sidebar ?? []),
  ];
  return [
    ...new Set([
      ...(configured.includes("summary") ? [] : ["summary"]),
      ...configured,
      ...DEFAULT_SECTION_ORDER,
    ]),
  ];
}

/** Move a section before `before` (or to the end); writes the whole order to pages[0].main. */
export function moveSection(
  document: ReactiveResumeV5Document,
  key: string,
  before: string | null,
): ReactiveResumeV5Document {
  if (key === before) return document;
  const order = sectionOrder(document.metadata?.layout).filter((k) => k !== key);
  const at = before === null ? -1 : order.indexOf(before);
  order.splice(at < 0 ? order.length : at, 0, key);
  const next = structuredClone(document);
  next.metadata ??= {} as ReactiveResumeV5Document["metadata"];
  next.metadata.layout ??= { sidebarWidth: 30, pages: [] };
  const [first, ...rest] = next.metadata.layout.pages;
  const placed = new Set(order);
  next.metadata.layout.pages = [
    { ...(first ?? { fullWidth: false }), main: order, sidebar: [] },
    ...rest.map((page) => ({
      ...page,
      main: page.main.filter((k) => !placed.has(k)),
      sidebar: page.sidebar.filter((k) => !placed.has(k)),
    })),
  ];
  return next;
}
