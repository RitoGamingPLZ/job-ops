import { getLatexResumeSectionTitles, ORDERABLE_SECTION_KEYS } from "./document";
import type {
  LatexResumeCustomFieldItem,
  LatexResumeDocument,
  LatexResumeEntry,
  LatexResumeInterestItem,
  LatexResumeLanguageItem,
  LatexResumeOrderedSectionKey,
  LatexResumeSectionTitles,
} from "./types";

const ENTRY_SECTION_KINDS = {
  experience: "subheading",
  education: "subheading",
  projects: "project",
  awards: "subheading",
  certifications: "subheading",
  publications: "subheading",
  volunteer: "subheading",
  references: "subheading",
} as const;

type EntrySectionKey = keyof typeof ENTRY_SECTION_KINDS;
type SpecialSectionKey = Exclude<LatexResumeOrderedSectionKey, EntrySectionKey>;

/** Renders sections in the document's order (default order when unset), calling only the builders it needs. */
export function renderOrderedSections(
  document: LatexResumeDocument,
  titles: LatexResumeSectionTitles,
  renderers: Record<SpecialSectionKey, () => string> & {
    entry: (args: {
      title: string;
      entries: LatexResumeEntry[];
      kind: "subheading" | "project";
    }) => string;
  },
): string[] {
  return (document.sectionOrder ?? ORDERABLE_SECTION_KEYS).map((key) =>
    key in ENTRY_SECTION_KINDS
      ? renderers.entry({
          title: titles[key as EntrySectionKey],
          entries: document[key as EntrySectionKey],
          kind: ENTRY_SECTION_KINDS[key as EntrySectionKey],
        })
      : renderers[key as SpecialSectionKey](),
  );
}

function normalizeText(value: string): string {
  return value
    .replace(/‐|‑|‒|–|—/g, "-")
    .replace(/•/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Converts strong/b/em/i tags to renderer markup and escapes the rest; unclosed tags are closed at the end. */
export function renderInlineHtml(
  value: string,
  format: { escape: (value: string) => string; bold: string; italic: string; close: string },
): string {
  const parts = normalizeText(value).split(/(<\/?(?:strong|b|em|i)\b[^>]*>)/gi);
  const result: string[] = [];
  let open = 0;

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith("<") && part.endsWith(">")) {
      const lower = part.toLowerCase();
      if (lower.startsWith("<strong") || lower.startsWith("<b")) {
        result.push(format.bold);
        open++;
      } else if (lower.startsWith("</strong") || lower.startsWith("</b>")) {
        result.push(format.close);
        open = Math.max(0, open - 1);
      } else if (lower.startsWith("<em") || lower.startsWith("<i")) {
        result.push(format.italic);
        open++;
      } else if (lower.startsWith("</em") || lower.startsWith("</i>")) {
        result.push(format.close);
        open = Math.max(0, open - 1);
      }
    } else {
      result.push(format.escape(part));
    }
  }

  return result.join("") + format.close.repeat(open);
}

export function resolveSectionTitles(document: LatexResumeDocument): LatexResumeSectionTitles {
  return document.sectionTitles ?? getLatexResumeSectionTitles();
}

function formatLanguageDetails(item: LatexResumeLanguageItem): string[] {
  return [item.fluency || "", item.level == null ? "" : `Level ${item.level}`].filter(Boolean);
}

export type LineSectionFormat = {
  escape: (value: string) => string;
  bold: (label: string) => string;
  boldPair: (label: string, value: string) => string;
  link: (label: string, url?: string | null) => string;
};

export function formatCustomFieldLines(
  items: LatexResumeCustomFieldItem[],
  format: LineSectionFormat,
): string[] {
  return items.map((item) => {
    const value = item.url ? format.link(item.text, item.url) : format.escape(item.text);
    if (!item.title) return value;
    if (item.title === item.text) return format.bold(item.title);
    return format.boldPair(item.title, value);
  });
}

export function formatLanguageLines(
  items: LatexResumeLanguageItem[],
  format: LineSectionFormat,
): string[] {
  return items.map((item) => {
    const detail = formatLanguageDetails(item).map(format.escape).join(" | ");
    return detail ? format.boldPair(item.language, detail) : format.bold(item.language);
  });
}

export function formatInterestLines(
  items: LatexResumeInterestItem[],
  format: LineSectionFormat,
): string[] {
  return items.map((item) => {
    const keywords = item.keywords.map(format.escape);
    return keywords.length > 0
      ? format.boldPair(item.name, keywords.join(", "))
      : format.bold(item.name);
  });
}
