import {
  bulletsFromHtml,
  htmlToPlainText,
  introTextToHtml,
  joinDescription,
  splitDescription,
} from "@shared/resume-bullets";
import {
  changedLibraryFields,
  getItemLines,
  type ResumeLine,
  removeFromResume,
  resetEntryFields,
  resetLine,
  sameLineText,
  setItemLines,
} from "@shared/resume-links";
import { NAVY_SERIF_CSS_VARS, NAVY_SERIF_STYLE } from "@shared/resume-style/navy-serif";
import type {
  EntrySection,
  ExperienceBullet,
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestionV2,
} from "@shared/types";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { librarySaveInput } from "./acceptSuggestions";
import { REWORDED_TINT_CLASS } from "./rewordTint";
import "./ResumeEditor.css";
import { RichTextEditor } from "@/client/components/design-resume/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BulletText, fitTextarea } from "./BulletText";
import { CommaListInput } from "./CommaListInput";
import { FOCUS_TRANSFER_TYPE, fieldVisible, suggestionTarget } from "./editor";
import {
  EXPERIENCE_TRANSFER_TYPE,
  moveItem,
  moveResumeBullet,
  moveSection,
  RESUME_BULLET_TRANSFER_TYPE,
  SECTION_TRANSFER_TYPE,
  SKILL_TRANSFER_TYPE,
  sectionOrder,
} from "./resumeReorder";

const MM = 96 / 25.4;
const SHEET = 297 * MM;
const SHEET_GAP = 16;
const MARGIN_Y = NAVY_SERIF_STYLE.margin.y * MM;
/** Blocks that must not straddle a page break, in document order. A whole
 *  role or project moves when it fits on a page; a longer one breaks by line. */
const ENTRY = ".resume-experience, .resume-project";
const PAGE_BLOCKS = [
  ".resume-experience",
  ".resume-project",
  ".resume-paper h2",
  ".resume-position",
  ".resume-experience-heading",
  ".resume-experience > textarea",
  ".resume-bullets > li",
  ".resume-project > p",
  ".resume-skill",
  ".resume-education .resume-simple-item",
  ".resume-awards .resume-simple-item",
  ".resume-certifications .resume-simple-items",
  ".resume-richtext",
].join(",");
/** Headings also need room for the line that follows them. */
const KEEP_WITH_NEXT = "h2, .resume-position, .resume-experience-heading";

/**
 * Push blocks that would cross a sheet's bottom margin to the next sheet's top
 * margin, Word-style. Returns how many sheets the content needs.
 */
function paginate(paper: HTMLElement, scale: number) {
  for (const element of paper.querySelectorAll<HTMLElement>("[data-page-push]")) {
    element.style.marginTop = "";
    element.removeAttribute("data-page-push");
  }
  const origin = () => paper.getBoundingClientRect().top;
  const pitch = SHEET + SHEET_GAP;
  for (const block of paper.querySelectorAll<HTMLElement>(PAGE_BLOCKS)) {
    // Retry once: a pushed margin can collapse into a parent's margin.
    for (let attempt = 0; attempt < 2; attempt++) {
      const rect = block.getBoundingClientRect();
      const top = (rect.top - origin()) / scale;
      const sheet = Math.floor(top / pitch);
      const end = sheet * pitch + SHEET - MARGIN_Y;
      let height = rect.height / scale + (block.matches(KEEP_WITH_NEXT) ? 16 : 0);
      // A section heading moves with its first role or project when that fits.
      const first = block.matches("h2")
        ? block.parentElement?.querySelector<HTMLElement>(ENTRY)
        : null;
      if (first) {
        const withEntry = (first.getBoundingClientRect().bottom - rect.top) / scale;
        if (withEntry <= SHEET - 2 * MARGIN_Y) height = withEntry;
      }
      if (height <= 0 || top + height <= end || height > SHEET - 2 * MARGIN_Y) break;
      const push = (sheet + 1) * pitch + MARGIN_Y - top;
      block.style.marginTop = `${Number.parseFloat(getComputedStyle(block).marginTop) + push}px`;
      block.setAttribute("data-page-push", "");
    }
  }
  let bottom = 0;
  for (const child of paper.children)
    if (!child.classList.contains("resume-sheet"))
      bottom = Math.max(bottom, (child.getBoundingClientRect().bottom - origin()) / scale);
  return Math.max(1, Math.ceil((bottom + MARGIN_Y - SHEET) / pitch) + 1);
}

/** "<degree> in <area>": show the area unless empty or already in the degree. */
function showArea(degree: unknown, area: unknown) {
  const text = String(area ?? "")
    .trim()
    .toLowerCase();
  return (
    Boolean(text) &&
    !String(degree ?? "")
      .toLowerCase()
      .includes(text)
  );
}

