import { getLatexResumeSectionTitles } from "./document";
import type {
  LatexResumeDocument,
  LatexResumeEntry,
  LatexResumeLanguageItem,
  LatexResumeOrderedSectionKey,
  LatexResumeSectionTitles,
} from "./types";

const DEFAULT_SECTION_ORDER: LatexResumeOrderedSectionKey[] = [
  "profiles",
  "experience",
  "education",
  "projects",
  "skills",
  "languages",
  "interests",
  "awards",
  "certifications",
  "publications",
  "volunteer",
  "references",
];

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
  return (document.sectionOrder ?? DEFAULT_SECTION_ORDER).map((key) =>
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

export function formatLanguageDetails(item: LatexResumeLanguageItem): string[] {
  return [item.fluency || "", item.level == null ? "" : `Level ${item.level}`].filter(Boolean);
}