function safeUrl(url: string | undefined) {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/** Profile URLs are shown as text (as in the PDF) so ATS parsers can read them. */
function bareUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/** Indent the keywords' first line past the "Label:" that sits over it. */
function fitSkillRow(row: HTMLDivElement | null) {
  const label = row?.querySelector<HTMLElement>(".resume-skill-label");
  const keywords = row?.querySelector("textarea");
  if (!row || !label || !keywords) return;
  // offsetWidth is the unscaled layout width; the paper is CSS-transformed.
  row.style.setProperty("--skill-label-w", `${label.offsetWidth}px`);
  fitTextarea(keywords);
}

type LinkInput = {
  caption: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};
/** Shows a link's text; clicking it opens a small card with its fields. */
function LinkField({
  text,
  label,
  fields,
  disabled,
  linked = true,
  changed,
  children,
}: {
  text: ReactNode;
  label: string;
  fields: LinkInput[];
  disabled?: boolean;
  linked?: boolean;
  /** Attributes from changedProps(): tint a field edited away from the library. */
  changed?: { title: string };
  children?: ReactNode;
}) {
  return (
    <span className="resume-link-field">
      <button
        type="button"
        className={linked ? "resume-contact-link" : undefined}
        disabled={disabled}
        aria-label={label}
        title={label}
        {...changed}
      >
        {text}
      </button>
      <span className="resume-link-editor">
        {fields.map((field) => (
          <Fragment key={field.label}>
            <span aria-hidden="true">{field.caption}</span>
            <Input
              aria-label={field.label}
              placeholder={field.placeholder}
              value={field.value}
              disabled={disabled}
              onChange={(event) => field.onChange(event.target.value)}
            />
          </Fragment>
        ))}
        {children}
      </span>
    </span>
  );
}

const SAVE_FIELD_LABELS: Record<string, string> = {
  company: "Company",
  location: "Location",
  period: "Dates",
  website: "Website",
  keywords: "Keywords",
  school: "School",
  area: "Field of study",
  grade: "Grade",
  description: "Description",
  date: "Date",
  awarder: "Awarded by",
  issuer: "Issued by",
};

type Props = {
  library?: ExperienceBullet[];
  onSaveLineToLibrary?: (libraryId: string, text: string) => void;
  /** Save a linked entry's changed fields to its library item. */
  onSaveEntryToLibrary?: (section: EntrySection, itemId: string) => void;
  document: ReactiveResumeV5Document;
  onChange: (document: ReactiveResumeV5Document) => void;
  suggestions: ResumeSuggestionV2[];
  onDismiss: (ids: string[]) => void;
  onAccept: (items: ResumeSuggestionV2[]) => void;
  rejectionReasons?: Record<string, string>;
  disabled?: boolean;
  /** Margin "Ask AI" button: add this part of the resume to the chat focus. */
  onAskAi?: (ref: ResumeFocusRef) => void;
  /** Job resumes take contacts from library ticks: hide empty contact fields. */
  contactsFromLibrary?: boolean;
};
export function ResumeEditor({
  document,
  onChange,
  suggestions,
  onDismiss,
  onAccept,
  rejectionReasons = {},
  disabled,
  onAskAi,
  library = [],
  onSaveLineToLibrary,
  onSaveEntryToLibrary,
  contactsFromLibrary = false,
}: Props) {
  const [addingSummary, setAddingSummary] = useState(
    Boolean(bulletsFromHtml(document.summary.content).length),
  );
  const [addingHeadline, setAddingHeadline] = useState(Boolean(document.basics.headline));
  // Stable row keys: removing a cleared bullet on blur (mousedown) must not let
  // the following click land on a row that now shows a different bullet.
  const bulletKeys = useRef(new Map<string, { text: string; key: number }[]>());
  const nextBulletKey = useRef(0);
  function keyBullets(id: string, bullets: string[]) {
    const previous = [...(bulletKeys.current.get(id) ?? [])];
    const matched = bullets.map((text) => {
      const at = previous.findIndex((entry) => entry.text === text);
      return at < 0 ? undefined : previous.splice(at, 1)[0].key;
    });
    // An edited bullet keeps the key of the unmatched row it replaced.
    const keys = matched.map((key) => key ?? previous.shift()?.key ?? nextBulletKey.current++);
    bulletKeys.current.set(
      id,
      bullets.map((text, i) => ({ text, key: keys[i] })),
    );
    return keys;
  }
  // Unmount commits can run after a row was removed; always edit the latest document.
  const currentDocument = useRef(document);
  currentDocument.current = document;
  const canvas = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLFieldSetElement>(null);
  const [scale, setScale] = useState(1);
  const [sheets, setSheets] = useState(1);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Typing in local-draft inputs and :focus-within reveals change layout
  // without a React render; bump this so pagination re-runs.
  const [, repaginate] = useReducer((n: number) => n + 1, 0);
  // Move buttons: React may move the focused node (losing focus) or disable
  // it at the ends, so refocus after the reorder renders.
  const focusAfterMove = useRef<{
    label: string;
    fallback: string;
    scope?: string;
  } | null>(null);
  /** Refocus the moved row's Move button; `scope` is a data-focus-item id. */
  function keepMoveFocus(
    label: (direction: "up" | "down") => string,
    direction: "up" | "down",
    scope?: string,
  ) {
    focusAfterMove.current = {
      label: label(direction),
      fallback: label(direction === "up" ? "down" : "up"),
      scope,
    };
  }
  useEffect(() => {
    const ownerDocument = canvas.current?.ownerDocument;
    if (!ownerDocument) return;
    const end = () => {
      setDragOver(null);
    };
    ownerDocument.addEventListener("dragend", end, true);
    ownerDocument.addEventListener("drop", end, true);
    return () => {
      ownerDocument.removeEventListener("dragend", end, true);
      ownerDocument.removeEventListener("drop", end, true);
    };
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!canvas.current) return;
      setScale(Math.max(0.6, Math.min(1, canvas.current.clientWidth / (210 * MM))));
    };
    const observer = new ResizeObserver(measure);
    if (canvas.current) observer.observe(canvas.current);
    measure();
    return () => observer.disconnect();
  }, []);
  // Runs after every render; paginate only touches its own margins and the
  // sheet count settles after one extra render, so this cannot loop.
  useLayoutEffect(() => {
    if (!page.current) return;
    setSheets(paginate(page.current, scale));
    const pending = focusAfterMove.current;
    if (!pending) return;
    focusAfterMove.current = null;
    const root = pending.scope
      ? [...page.current.querySelectorAll<HTMLElement>("[data-focus-item]")].find(
          (element) => element.dataset.focusItem === pending.scope,
        )
      : page.current;
    const buttons = [...(root?.querySelectorAll("button") ?? [])];
    const find = (label: string) => buttons.find((b) => b.getAttribute("aria-label") === label);
    const target = find(pending.label);
    (target && !target.disabled ? target : find(pending.fallback))?.focus();
  });
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    globalThis.document?.fonts?.ready.then(() => setFontsReady(true));
  }, []);
  function dragHandle(type: string, value: unknown, label: string) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: Firefox cannot reliably start native drags from buttons; adjacent buttons provide keyboard reordering.
      <span
        role="button"
        tabIndex={-1}
        aria-disabled={disabled}
        className="resume-drag"
        draggable={!disabled}
        aria-label={label}
        title={label}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData(type, JSON.stringify(value));
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDragOver(null)}
      >
        ⠿
      </span>
    );
  }
  /** Drag source for the chat: a different MIME type from in-editor reorders. */
  function focusDrag(ref: ResumeFocusRef) {
    if (!onAskAi) return {};
    return {
      draggable: true,
      // Clicking the heading focuses it, which shows its line's tools.
      tabIndex: -1,
      onDragStart: (event: React.DragEvent) => {
        event.stopPropagation();
        event.dataTransfer.setData(FOCUS_TRANSFER_TYPE, JSON.stringify(ref));
        event.dataTransfer.effectAllowed = "copy";
      },
    };
  }
  function askAi(ref: ResumeFocusRef) {
    if (!onAskAi) return null;
    return (
      // biome-ignore lint/a11y/useSemanticElements: Firefox cannot reliably start native drags from buttons.
      <span
        role="button"
        className="resume-drag resume-ask"
        aria-label={`Ask AI about ${ref.label}`}
        title="Ask AI (or drag into the chat)"
        {...focusDrag(ref)}
        tabIndex={0}
        onClick={() => onAskAi(ref)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onAskAi(ref);
          }
        }}
      >
        ✦
      </span>
    );
  }
  function fieldSuggestions(section: string, itemId: string) {
    return suggestionList(
      suggestions.filter(
        (s) =>
          s.op === "replace_field" && s.field?.section === section && s.field.itemId === itemId,
      ),
    );
  }
  function reorderZone(kind: "experience" | "skills", gap: number) {
    const type = kind === "experience" ? EXPERIENCE_TRANSFER_TYPE : SKILL_TRANSFER_TYPE;
    const key = `${kind}-${gap}`;
    return (
      <fieldset
        className="resume-gap"
        data-active={dragOver === key}
        title={`Move ${kind} to position ${gap + 1}`}
        aria-label={`Move ${kind} to position ${gap + 1}`}
        onDragOver={(event) => {
          if (!disabled && event.dataTransfer.types.includes(type)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDragOver(key);
          }
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(null);
          if (disabled) return;
          try {
            const id = JSON.parse(event.dataTransfer.getData(type));
            const items = document.sections[kind].items;
            const from = items.findIndex((item) => item.id === id);
            change((next) => {
              if (kind === "experience")
                next.sections.experience.items = moveItem(
                  next.sections.experience.items,
                  from,
                  gap,
                );
              else next.sections.skills.items = moveItem(next.sections.skills.items, from, gap);
            });
          } catch {
            /* Ignore unrelated or malformed external drags. */
          }
        }}
      />
    );
  }
  function change(edit: (next: ReactiveResumeV5Document) => void) {
    const next = structuredClone(currentDocument.current);
    edit(next);
    currentDocument.current = next;
    onChange(next);
  }
  function updateBullets(id: string, edit: (lines: ResumeLine[]) => ResumeLine[]) {
    change((next) => {
      for (const section of [next.sections.experience, next.sections.projects]) {
        const index = section?.items.findIndex((item) => item.id === id) ?? -1;
        if (!section || index < 0) continue;
        const item = section.items[index];
        section.items[index] = setItemLines(item, edit(getItemLines(item))) as typeof item;
        break;
      }
    });
  }
  const isLinked = (id: unknown) => library.some((item) => item.id === id);
  function removeLinked(id: unknown) {
    if (typeof id !== "string") return;
    const next = removeFromResume(currentDocument.current, id);
    currentDocument.current = next;
    onChange(next);
  }
  /** Reset / Save for a linked entry edited away from its library item. */
  function entryTools(section: EntrySection, item: Record<string, unknown>) {
    if (!Object.keys(changedLibraryFields(item, library)).length) return null;
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          title="Reset to library"
          aria-label="Reset entry to library"
          onClick={() =>
            change((next) => {
              const items = next.sections[section].items as unknown as Record<string, unknown>[];
              const index = items.findIndex((entry) => entry.id === item.id);
              if (index >= 0) items[index] = resetEntryFields(items[index], library);
            })
          }
        >
          Reset to library
        </Button>
        {onSaveEntryToLibrary && (
          <Button
            size="sm"
            variant="ghost"
            title="Save to library"
            aria-label="Save entry to library"
            onClick={() => onSaveEntryToLibrary(section, String(item.id))}
          >
            Save to library
          </Button>
        )}
      </>
    );
  }
  function lineTools(itemId: string, index: number, line: ResumeLine) {
    const original = library.find((item) => item.id === line.ref);
    if (!original || sameLineText(line.text, original.text)) return null;
    return (
      <>
        <Button
          size="sm"
          variant="ghost"
          title="Reset to library text"
          aria-label="Reset to library text"
          onClick={() => {
            const next = resetLine(currentDocument.current, itemId, index, library);
            currentDocument.current = next;
            onChange(next);
          }}
        >
          Reset to library text
        </Button>
        {onSaveLineToLibrary && (
          <Button
            size="sm"
            variant="ghost"
            title="Save to library"
            aria-label="Save to library"
            onClick={() => onSaveLineToLibrary(original.id, line.text)}
          >
            Save to library
          </Button>
        )}
      </>
    );
  }
  /** Title (plus tint) for a linked entry field edited away from its library item. */
  function changedProps(item: Record<string, unknown>, fields: string[], label: string) {
    const changed = changedLibraryFields(item, library);
    const values = fields.filter((field) => field in changed);
    return values.length
      ? {
          title: `${label} — library: ${values.map((field) => changed[field] || "(empty)").join(" · ")}`,
          "data-library-changed": "",
        }
      : { title: label };
  }
  function lineAppearance(line: ResumeLine) {
    const original = library.find((item) => item.id === line.ref);
    return original && !sameLineText(line.text, original.text)
      ? { className: REWORDED_TINT_CLASS, title: original.text }
      : {};
  }
  // Inserts have no previousText: bind them to the description first reviewed.
  const snapshots = useRef(new WeakMap<ResumeSuggestionV2, string>());
  function target(s: ResumeSuggestionV2) {
    if (s.op === "insert_bullet") {
      const description =
        document.sections[s.section].items.find((i) => i.id === s.itemId)?.description ?? "";
      const previous = snapshots.current.get(s);
      if (previous === undefined) snapshots.current.set(s, description);
      else if (previous !== description) return null;
    }
    return suggestionTarget(document, s, library);
  }
  for (const s of suggestions) target(s);
  function accept(items: ResumeSuggestionV2[]) {
    onAccept(
      items.filter((s) =>
        s.op === "save_to_library"
          ? "input" in librarySaveInput(document, s.target, library)
          : target(s) !== null,
      ),
    );
  }
  const libraryChangeCount = suggestions.filter(
    (s) => s.op === "create_library_item" || s.op === "save_to_library",
  ).length;
  function suggestionList(items: ResumeSuggestionV2[]) {
    return items.map((s) => {
      const resolved = target(s);
      const label =
        s.op === "replace_field"
          ? `Change ${s.field.name}`
          : {
              replace_bullet: "Rewrite bullet",
              insert_bullet: "Add bullet",
              delete_bullet: "Remove bullet",
              replace_summary: "Change summary",
              replace_headline: "Change headline",
              set_skill_keywords: "Update skill keywords",
              replace_intro: "Change introduction",
              reorder_bullets: "Reorder bullets",
              add_entry: "Add entry",
              remove_entry: "Remove entry",
              reorder_entries: "Reorder entries",
              include_library_item: "Include library item",
              exclude_library_item: "Exclude library item",
              create_library_item: "Add to library",
              save_to_library: "Save to library (updates other resumes using it)",
            }[s.op];
      const savePreview =
        s.op === "save_to_library" ? librarySaveInput(document, s.target, library) : null;
      const applicable =
        s.op === "save_to_library"
          ? Boolean(savePreview && "input" in savePreview)
          : Boolean(resolved);
      return (
        <article key={s.id} className="resume-suggestion">
          <p className="font-medium">{label}</p>
          {s.op === "save_to_library" ? (
            savePreview && "input" in savePreview ? (
              <div className="text-sm">
                <p>{savePreview.input.text}</p>
                <dl>
                  {Object.entries(savePreview.input.data ?? {})
                    .filter(([key]) => key !== "schemaVersion")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt className="font-medium">{SAVE_FIELD_LABELS[key] ?? key}</dt>
                        <dd>
                          {Array.isArray(value)
                            ? value.join(", ")
                            : value && typeof value === "object"
                              ? [
                                  (value as { url?: string }).url,
                                  (value as { label?: string }).label,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : htmlToPlainText(String(value ?? ""))}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {savePreview && "code" in savePreview && savePreview.code === "STALE"
                  ? "Not applicable — this content has changed."
                  : "The linked resume content is no longer available."}
              </p>
            )
          ) : s.op === "exclude_library_item" ? (
            <del className="resume-deletion">
              {library.find((row) => row.id === s.libraryId)?.text}
            </del>
          ) : resolved ? (
            <>
              <del className="resume-deletion">{resolved.old}</del>
              <mark className="resume-insertion">
                {s.op === "set_skill_keywords"
                  ? s.keywords.join(", ")
                  : "text" in s
                    ? s.text
                    : s.op === "create_library_item"
                      ? `${s.item.text}${s.includeOnResume ? " · Include on resume" : ""}`
                      : s.op === "add_entry"
                        ? Object.values(s.item)
                            .filter((value) => typeof value === "string" && value)
                            .join(" · ")
                        : "libraryId" in s
                          ? library.find((row) => row.id === s.libraryId)?.text
                          : label}
              </mark>
            </>
          ) : (
            <p className="text-muted-foreground">Not applicable — this content has changed.</p>
          )}
          {rejectionReasons[s.id] && (
            <output className="text-muted-foreground">{rejectionReasons[s.id]}</output>
          )}
          <p className="text-xs text-muted-foreground">{s.reason}</p>
          <div className="resume-review">
            <Button
              size="sm"
              disabled={disabled || !applicable}
              title={`Accept: ${label}`}
              aria-label={`Accept: ${label}`}
              onClick={() => accept([s])}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title={`Reject: ${label}`}
              aria-label={`Reject: ${label}`}
              onClick={() => onDismiss([s.id])}
            >
              Reject
            </Button>
          </div>
        </article>
      );
    });
  }
  function dropZone(id: string, index: number) {
    const key = `${id}-${index}`;
    return {
      "data-active": dragOver === key,
      onDragLeave: () => setDragOver(null),
      onDragOver: (event: React.DragEvent) => {
        if (!disabled && event.dataTransfer.types.includes(RESUME_BULLET_TRANSFER_TYPE)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDragOver(key);
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(null);
        if (disabled) return;
        if (event.dataTransfer.types.includes(RESUME_BULLET_TRANSFER_TYPE)) {
          try {
            const source = JSON.parse(event.dataTransfer.getData(RESUME_BULLET_TRANSFER_TYPE));
            if (
              source &&
              typeof source.experienceId === "string" &&
              Number.isInteger(source.index)
            ) {
              const next = moveResumeBullet(currentDocument.current, source, id, index);
              currentDocument.current = next;
              onChange(next);
            }
          } catch {
            /* Ignore malformed external drags. */
          }
          return;
        }
      },
    };
  }
  type SimpleSection = "education" | "certifications" | "awards";
  // A custom section title from the document wins; otherwise the standard ATS heading.
  const heading = (
    key: "summary" | "skills" | "experience" | "projects" | SimpleSection,
    name: string,
  ) => (key === "summary" ? document.summary.title : document.sections[key].title)?.trim() || name;
  const simpleNames = {
    education: "Education",
    certifications: "Certifications",
    awards: "Awards",
  };
  function simpleSection(kind: SimpleSection) {
    const section = document.sections[kind];
    if (!section || section.hidden) return null;
    const fields =
      kind === "education"
        ? ["school", "period", "degree", "area"]
        : kind === "certifications"
          ? ["title", "issuer", "date"]
          : ["title", "description"];
    // Key labels by the field being edited, independently of its visual order.
    const fieldLabels: Record<string, string> = {
      school: "school",
      period: "period (dates attended)",
      degree: "degree",
      area: "field of study",
      title: kind === "awards" ? "award title" : "certification title",
      description: "description",
      awarder: "awarding organization",
      issuer: "issuing organization",
      date: kind === "awards" ? "award date" : "certification date",
      website: "website URL",
    };
    function fieldInput(item: (typeof section.items)[number], index: number, field: string) {
      const label = `${simpleNames[kind]} ${index + 1} ${fieldLabels[field]}`;
      if (field === "description")
        // One paragraph that wraps and grows with its text.
        return (
          <textarea
            rows={1}
            {...changedProps(item, [field], label)}
            aria-label={label}
            placeholder="Description"
            className="resume-field-description"
            ref={(element) => {
              if (element) fitTextarea(element);
            }}
            value={bulletsFromHtml(String(item.description ?? "")).join(" ")}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(event) => {
              fitTextarea(event.currentTarget);
              change((next) => {
                next.sections[kind].items[index].description = introTextToHtml(event.target.value);
              });
            }}
          />
        );
      return (
        <Input
          {...changedProps(item, [field], label)}
          aria-label={label}
          className={`resume-field-${field}`}
          value={field === "website" ? (item.website?.url ?? "") : String(item[field] ?? "")}
          placeholder={
            (
              {
                school: "School",
                period: "Dates attended",
                degree: "Degree",
                area: "Field of study",
                title: kind === "awards" ? "Award" : "Certification",
                date: kind === "awards" ? "Award date" : "Certification date",
                issuer: "Issuing organization",
                website: "https://example.com",
              } as Record<string, string>
            )[field]
          }
          onChange={(event) =>
            change((next) => {
              if (field === "website")
                next.sections[kind].items[index].website = {
                  ...item.website,
                  url: event.target.value,
                };
              else next.sections[kind].items[index][field] = event.target.value;
            })
          }
        />
      );
    }
    return () => (
      <section className={`resume-section resume-${kind}`} aria-label={simpleNames[kind]}>
        {section?.items.some((item) => !item.hidden) && (
          <h2
            {...focusDrag({
              kind: "section",
              section: kind,
              label: simpleNames[kind],
            })}
          >
            {heading(kind, simpleNames[kind])}
          </h2>
        )}
        {sectionTools(kind)}
        <div className="resume-simple-items">
          {section?.items.map(
            (item, index) =>
              !item.hidden && (
                <div
                  className="resume-row resume-simple-item"
                  key={item.id}
                  data-focus-item={item.id}
                >
                  {fields.map((field) => {
                    const input =
                      kind === "certifications" && field === "title" ? (
                        <LinkField
                          text={String(item.title || "Certification")}
                          label={`Edit Certifications ${index + 1} ${fieldLabels.title}`}
                          linked={Boolean(safeUrl(item.website?.url))}
                          changed={changedProps(
                            item,
                            ["title", "website"],
                            `Edit Certifications ${index + 1} ${fieldLabels.title}`,
                          )}
                          disabled={disabled}
                          fields={[
                            {
                              caption: "Title",
                              label: `Certifications ${index + 1} ${fieldLabels.title}`,
                              placeholder: "Certification",
                              value: String(item.title ?? ""),
                              onChange: (title) =>
                                change((next) => {
                                  next.sections.certifications.items[index].title = title;
                                }),
                            },
                            {
                              caption: "Link",
                              label: `Certifications ${index + 1} ${fieldLabels.website}`,
                              placeholder: "https://…",
                              value: item.website?.url ?? "",
                              onChange: (url) =>
                                change((next) => {
                                  next.sections.certifications.items[index].website = {
                                    ...item.website,
                                    url,
                                  };
                                }),
                            },
                          ]}
                        />
                      ) : (
                        fieldInput(item, index, field)
                      );
                    if (field === "area") return null;
                    if (field === "degree")
                      return (
                        <span key={field} className="resume-education-degree">
                          {input}
                          {/* Only when the PDF prints it: not empty or already in the degree. */}
                          {showArea(item.degree, item.area) && (
                            <>
                              <span className="resume-education-in">in</span>
                              {fieldInput(item, index, "area")}
                            </>
                          )}
                        </span>
                      );
                    return (
                      <Fragment key={field}>
                        {kind === "certifications" && field !== "title" && (
                          <span aria-hidden="true">-</span>
                        )}
                        {input}
                        {/* Like the PDF: the colon only leads a description. */}
                        {kind === "awards" &&
                          field === "title" &&
                          bulletsFromHtml(String(item.description ?? ""))
                            .join("")
                            .trim() && <span aria-hidden="true">:</span>}
                      </Fragment>
                    );
                  })}
                  <div className="resume-tools">
                    {entryTools(kind, item)}
                    {askAi({
                      kind: "item",
                      section: kind,
                      itemId: item.id,
                      label: `${simpleNames[kind]} › ${String(item.school || item.title || index + 1)}`,
                    })}
                    {(["up", "down"] as const).map((direction) => (
                      <Button
                        key={direction}
                        size="sm"
                        variant="ghost"
                        title={`Move ${simpleNames[kind]} ${index + 1} ${direction}`}
                        aria-label={`Move ${simpleNames[kind]} ${index + 1} ${direction}`}
                        disabled={
                          direction === "up" ? index === 0 : index === section.items.length - 1
                        }
                        onClick={() => {
                          const target = direction === "up" ? index - 1 : index + 1;
                          keepMoveFocus(
                            (d) => `Move ${simpleNames[kind]} ${target + 1} ${d}`,
                            direction,
                          );
                          change((next) => {
                            const items = next.sections[kind].items;
                            [items[index], items[target]] = [items[target], items[index]];
                          });
                        }}
                      >
                        {direction === "up" ? "↑" : "↓"}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      title={`Delete ${simpleNames[kind]} ${index + 1}`}
                      aria-label={`Delete ${simpleNames[kind]} ${index + 1}`}
                      onClick={() =>
                        isLinked(item.libraryId)
                          ? removeLinked(item.libraryId)
                          : change((next) => {
                              next.sections[kind].items.splice(index, 1);
                            })
                      }
                    >
                      ×
                    </Button>
                  </div>
                  {fieldSuggestions(kind, item.id)}
                </div>
              ),
          )}
        </div>
      </section>
    );
  }
  const sections = {
    summary: document.summary.hidden
      ? null
      : () =>
          addingSummary || bulletsFromHtml(document.summary.content).length > 0 ? (
            <section className="resume-section" aria-label="Summary">
              <h2
                className="text-sm font-semibold"
                {...focusDrag({ kind: "summary", label: "Summary" })}
              >
                {heading("summary", "Summary")}
              </h2>
              {sectionTools("summary")}
              <div
                ref={(element) => {
                  element?.toggleAttribute("inert", Boolean(disabled));
                }}
              >
                <RichTextEditor
                  className="resume-richtext"
                  formatLabel={null}
                  value={document.summary.content}
                  onChange={(value) => {
                    setAddingSummary(true);
                    change((next) => {
                      next.summary.content = value;
                    });
                  }}
                />
              </div>
              {suggestionList(suggestions.filter((s) => s.op === "replace_summary"))}
            </section>
          ) : (
            <section className="resume-section resume-empty-summary">
              {sectionTools("summary")}
              <Button
                className="resume-add"
                size="sm"
                variant="ghost"
                onClick={() => setAddingSummary(true)}
              >
                + Summary
              </Button>
              {suggestionList(suggestions.filter((s) => s.op === "replace_summary"))}
            </section>
          ),
    skills: document.sections.skills.hidden
      ? null
      : () =>
          document.sections.skills.items.some((s) => !s.hidden) ||
          suggestions.some((s) => s.op === "set_skill_keywords") ? (
            <section className="resume-section" aria-label="Skills">
              <h2
                className="text-sm font-semibold"
                {...focusDrag({
                  kind: "section",
                  section: "skills",
                  label: "Skills",
                })}
              >
                {heading("skills", "Skills")}
              </h2>
              {sectionTools("skills")}
              {document.sections.skills.items.map(
                (skill, index) =>
                  !skill.hidden && (
                    <div
                      key={skill.id}
                      data-focus-item={skill.id}
                      className="resume-row resume-skill"
                      ref={(row) => fitSkillRow(row)}
                    >
                      {reorderZone("skills", index)}
                      <span className="resume-skill-label">
                        <span className="resume-skill-name-box">
                          <span aria-hidden="true">{skill.name}</span>
                          <Input
                            {...changedProps(skill, ["name"], `Skill ${index + 1} name`)}
                            aria-label={`Skill ${index + 1} name`}
                            className="resume-skill-name"
                            value={skill.name}
                            onChange={(e) =>
                              change((next) => {
                                next.sections.skills.items[index].name = e.target.value;
                              })
                            }
                          />
                        </span>
                        :
                      </span>
                      <CommaListInput
                        multiline
                        className="resume-skill-keywords"
                        {...changedProps(skill, ["keywords"], `Skill ${index + 1} keywords`)}
                        aria-label={`Skill ${index + 1} keywords`}
                        value={skill.keywords}
                        onCommit={(keywords) => {
                          if (
                            !currentDocument.current.sections.skills.items.some(
                              (item) => item.id === skill.id,
                            )
                          )
                            return;
                          change((next) => {
                            const item = next.sections.skills.items.find(
                              (item) => item.id === skill.id,
                            );
                            if (item) item.keywords = keywords;
                          });
                        }}
                      />
                      <div className="resume-tools resume-skill-controls">
                        {entryTools("skills", skill)}
                        {dragHandle(SKILL_TRANSFER_TYPE, skill.id, `Drag skill ${index + 1}`)}
                        {askAi({
                          kind: "skill",
                          section: "skills",
                          itemId: skill.id,
                          label: `Skills › ${skill.name || index + 1}`,
                        })}
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`Move skill ${index + 1} up`}
                          aria-label={`Move skill ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => {
                            keepMoveFocus((d) => `Move skill ${index} ${d}`, "up");
                            change((next) => {
                              next.sections.skills.items = moveItem(
                                next.sections.skills.items,
                                index,
                                index - 1,
                              );
                            });
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`Move skill ${index + 1} down`}
                          aria-label={`Move skill ${index + 1} down`}
                          disabled={index === document.sections.skills.items.length - 1}
                          onClick={() => {
                            keepMoveFocus((d) => `Move skill ${index + 2} ${d}`, "down");
                            change((next) => {
                              next.sections.skills.items = moveItem(
                                next.sections.skills.items,
                                index,
                                index + 2,
                              );
                            });
                          }}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`Delete skill ${skill.name}`}
                          aria-label={`Delete skill ${skill.name}`}
                          onClick={() =>
                            isLinked(skill.libraryId)
                              ? removeLinked(skill.libraryId)
                              : change((next) => {
                                  next.sections.skills.items.splice(index, 1);
                                })
                          }
                        >
                          ×
                        </Button>
                      </div>
                      {fieldSuggestions("skills", skill.id)}
                    </div>
                  ),
              )}
              {reorderZone("skills", document.sections.skills.items.length)}
              {suggestionList(suggestions.filter((s) => s.op === "set_skill_keywords"))}
            </section>
          ) : (
            <section className="resume-section">{sectionTools("skills")}</section>
          ),
    certifications: simpleSection("certifications"),
    experience: !document.sections.experience.hidden
      ? () => (
          <section className="resume-section" aria-label="Experience">
            <h2
              className="text-sm font-semibold"
              {...focusDrag({
                kind: "section",
                section: "experience",
                label: "Experience",
              })}
            >
              {heading("experience", "Experience")}
            </h2>
            {sectionTools("experience")}
            {document.sections.experience.items
              .filter((e) => !e.hidden)
              .map((experience) => {
                const { introHtml } = splitDescription(experience.description);
                const lines = getItemLines(experience);
                const bulletKeyList = keyBullets(
                  experience.id,
                  lines.map((line) => line.text),
                );
                const name = experience.company || "new experience";
                const itemRef: ResumeFocusRef = {
                  kind: "item",
                  section: "experience",
                  itemId: experience.id,
                  label: `Experience › ${name}${experience.position ? ` — ${experience.position}` : ""}`,
                };
                return (
                  <section
                    key={experience.id}
                    data-focus-item={experience.id}
                    className="resume-experience resume-row"
                  >
                    {reorderZone(
                      "experience",
                      document.sections.experience.items.indexOf(experience),
                    )}
                    <Input
                      className="resume-position"
                      {...changedProps(experience, ["position"], `${name} position`)}
                      aria-label={`${name} position`}
                      value={experience.position ?? ""}
                      placeholder="Position"
                      onChange={(event) =>
                        change((next) => {
                          const item = next.sections.experience.items.find(
                            (entry) => entry.id === experience.id,
                          );
                          if (item) item.position = event.target.value;
                        })
                      }
                    />
                    <div className="resume-experience-heading">
                      {(["company", "location", "period"] as const).map((field) => {
                        const placeholder =
                          field === "period"
                            ? "Jan 2023 – Present"
                            : field === "company"
                              ? "Company"
                              : "Location";
                        return (
                          <Fragment key={field}>
                            {field === "location" && <span aria-hidden="true">-</span>}
                            <Input
                              {...changedProps(
                                experience,
                                [field],
                                `${name} ${field === "period" ? "dates" : field}`,
                              )}
                              aria-label={`${name} ${field === "period" ? "dates" : field}`}
                              value={experience[field] ?? ""}
                              placeholder={placeholder}
                              // Width fallback where CSS field-sizing is unsupported (Firefox, Safari).
                              size={Math.max((experience[field] || placeholder).length, 1)}
                              onChange={(event) =>
                                change((next) => {
                                  const item = next.sections.experience.items.find(
                                    (entry) => entry.id === experience.id,
                                  );
                                  if (item) item[field] = event.target.value;
                                })
                              }
                            />
                          </Fragment>
                        );
                      })}
                    </div>
                    <div className="resume-tools resume-entry-controls">
                      {entryTools("experience", experience)}
                      {dragHandle(
                        EXPERIENCE_TRANSFER_TYPE,
                        experience.id,
                        `Drag experience ${name}`,
                      )}
                      {askAi(itemRef)}
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Delete experience ${name}`}
                        aria-label={`Delete experience ${name}`}
                        onClick={() =>
                          isLinked(experience.libraryId)
                            ? removeLinked(experience.libraryId)
                            : change((next) => {
                                next.sections.experience.items =
                                  next.sections.experience.items.filter(
                                    (item) => item.id !== experience.id,
                                  );
                              })
                        }
                      >
                        ×
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Move experience ${name} up`}
                        aria-label={`Move experience ${name} up`}
                        disabled={document.sections.experience.items.indexOf(experience) === 0}
                        onClick={() => {
                          keepMoveFocus((d) => `Move experience ${name} ${d}`, "up", experience.id);
                          change((next) => {
                            const i = next.sections.experience.items.findIndex(
                              (e) => e.id === experience.id,
                            );
                            next.sections.experience.items = moveItem(
                              next.sections.experience.items,
                              i,
                              i - 1,
                            );
                          });
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Move experience ${name} down`}
                        aria-label={`Move experience ${name} down`}
                        disabled={
                          document.sections.experience.items.indexOf(experience) ===
                          document.sections.experience.items.length - 1
                        }
                        onClick={() => {
                          keepMoveFocus(
                            (d) => `Move experience ${name} ${d}`,
                            "down",
                            experience.id,
                          );
                          change((next) => {
                            const i = next.sections.experience.items.findIndex(
                              (e) => e.id === experience.id,
                            );
                            next.sections.experience.items = moveItem(
                              next.sections.experience.items,
                              i,
                              i + 2,
                            );
                          });
                        }}
                      >
                        ↓
                      </Button>
                    </div>
                    {fieldSuggestions("experience", experience.id)}
                    {bulletsFromHtml(introHtml).length > 0 && (
                      <BulletText
                        label={`${name} intro`}
                        value={bulletsFromHtml(introHtml).join("\n")}
                        onChange={(value) =>
                          change((next) => {
                            const item = next.sections.experience.items.find(
                              (e) => e.id === experience.id,
                            );
                            if (item)
                              item.description = joinDescription(
                                introTextToHtml(value),
                                getItemLines(item).map((line) => line.text),
                              );
                          })
                        }
                      />
                    )}
                    <ul className="resume-bullets">
                      {lines.map((line, index) => (
                        <li
                          key={bulletKeyList[index]}
                          data-focus-bullet={index}
                          className={`resume-row resume-bullet ${lineAppearance(line).className ?? ""}`}
                          title={lineAppearance(line).title}
                        >
                          <div
                            {...dropZone(experience.id, index)}
                            className="resume-gap"
                            title={`Move before bullet ${index + 1}`}
                          >
                            <span className="sr-only">Drop to move</span>
                          </div>
                          <div className="space-y-1">
                            <BulletText
                              label={`${name} bullet ${index + 1}`}
                              value={line.text}
                              linked={isLinked(line.ref)}
                              onChange={(value) => {
                                if (!value.trim() && isLinked(line.ref)) return;
                                updateBullets(experience.id, (current) =>
                                  current
                                    .map((text, i) =>
                                      i === index ? { ...text, text: value } : text,
                                    )
                                    .filter((line) => line.text.trim()),
                                );
                              }}
                            />
                            <div className="resume-tools resume-bullet-controls">
                              {lineTools(experience.id, index, line)}
                              {dragHandle(
                                RESUME_BULLET_TRANSFER_TYPE,
                                { experienceId: experience.id, index },
                                `Drag bullet ${index + 1}`,
                              )}
                              {askAi({
                                kind: "bullet",
                                section: "experience",
                                itemId: experience.id,
                                bulletIndex: index,
                                label: `${name} › bullet ${index + 1}`,
                              })}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={index === 0}
                                title={`Move bullet ${index + 1} up`}
                                aria-label={`Move bullet ${index + 1} up`}
                                onClick={() => {
                                  keepMoveFocus(
                                    (d) => `Move bullet ${index} ${d}`,
                                    "up",
                                    experience.id,
                                  );
                                  updateBullets(experience.id, (current) => {
                                    [current[index - 1], current[index]] = [
                                      current[index],
                                      current[index - 1],
                                    ];
                                    return current;
                                  });
                                }}
                              >
                                ↑
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={index === lines.length - 1}
                                title={`Move bullet ${index + 1} down`}
                                aria-label={`Move bullet ${index + 1} down`}
                                onClick={() => {
                                  keepMoveFocus(
                                    (d) => `Move bullet ${index + 2} ${d}`,
                                    "down",
                                    experience.id,
                                  );
                                  updateBullets(experience.id, (current) => {
                                    [current[index + 1], current[index]] = [
                                      current[index],
                                      current[index + 1],
                                    ];
                                    return current;
                                  });
                                }}
                              >
                                ↓
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                title={`Delete bullet ${index + 1}`}
                                aria-label={`Delete bullet ${index + 1}`}
                                onClick={() =>
                                  isLinked(line.ref)
                                    ? removeLinked(line.ref)
                                    : updateBullets(experience.id, (current) =>
                                        current.filter((_, i) => i !== index),
                                      )
                                }
                              >
                                ×
                              </Button>
                            </div>
                          </div>
                          {suggestionList(
                            suggestions.filter(
                              (s) =>
                                "section" in s &&
                                s.section === "experience" &&
                                "itemId" in s &&
                                s.itemId === experience.id &&
                                target(s)?.index === index,
                            ),
                          )}
                        </li>
                      ))}
                    </ul>
                    <div
                      {...dropZone(experience.id, lines.length)}
                      className="resume-gap"
                      title={`Move to end of ${name}`}
                    >
                      <span className="sr-only">Drop to move a duty to the end</span>
                    </div>
                    {suggestionList(
                      suggestions.filter(
                        (s) =>
                          "section" in s &&
                          s.section === "experience" &&
                          "itemId" in s &&
                          s.itemId === experience.id &&
                          (!target(s) || target(s)?.index === lines.length),
                      ),
                    )}
                  </section>
                );
              })}
            {reorderZone("experience", document.sections.experience.items.length)}
          </section>
        )
      : null,
    projects:
      !document.sections.projects.hidden && document.sections.projects.items.length
        ? () => (
            <section className="resume-section" aria-label="Projects">
              {document.sections.projects.items.some((p) => !p.hidden) && (
                <h2
                  {...focusDrag({
                    kind: "section",
                    section: "projects",
                    label: "Projects",
                  })}
                >
                  {heading("projects", "Projects")}
                </h2>
              )}
              {sectionTools("projects")}
              {document.sections.projects.items.map((project, index) => {
                if (project.hidden) return null;
                const lines = getItemLines(project);
                const pointKeys = keyBullets(
                  project.id,
                  lines.map((line) => line.text),
                );
                return (
                  <div
                    key={project.id}
                    data-focus-item={project.id}
                    className="resume-project resume-row"
                    // Readonly text: focusable so a click shows the line's tools.
                    tabIndex={-1}
                  >
                    <div
                      className="resume-experience-heading resume-readonly"
                      title="Edit in the right panel"
                    >
                      <h3
                        {...focusDrag({
                          kind: "item",
                          section: "projects",
                          itemId: project.id,
                          label: `Projects › ${project.name}`,
                        })}
                      >
                        <a
                          href={safeUrl(project.website?.url)}
                          {...changedProps(
                            project,
                            ["name", "website"],
                            String(project.name ?? ""),
                          )}
                        >
                          {project.name}
                        </a>
                      </h3>
                      <span {...changedProps(project, ["period"], String(project.period ?? ""))}>
                        {project.period}
                      </span>
                    </div>
                    <div className="resume-tools">
                      {entryTools("projects", project)}
                      {askAi({
                        kind: "item",
                        section: "projects",
                        itemId: project.id,
                        label: `Projects › ${project.name}`,
                      })}
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Delete project ${project.name}`}
                        aria-label={`Delete project ${project.name}`}
                        onClick={() =>
                          isLinked(project.libraryId)
                            ? removeLinked(project.libraryId)
                            : change((next) => {
                                next.sections.projects.items.splice(index, 1);
                              })
                        }
                      >
                        ×
                      </Button>
                    </div>
                    {bulletsFromHtml(splitDescription(project.description ?? "").introHtml).join(
                      "\n",
                    ) && (
                      <p className="resume-readonly" title="Edit in the right panel">
                        {bulletsFromHtml(splitDescription(project.description).introHtml).join(
                          "\n",
                        )}
                      </p>
                    )}
                    <ul className="resume-bullets">
                      {lines.map((line, i) => (
                        <li
                          key={pointKeys[i]}
                          className={`resume-row resume-bullet ${lineAppearance(line).className ?? ""}`}
                          title={lineAppearance(line).title}
                        >
                          <BulletText
                            label={`${project.name} point ${i + 1}`}
                            value={line.text}
                            linked={isLinked(line.ref)}
                            onChange={(text) => {
                              if (!text.trim() && isLinked(line.ref)) return;
                              updateBullets(project.id, (lines) =>
                                lines
                                  .map((old, at) => (at === i ? { ...old, text } : old))
                                  .filter((old) => old.text.trim()),
                              );
                            }}
                          />
                          <div className="resume-tools">
                            {lineTools(project.id, i, line)}
                            <Button
                              size="sm"
                              variant="ghost"
                              title={`Delete project point ${i + 1}`}
                              aria-label={`Delete project point ${i + 1}`}
                              onClick={() =>
                                isLinked(line.ref)
                                  ? removeLinked(line.ref)
                                  : updateBullets(project.id, (lines) =>
                                      lines.filter((_, at) => at !== i),
                                    )
                              }
                            >
                              ×
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {fieldSuggestions("projects", project.id)}
                  </div>
                );
              })}
            </section>
          )
        : null,
    education: simpleSection("education"),
    awards: simpleSection("awards"),
  };
  type SectionKey = keyof typeof sections;
  const sectionNames: Record<SectionKey, string> = {
    summary: "Summary",
    skills: "Skills",
    certifications: "Certifications",
    experience: "Experience",
    projects: "Projects",
    education: "Education",
    awards: "Awards",
  };
  const order = sectionOrder(document.metadata?.layout).filter(
    (key): key is SectionKey => key in sections && sections[key as SectionKey] !== null,
  );
  function moveTo(key: string, before: string | null) {
    onChange(moveSection(document, key, before));
  }
  function sectionGap(before: string | null) {
    const key = `section-${before}`;
    return (
      <fieldset
        className="resume-gap resume-section-gap"
        data-active={dragOver === key}
        aria-label={`Move section ${before ? `before ${sectionNames[before as SectionKey]}` : "to the end"}`}
        onDragOver={(event) => {
          if (!disabled && event.dataTransfer.types.includes(SECTION_TRANSFER_TYPE)) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDragOver(key);
          }
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(null);
          if (disabled) return;
          try {
            const moved = JSON.parse(event.dataTransfer.getData(SECTION_TRANSFER_TYPE));
            if (typeof moved === "string" && moved in sections) moveTo(moved, before);
          } catch {
            /* Ignore unrelated or malformed external drags. */
          }
        }}
      />
    );
  }
  /** A section's line tools, rendered below its heading. */
  function sectionTools(key: SectionKey) {
    const i = order.indexOf(key);
    return (
      <div className="resume-tools resume-section-controls">
        {dragHandle(SECTION_TRANSFER_TYPE, key, `Drag section ${sectionNames[key]}`)}
        {askAi(
          key === "summary"
            ? { kind: "summary", label: "Summary" }
            : {
                kind: "section",
                section: key,
                label: sectionNames[key],
              },
        )}
        <Button
          size="sm"
          variant="ghost"
          title={`Move section ${sectionNames[key]} up`}
          aria-label={`Move section ${sectionNames[key]} up`}
          disabled={i === 0}
          onClick={() => {
            keepMoveFocus((d) => `Move section ${sectionNames[key]} ${d}`, "up");
            moveTo(key, order[i - 1]);
          }}
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={`Move section ${sectionNames[key]} down`}
          aria-label={`Move section ${sectionNames[key]} down`}
          disabled={i === order.length - 1}
          onClick={() => {
            keepMoveFocus((d) => `Move section ${sectionNames[key]} ${d}`, "down");
            moveTo(key, order[i + 2] ?? null);
          }}
        >
          ↓
        </Button>
      </div>
    );
  }
  function sectionList() {
    const keys = order;
    return (
      <>
        {keys.map((key) => (
          <Fragment key={key}>
            {sectionGap(key)}
            <div className="resume-row resume-section-slot" data-focus-section={key}>
              {sections[key]?.()}
            </div>
          </Fragment>
        ))}
        {sectionGap(null)}
      </>
    );
  }
  return (
    <div className="resume-canvas" ref={canvas}>
      <p className="resume-editor-hint">
        Click a line to show its tools. Drag ⠿ to reorder or drop it into the chat.
      </p>
      <div
        className="resume-paper-frame"
        style={{
          width: `${210 * MM * scale}px`,
          height: `${(sheets * (SHEET + SHEET_GAP) - SHEET_GAP) * scale}px`,
        }}
      >
        <fieldset
          ref={page}
          disabled={disabled}
          className="resume-paper"
          onInput={repaginate}
          onFocus={repaginate}
          onBlur={repaginate}
          // Keep focus in the line while a toolbar button is clicked: Safari
          // and Firefox on macOS do not focus buttons, so the toolbar would
          // hide before the click lands. Drag handles and Ask AI are spans.
          onMouseDown={(event) => {
            if ((event.target as Element).closest(".resume-tools button")) event.preventDefault();
          }}
          style={{
            ...(NAVY_SERIF_CSS_VARS as CSSProperties),
            ...({
              "--resume-control-size": `${24 / scale}px`,
            } as CSSProperties),
            transform: `scale(${scale})`,
            minHeight: `${sheets * (SHEET + SHEET_GAP) - SHEET_GAP}px`,
          }}
        >
          {Array.from({ length: sheets }, (_, index) => (
            <div
              key={`sheet-${index + 1}`}
              className="resume-sheet"
              style={{ top: `${index * (SHEET + SHEET_GAP)}px` }}
              aria-hidden="true"
            />
          ))}
          {suggestions.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="mr-auto">{suggestions.length} suggestions</span>
              <Button
                size="sm"
                onClick={() =>
                  accept(
                    suggestions.filter(
                      (s) => s.op !== "create_library_item" && s.op !== "save_to_library",
                    ),
                  )
                }
              >
                Accept all
                {libraryChangeCount > 0
                  ? ` (${libraryChangeCount} library ${libraryChangeCount === 1 ? "change needs" : "changes need"} separate accept)`
                  : ""}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDismiss(suggestions.map((s) => s.id))}
              >
                Reject all
              </Button>
            </div>
          )}
          <header className="resume-header">
            <Input
              aria-label="Name"
              className="resume-name"
              value={document.basics.name ?? ""}
              placeholder="Your name"
              onChange={(e) =>
                change((next) => {
                  next.basics.name = e.target.value;
                })
              }
            />
            {addingHeadline || document.basics.headline ? (
              <div className="resume-row">
                <Input
                  aria-label="Headline"
                  className="resume-headline"
                  value={document.basics.headline}
                  onChange={(e) =>
                    change((next) => {
                      setAddingHeadline(true);
                      next.basics.headline = e.target.value;
                    })
                  }
                />
                <div className="resume-tools">{askAi({ kind: "headline", label: "Headline" })}</div>
              </div>
            ) : (
              <Button
                className="resume-add"
                size="sm"
                variant="ghost"
                onClick={() => setAddingHeadline(true)}
              >
                + Headline
              </Button>
            )}
            {suggestionList(suggestions.filter((s) => s.op === "replace_headline"))}
            <div className="resume-contact" data-library={contactsFromLibrary || undefined}>
              {(["phone", "email", "location"] as const).map((field) => (
                <span
                  className="resume-contact-item"
                  key={field}
                  data-empty={!document.basics[field]}
                >
                  {field === "phone" ? "Tel: " : field === "email" ? "Email: " : ""}
                  <Input
                    aria-label={
                      field === "phone" ? "Phone" : field === "email" ? "Email" : "Location"
                    }
                    type={field === "phone" ? "tel" : field === "email" ? "email" : "text"}
                    className={field === "email" ? "resume-contact-link" : undefined}
                    value={document.basics[field] ?? ""}
                    placeholder={field === "location" ? "Location" : undefined}
                    onChange={(event) =>
                      change((next) => {
                        next.basics[field] = event.target.value;
                      })
                    }
                  />
                </span>
              ))}
              <span
                className="resume-contact-item resume-row"
                data-empty={!document.basics.website?.url}
              >
                <LinkField
                  text={
                    document.basics.website?.label ||
                    bareUrl(document.basics.website?.url ?? "") ||
                    "Website"
                  }
                  label="Edit website link"
                  disabled={disabled}
                  fields={[
                    {
                      caption: "Label",
                      label: "Website label",
                      placeholder: "e.g. Portfolio",
                      value: document.basics.website?.label ?? "",
                      onChange: (label) =>
                        change((next) => {
                          next.basics.website = {
                            ...next.basics.website,
                            label,
                            url: next.basics.website?.url ?? "",
                          };
                        }),
                    },
                    {
                      caption: "Link",
                      label: "Website URL",
                      placeholder: "https://…",
                      value: document.basics.website?.url ?? "",
                      onChange: (url) =>
                        change((next) => {
                          next.basics.website = {
                            ...next.basics.website,
                            url,
                            label: next.basics.website?.label ?? "",
                          };
                        }),
                    },
                  ]}
                />
              </span>
              {!document.sections.profiles?.hidden &&
                document.sections.profiles?.items
                  .filter((profile) => !profile.hidden)
                  .map((profile, index) => {
                    const empty =
                      !profile.website?.url?.trim() &&
                      !profile.website?.label?.trim() &&
                      !profile.network?.trim() &&
                      !profile.username?.trim();
                    const setLink = (key: "url" | "label", value: string) =>
                      change((next) => {
                        const item = next.sections.profiles.items.find(
                          (item) => item.id === profile.id,
                        );
                        if (item)
                          item.website = {
                            ...item.website,
                            url: item.website?.url ?? "",
                            label: item.website?.label ?? "",
                            [key]: value,
                          };
                      });
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: Handles bubbling blur from the row's editable inputs.
                      <span
                        className="resume-contact-item resume-row"
                        key={profile.id}
                        data-focus-item={profile.id}
                        data-empty={empty}
                        onBlur={(event) => {
                          if (event.currentTarget.contains(event.relatedTarget)) return;
                          if (!empty) return;
                          change((next) => {
                            next.sections.profiles.items = next.sections.profiles.items.filter(
                              (item) => item.id !== profile.id,
                            );
                          });
                        }}
                      >
                        <LinkField
                          text={
                            profile.website?.label ||
                            profile.network ||
                            bareUrl(profile.website?.url ?? "") ||
                            profile.username
                          }
                          label={`Edit profile ${index + 1} link`}
                          disabled={disabled}
                          fields={[
                            {
                              caption: "Label",
                              label: `Profile ${index + 1} label`,
                              placeholder: "e.g. GitHub",
                              value: profile.website?.label ?? "",
                              onChange: (value) => setLink("label", value),
                            },
                            {
                              caption: "Link",
                              label: `Profile ${index + 1} URL`,
                              placeholder: "https://…",
                              value: profile.website?.url ?? "",
                              onChange: (value) => setLink("url", value),
                            },
                          ]}
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="resume-link-delete"
                            title={`Delete profile ${index + 1}`}
                            aria-label={`Delete profile ${index + 1}`}
                            onClick={() =>
                              change((next) => {
                                next.sections.profiles.items = next.sections.profiles.items.filter(
                                  (item) => item.id !== profile.id,
                                );
                              })
                            }
                          >
                            Remove
                          </Button>
                        </LinkField>
                      </span>
                    );
                  })}
            </div>
          </header>
          {sectionList()}
          {suggestionList(
            suggestions.filter(
              (s) =>
                ![
                  "replace_summary",
                  "replace_headline",
                  "set_skill_keywords",
                  "replace_field",
                  "replace_bullet",
                  "insert_bullet",
                  "delete_bullet",
                ].includes(s.op) ||
                (s.op === "replace_summary" && document.summary.hidden) ||
                (s.op === "set_skill_keywords" && document.sections.skills.hidden) ||
                (s.op === "replace_field" && !fieldVisible(document, s)) ||
                ((s.op === "replace_bullet" ||
                  s.op === "insert_bullet" ||
                  s.op === "delete_bullet") &&
                  (s.section === "projects" ||
                    document.sections.experience.hidden ||
                    !document.sections.experience.items.some(
                      (e) => e.id === s.itemId && !e.hidden,
                    ))),
            ),
          )}
        </fieldset>
      </div>
    </div>
  );
}
