import {
  bulletsFromHtml,
  introTextToHtml,
  joinDescription,
  splitDescription,
} from "@shared/resume-bullets";
import {
  getItemLines,
  isOnResume,
  type ResumeLine,
  removeFromResume,
  resetLine,
  sameLineText,
  setItemLines,
} from "@shared/resume-links";
import {
  NAVY_SERIF_CSS_VARS,
  NAVY_SERIF_STYLE,
} from "@shared/resume-style/navy-serif";
import type {
  ExperienceBullet,
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
} from "@shared/types";
import {
  type CSSProperties,
  Fragment,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { REWORDED_TINT_CLASS } from "./rewordTint";
import "./ResumeEditor.css";
import { ITEM_DEFINITIONS } from "@/client/components/design-resume/definitions";
import { RichTextEditor } from "@/client/components/design-resume/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BulletText, fitTextarea } from "./BulletText";
import { CommaListInput } from "./CommaListInput";
import {
  applySuggestions,
  BULLET_TRANSFER_TYPE,
  FOCUS_TRANSFER_TYPE,
  fieldVisible,
  readBulletTransfer,
  suggestionTarget,
} from "./editor";
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
/** Blocks that must not straddle a page break, in document order. */
const PAGE_BLOCKS = [
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
  for (const element of paper.querySelectorAll<HTMLElement>(
    "[data-page-push]",
  )) {
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
      const height =
        rect.height / scale + (block.matches(KEEP_WITH_NEXT) ? 16 : 0);
      const sheet = Math.floor(top / pitch);
      const end = sheet * pitch + SHEET - MARGIN_Y;
      if (height <= 0 || top + height <= end || height > SHEET - 2 * MARGIN_Y)
        break;
      const push = (sheet + 1) * pitch + MARGIN_Y - top;
      block.style.marginTop = `${Number.parseFloat(getComputedStyle(block).marginTop) + push}px`;
      block.setAttribute("data-page-push", "");
    }
  }
  let bottom = 0;
  for (const child of paper.children)
    if (!child.classList.contains("resume-sheet"))
      bottom = Math.max(
        bottom,
        (child.getBoundingClientRect().bottom - origin()) / scale,
      );
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

type Props = {
  library?: ExperienceBullet[];
  onSaveLineToLibrary?: (libraryId: string, text: string) => void;
  document: ReactiveResumeV5Document;
  onChange: (document: ReactiveResumeV5Document) => void;
  suggestions: ResumeSuggestion[];
  onDismiss: (ids: string[]) => void;
  disabled?: boolean;
  /** Margin "Ask AI" button: add this part of the resume to the chat focus. */
  onAskAi?: (ref: ResumeFocusRef) => void;
};
export function ResumeEditor({
  document,
  onChange,
  suggestions,
  onDismiss,
  disabled,
  onAskAi,
  library = [],
  onSaveLineToLibrary,
}: Props) {
  const [addingSummary, setAddingSummary] = useState(
    Boolean(bulletsFromHtml(document.summary.content).length),
  );
  const [addingHeadline, setAddingHeadline] = useState(
    Boolean(document.basics.headline),
  );
  const [newBullet, setNewBullet] = useState<{
    id: string;
    index: number;
  } | null>(null);
  const focusField = useRef<{ id: string; field: string } | null>(null);
  // Stable row keys: removing an empty bullet on blur (mousedown) must not let
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
    const keys = matched.map(
      (key) => key ?? previous.shift()?.key ?? nextBulletKey.current++,
    );
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
  const [libraryDrag, setLibraryDrag] = useState(false);
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
    const start = (event: DragEvent) => {
      setLibraryDrag(
        event.dataTransfer?.types.includes(BULLET_TRANSFER_TYPE) ?? false,
      );
    };
    const end = () => {
      setLibraryDrag(false);
      setDragOver(null);
    };
    // Bubble after the library's dragstart handler has populated dataTransfer.
    ownerDocument.addEventListener("dragstart", start);
    ownerDocument.addEventListener("dragend", end, true);
    ownerDocument.addEventListener("drop", end, true);
    return () => {
      ownerDocument.removeEventListener("dragstart", start);
      ownerDocument.removeEventListener("dragend", end, true);
      ownerDocument.removeEventListener("drop", end, true);
    };
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!canvas.current) return;
      setScale(
        Math.max(0.6, Math.min(1, canvas.current.clientWidth / (210 * MM))),
      );
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
    // Use stable data-focus-item refs rather than labels, which change as users type.
    const field = focusField.current;
    if (field) {
      const item = [
        ...page.current.querySelectorAll<HTMLElement>("[data-focus-item]"),
      ].find((element) => element.dataset.focusItem === field.id);
      item?.querySelector<HTMLElement>(field.field)?.focus();
      focusField.current = null;
    }
    const pending = focusAfterMove.current;
    if (!pending) return;
    focusAfterMove.current = null;
    const root = pending.scope
      ? [
          ...page.current.querySelectorAll<HTMLElement>("[data-focus-item]"),
        ].find((element) => element.dataset.focusItem === pending.scope)
      : page.current;
    const buttons = [...(root?.querySelectorAll("button") ?? [])];
    const find = (label: string) =>
      buttons.find((b) => b.getAttribute("aria-label") === label);
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
          s.op === "replace_field" &&
          s.field?.section === section &&
          s.field.itemId === itemId,
      ),
    );
  }
  function reorderZone(kind: "experience" | "skills", gap: number) {
    const type =
      kind === "experience" ? EXPERIENCE_TRANSFER_TYPE : SKILL_TRANSFER_TYPE;
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
              else
                next.sections.skills.items = moveItem(
                  next.sections.skills.items,
                  from,
                  gap,
                );
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
  function updateBullets(
    id: string,
    edit: (lines: ResumeLine[]) => ResumeLine[],
  ) {
    change((next) => {
      for (const section of [
        next.sections.experience,
        next.sections.projects,
      ]) {
        const index = section?.items.findIndex((item) => item.id === id) ?? -1;
        if (!section || index < 0) continue;
        const item = section.items[index];
        section.items[index] = setItemLines(
          item,
          edit(getItemLines(item)),
        ) as typeof item;
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
            const next = resetLine(
              currentDocument.current,
              itemId,
              index,
              library,
            );
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
  function lineAppearance(line: ResumeLine) {
    const original = library.find((item) => item.id === line.ref);
    return original && !sameLineText(line.text, original.text)
      ? { className: REWORDED_TINT_CLASS, title: original.text }
      : {};
  }
  // Index-only targets belong to the experience snapshot in which they arrived.
  const snapshots = useRef(
    new WeakMap<
      ResumeSuggestion,
      { description: string | undefined; stale: boolean }
    >(),
  );
  function target(suggestion: ResumeSuggestion) {
    if (
      suggestion.experienceId &&
      (suggestion.op === "insert_bullet" ||
        suggestion.previousText === undefined)
    ) {
      const description = document.sections.experience.items.find(
        (e) => e.id === suggestion.experienceId,
      )?.description;
      const snapshot = snapshots.current.get(suggestion);
      if (!snapshot)
        snapshots.current.set(suggestion, { description, stale: false });
      else {
        snapshot.stale ||= snapshot.description !== description;
        if (snapshot.stale) return null;
      }
    }
    return suggestionTarget(document, suggestion);
  }
  // Capture even suggestions whose target currently has no visible bullet row.
  for (const suggestion of suggestions) target(suggestion);
  function accept(items: ResumeSuggestion[]) {
    const result = applySuggestions(
      document,
      items.filter((item) => target(item) !== null),
    );
    if (result.applied.length) {
      onChange(result.document);
      onDismiss(result.applied);
    }
  }
  function suggestionList(items: ResumeSuggestion[]) {
    return items.map((s) => {
      const resolved = target(s);
      const label =
        s.op === "replace_field"
          ? `Change ${s.field?.name ?? "field"}`
          : {
              replace_bullet: "Rewrite bullet",
              insert_bullet: "Add bullet",
              delete_bullet: "Remove bullet",
              replace_summary: "Change summary",
              replace_headline: "Change headline",
              set_skills: "Update skills",
            }[s.op];
      return (
        <article key={s.id} className="resume-suggestion">
          <p className="font-medium">{label}</p>
          {resolved ? (
            <>
              <del className="resume-deletion">{resolved.old}</del>
              <mark className="resume-insertion">
                {s.op === "delete_bullet"
                  ? "Remove bullet"
                  : s.op === "set_skills"
                    ? s.skills
                        ?.map(
                          (skill) =>
                            `${skill.name}: ${skill.keywords.join(", ")}`,
                        )
                        .join("; ")
                    : s.text}
              </mark>
            </>
          ) : (
            <p className="text-muted-foreground">
              Not applicable — this content has changed.
            </p>
          )}
          <p className="text-xs text-muted-foreground">{s.reason}</p>
          <div className="resume-review">
            <Button
              size="sm"
              disabled={disabled || !resolved}
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
  function dropZone(id: string, index: number, mode: "insert" | "replace") {
    const key = `${id}-${index}-${mode}`;
    return {
      "data-active": dragOver === key,
      onDragLeave: () => setDragOver(null),
      onDragOver: (event: React.DragEvent) => {
        if (
          !disabled &&
          (event.dataTransfer.types.includes(BULLET_TRANSFER_TYPE) ||
            (mode === "insert" &&
              event.dataTransfer.types.includes(RESUME_BULLET_TRANSFER_TYPE)))
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
            RESUME_BULLET_TRANSFER_TYPE,
          )
            ? "move"
            : "copy";
          setDragOver(key);
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(null);
        if (disabled) return;
        if (
          mode === "insert" &&
          event.dataTransfer.types.includes(RESUME_BULLET_TRANSFER_TYPE)
        ) {
          try {
            const source = JSON.parse(
              event.dataTransfer.getData(RESUME_BULLET_TRANSFER_TYPE),
            );
            if (
              source &&
              typeof source.experienceId === "string" &&
              Number.isInteger(source.index)
            ) {
              const next = moveResumeBullet(
                currentDocument.current,
                source,
                id,
                index,
              );
              currentDocument.current = next;
              onChange(next);
            }
          } catch {
            /* Ignore malformed external drags. */
          }
          return;
        }
        const bullet = readBulletTransfer(
          event.dataTransfer.getData(BULLET_TRANSFER_TYPE),
        );
        if (!bullet) return;
        const original = library.find((item) => item.id === bullet.id);
        const expectedKind =
          currentDocument.current.sections.experience.items.some(
            (item) => item.id === id,
          )
            ? "bullet"
            : "project_point";
        const ref = original?.kind === expectedKind ? original.id : null;
        if (ref && isOnResume(currentDocument.current, ref)) return;
        updateBullets(id, (current) => [
          ...current.slice(0, index),
          { text: bullet.text, ref },
          ...current.slice(index + (mode === "replace" ? 1 : 0)),
        ]);
      },
    };
  }
  type SimpleSection = "education" | "certifications" | "awards";
  // A custom section title from the document wins; otherwise the standard ATS heading.
  const heading = (
    key: "summary" | "skills" | "experience" | "projects" | SimpleSection,
    name: string,
  ) =>
    (key === "summary"
      ? document.summary.title
      : document.sections[key].title
    )?.trim() || name;
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
          ? ["title", "date", "issuer", "website"]
          : ["title", "description", "awarder", "date"];
    function fieldInput(
      item: (typeof section.items)[number],
      index: number,
      field: string,
    ) {
      return field === "description" ? (
        <BulletText
          label={`${simpleNames[kind]} ${index + 1} ${field}`}
          readOnly={isLinked(item.libraryId)}
          value={bulletsFromHtml(String(item[field] ?? "")).join("\n")}
          onChange={(value) =>
            change((next) => {
              next.sections[kind].items[index][field] = introTextToHtml(value);
            })
          }
        />
      ) : (
        <Input
          title={`${simpleNames[kind]} ${index + 1} ${field}`}
          aria-label={`${simpleNames[kind]} ${index + 1} ${field}`}
          readOnly={isLinked(item.libraryId)}
          className={`resume-field-${field}`}
          value={
            field === "website"
              ? (item.website?.url ?? "")
              : String(item[field] ?? "")
          }
          placeholder={
            (
              {
                school: "School",
                period: "2020 – 2024",
                degree: "Degree",
                area: "Field of study",
                title: kind === "awards" ? "Award" : "Certification",
                date: "2024",
                issuer: "Issuing organization",
                website: "https://example.com",
                awarder: "Awarding organization",
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
      <section
        className={`resume-section resume-${kind}`}
        aria-label={simpleNames[kind]}
      >
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
                  data-area-shown={
                    kind === "education" && showArea(item.degree, item.area)
                  }
                >
                  {fields.map((field) => {
                    const input = fieldInput(item, index, field);
                    if (field === "area") return null;
                    if (field === "degree")
                      return (
                        <span key={field} className="resume-education-degree">
                          {input}
                          <span className="resume-education-in">in</span>
                          {fieldInput(item, index, "area")}
                        </span>
                      );
                    return (
                      <Fragment key={field}>
                        {kind === "certifications" && field === "date" && (
                          <span aria-hidden="true">-</span>
                        )}
                        {kind === "certifications" &&
                        field === "title" &&
                        safeUrl(item.website?.url) ? (
                          <span className="resume-certification-name">
                            <a href={safeUrl(item.website.url)}>
                              {String(item.title)}
                            </a>
                            {input}
                          </span>
                        ) : (
                          input
                        )}
                        {kind === "awards" && field === "title" && (
                          <span aria-hidden="true">:</span>
                        )}
                      </Fragment>
                    );
                  })}
                  <div className="resume-tools">
                    {askAi({
                      kind: "item",
                      section: kind,
                      itemId: item.id,
                      label: `${simpleNames[kind]} › ${String(item.school || item.title || index + 1)}`,
                    })}
                    {kind === "certifications" &&
                      safeUrl(item.website?.url) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`Edit Certifications ${index + 1} title`}
                          aria-label={`Edit Certifications ${index + 1} title`}
                          onClick={(event) =>
                            event.currentTarget
                              .closest(".resume-simple-item")
                              ?.querySelector<HTMLInputElement>(
                                ".resume-field-title",
                              )
                              ?.focus()
                          }
                        >
                          ✎
                        </Button>
                      )}
                    {(["up", "down"] as const).map((direction) => (
                      <Button
                        key={direction}
                        size="sm"
                        variant="ghost"
                        title={`Move ${simpleNames[kind]} ${index + 1} ${direction}`}
                        aria-label={`Move ${simpleNames[kind]} ${index + 1} ${direction}`}
                        disabled={
                          direction === "up"
                            ? index === 0
                            : index === section.items.length - 1
                        }
                        onClick={() => {
                          const target =
                            direction === "up" ? index - 1 : index + 1;
                          keepMoveFocus(
                            (d) =>
                              `Move ${simpleNames[kind]} ${target + 1} ${d}`,
                            direction,
                          );
                          change((next) => {
                            const items = next.sections[kind].items;
                            [items[index], items[target]] = [
                              items[target],
                              items[index],
                            ];
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
        <Button
          className="resume-add"
          size="sm"
          variant="ghost"
          onClick={() =>
            change((next) => {
              const base = {
                id: crypto.randomUUID(),
                hidden: false,
                website: { url: "", label: "" },
                description: "",
              };
              if (kind === "education")
                next.sections.education.items.push({
                  ...base,
                  school: "",
                  degree: "",
                  area: "",
                  grade: "",
                  location: "",
                  period: "",
                });
              else if (kind === "certifications")
                next.sections.certifications.items.push({
                  ...base,
                  title: "",
                  issuer: "",
                  date: "",
                });
              else
                next.sections.awards.items.push({
                  ...base,
                  title: "",
                  awarder: "",
                  date: "",
                });
            })
          }
        >
          + {simpleNames[kind]}
        </Button>
      </section>
    );
  }
  const sections = {
    summary: document.summary.hidden
      ? null
      : () =>
          addingSummary ||
          bulletsFromHtml(document.summary.content).length > 0 ? (
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
              {suggestionList(
                suggestions.filter((s) => s.op === "replace_summary"),
              )}
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
              {suggestionList(
                suggestions.filter((s) => s.op === "replace_summary"),
              )}
            </section>
          ),
    skills: document.sections.skills.hidden
      ? null
      : () =>
          document.sections.skills.items.some((s) => !s.hidden) ||
          suggestions.some((s) => s.op === "set_skills") ? (
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
                            title={`Skill ${index + 1} name`}
                            aria-label={`Skill ${index + 1} name`}
                            readOnly={isLinked(skill.libraryId)}
                            className="resume-skill-name"
                            value={skill.name}
                            onChange={(e) =>
                              change((next) => {
                                next.sections.skills.items[index].name =
                                  e.target.value;
                              })
                            }
                          />
                        </span>
                        :
                      </span>
                      <CommaListInput
                        multiline
                        className="resume-skill-keywords"
                        title={`Skill ${index + 1} keywords`}
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
                        {dragHandle(
                          SKILL_TRANSFER_TYPE,
                          skill.id,
                          `Drag skill ${index + 1}`,
                        )}
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
                            keepMoveFocus(
                              (d) => `Move skill ${index} ${d}`,
                              "up",
                            );
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
                          disabled={
                            index === document.sections.skills.items.length - 1
                          }
                          onClick={() => {
                            keepMoveFocus(
                              (d) => `Move skill ${index + 2} ${d}`,
                              "down",
                            );
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
              <Button
                className="resume-add"
                size="sm"
                variant="outline"
                onClick={() =>
                  change((next) => {
                    next.sections.skills.items.push({
                      id: crypto.randomUUID(),
                      hidden: false,
                      icon: "",
                      name: "",
                      keywords: [],
                      level: 0,
                      proficiency: "",
                    });
                  })
                }
              >
                Add skill
              </Button>
              {suggestionList(suggestions.filter((s) => s.op === "set_skills"))}
            </section>
          ) : (
            <section className="resume-section">
              {sectionTools("skills")}
              <Button
                className="resume-add"
                size="sm"
                variant="outline"
                onClick={() =>
                  change((next) => {
                    next.sections.skills.items.push({
                      id: crypto.randomUUID(),
                      hidden: false,
                      icon: "",
                      name: "",
                      keywords: [],
                      level: 0,
                      proficiency: "",
                    });
                  })
                }
              >
                Add skill
              </Button>
            </section>
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
                if (newBullet?.id === experience.id) {
                  lines.splice(newBullet.index, 0, { text: "", ref: null });
                }
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
                      title={`${name} position`}
                      aria-label={`${name} position`}
                      data-experience-position
                      readOnly={isLinked(experience.libraryId)}
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
                      {(["company", "location", "period"] as const).map(
                        (field) => {
                          const placeholder =
                            field === "period"
                              ? "Jan 2023 – Present"
                              : field === "company"
                                ? "Company"
                                : "Location";
                          return (
                            <Fragment key={field}>
                              {field === "location" && (
                                <span aria-hidden="true">-</span>
                              )}
                              <Input
                                title={`${name} ${field === "period" ? "dates" : field}`}
                                aria-label={`${name} ${field === "period" ? "dates" : field}`}
                                readOnly={isLinked(experience.libraryId)}
                                value={experience[field] ?? ""}
                                placeholder={placeholder}
                                // Width fallback where CSS field-sizing is unsupported (Firefox, Safari).
                                size={Math.max(
                                  (experience[field] || placeholder).length,
                                  1,
                                )}
                                onChange={(event) =>
                                  change((next) => {
                                    const item =
                                      next.sections.experience.items.find(
                                        (entry) => entry.id === experience.id,
                                      );
                                    if (item) item[field] = event.target.value;
                                  })
                                }
                              />
                            </Fragment>
                          );
                        },
                      )}
                    </div>
                    <div className="resume-tools resume-entry-controls">
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
                        disabled={
                          document.sections.experience.items.indexOf(
                            experience,
                          ) === 0
                        }
                        onClick={() => {
                          keepMoveFocus(
                            (d) => `Move experience ${name} ${d}`,
                            "up",
                            experience.id,
                          );
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
                          document.sections.experience.items.indexOf(
                            experience,
                          ) ===
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
                      <Button
                        title={`Add bullet to ${name}`}
                        aria-label="Add bullet"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setNewBullet({
                            id: experience.id,
                            index: lines.length,
                          });
                          focusField.current = {
                            id: experience.id,
                            field: `[data-focus-bullet="${lines.length}"] textarea`,
                          };
                        }}
                      >
                        Add bullet
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
                            {...dropZone(experience.id, index, "insert")}
                            className="resume-gap"
                            title={`Insert before bullet ${index + 1}`}
                          >
                            <span className="sr-only">Drop to insert</span>
                          </div>
                          <div
                            {...dropZone(experience.id, index, "replace")}
                            className="space-y-1"
                          >
                            <BulletText
                              label={`${name} bullet ${index + 1}`}
                              value={line.text}
                              linked={isLinked(line.ref)}
                              onChange={(value) => {
                                if (!value.trim() && isLinked(line.ref)) return;
                                if (newBullet?.id === experience.id) {
                                  if (!value.trim()) {
                                    setNewBullet(null);
                                    return;
                                  }
                                  const gap = newBullet.index;
                                  setNewBullet(null);
                                  updateBullets(experience.id, (current) => {
                                    current.splice(gap, 0, {
                                      text: "",
                                      ref: null,
                                    });
                                    return current
                                      .map((text, i) =>
                                        i === index
                                          ? { ...text, text: value }
                                          : text,
                                      )
                                      .filter((line) => line.text.trim());
                                  });
                                } else
                                  updateBullets(experience.id, (current) =>
                                    current
                                      .map((text, i) =>
                                        i === index
                                          ? { ...text, text: value }
                                          : text,
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
                                size="sm"
                                variant="ghost"
                                title={`Insert new bullet before bullet ${index + 1}`}
                                aria-label={`Insert before bullet ${index + 1}`}
                                onClick={() => {
                                  setNewBullet({ id: experience.id, index });
                                  focusField.current = {
                                    id: experience.id,
                                    field: `[data-focus-bullet="${index}"] textarea`,
                                  };
                                }}
                              >
                                +
                              </Button>
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
                                s.experienceId === experience.id &&
                                target(s)?.index === index,
                            ),
                          )}
                        </li>
                      ))}
                    </ul>
                    <div
                      {...dropZone(experience.id, lines.length, "insert")}
                      className="resume-gap resume-append"
                      data-empty={lines.length === 0}
                    >
                      <span>Drop to append a duty</span>
                    </div>
                    {suggestionList(
                      suggestions.filter(
                        (s) =>
                          s.experienceId === experience.id &&
                          (!target(s) || target(s)?.index === lines.length),
                      ),
                    )}
                  </section>
                );
              })}
            {reorderZone(
              "experience",
              document.sections.experience.items.length,
            )}
            <Button
              className="resume-add-experience"
              size="sm"
              variant="ghost"
              onClick={() => {
                const item = ITEM_DEFINITIONS.find(
                  (definition) => definition.key === "experience",
                )?.createItem() as ReactiveResumeV5Document["sections"]["experience"]["items"][number];
                focusField.current = {
                  id: item.id,
                  field: "[data-experience-position]",
                };
                change((next) => next.sections.experience.items.push(item));
              }}
            >
              Add experience
            </Button>
          </section>
        )
      : null,
    projects:
      !document.sections.projects.hidden &&
      document.sections.projects.items.length
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
                    {project.hidden && (
                      <p
                        className="text-muted-foreground resume-readonly"
                        title="Edit in Resume Studio"
                      >
                        <label>
                          <input
                            type="checkbox"
                            title={`Include project ${project.name}`}
                            aria-label={`Include project ${project.name}`}
                            checked={!project.hidden}
                            onChange={(e) =>
                              change((next) => {
                                next.sections.projects.items[index].hidden =
                                  !e.target.checked;
                              })
                            }
                          />
                        </label>{" "}
                        {project.name}
                      </p>
                    )}
                    {!project.hidden && (
                      <>
                        <div
                          className="resume-experience-heading resume-readonly"
                          title="Edit in Resume Studio"
                        >
                          <h3
                            {...focusDrag({
                              kind: "item",
                              section: "projects",
                              itemId: project.id,
                              label: `Projects › ${project.name}`,
                            })}
                          >
                            <a href={safeUrl(project.website?.url)}>
                              {project.name}
                            </a>
                          </h3>
                          <span>{project.period}</span>
                        </div>
                        <div className="resume-tools">
                          {askAi({
                            kind: "item",
                            section: "projects",
                            itemId: project.id,
                            label: `Projects › ${project.name}`,
                          })}
                          <label>
                            <input
                              type="checkbox"
                              title={`Include project ${project.name}`}
                              aria-label={`Include project ${project.name}`}
                              checked={!project.hidden}
                              onChange={(e) =>
                                isLinked(project.libraryId) && !e.target.checked
                                  ? removeLinked(project.libraryId)
                                  : change((next) => {
                                      next.sections.projects.items[
                                        index
                                      ].hidden = !e.target.checked;
                                    })
                              }
                            />
                          </label>
                        </div>
                        {bulletsFromHtml(
                          splitDescription(project.description ?? "").introHtml,
                        ).join("\n") && (
                          <p
                            className="resume-readonly"
                            title="Edit in Resume Studio"
                          >
                            {bulletsFromHtml(
                              splitDescription(project.description).introHtml,
                            ).join("\n")}
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
                                  if (!text.trim() && isLinked(line.ref))
                                    return;
                                  updateBullets(project.id, (lines) =>
                                    lines
                                      .map((old, at) =>
                                        at === i ? { ...old, text } : old,
                                      )
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
                      </>
                    )}
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
    (key): key is SectionKey =>
      key in sections && sections[key as SectionKey] !== null,
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
          if (
            !disabled &&
            event.dataTransfer.types.includes(SECTION_TRANSFER_TYPE)
          ) {
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
            const moved = JSON.parse(
              event.dataTransfer.getData(SECTION_TRANSFER_TYPE),
            );
            if (typeof moved === "string" && moved in sections)
              moveTo(moved, before);
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
        {dragHandle(
          SECTION_TRANSFER_TYPE,
          key,
          `Drag section ${sectionNames[key]}`,
        )}
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
            keepMoveFocus(
              (d) => `Move section ${sectionNames[key]} ${d}`,
              "up",
            );
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
            keepMoveFocus(
              (d) => `Move section ${sectionNames[key]} ${d}`,
              "down",
            );
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
            <div
              className="resume-row resume-section-slot"
              data-focus-section={key}
            >
              {sections[key]?.()}
            </div>
          </Fragment>
        ))}
        {sectionGap(null)}
      </>
    );
  }
  return (
    <div
      className="resume-canvas"
      ref={canvas}
      data-library-drag={libraryDrag && !disabled}
    >
      <p className="resume-editor-hint">
        Click a line to show its tools. Drag ⠿ to reorder or drop it into the
        chat.
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
            if ((event.target as Element).closest(".resume-tools button"))
              event.preventDefault();
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
              <Button size="sm" onClick={() => accept(suggestions)}>
                Accept all
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
            <div
              className="resume-contact resume-readonly"
              title="Edit in Resume Studio"
            >
              {document.basics.phone && (
                <span>Tel: {document.basics.phone}</span>
              )}
              {document.basics.email && (
                <span>
                  Email:{" "}
                  <a href={`mailto:${document.basics.email}`}>
                    {document.basics.email}
                  </a>
                </span>
              )}
              {document.basics.location && (
                <span>{document.basics.location}</span>
              )}
              {safeUrl(document.basics.website?.url) && (
                <span>
                  <a href={safeUrl(document.basics.website.url)}>
                    {document.basics.website.label || "Website"}
                  </a>
                </span>
              )}
              {!document.sections.profiles?.hidden &&
                document.sections.profiles?.items
                  .filter((p) => !p.hidden && safeUrl(p.website?.url))
                  .map((profile) => (
                    <span key={profile.id}>
                      <a href={safeUrl(profile.website.url)}>
                        {bareUrl(profile.website.url)}
                      </a>
                    </span>
                  ))}
            </div>
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
                <div className="resume-tools">
                  {askAi({ kind: "headline", label: "Headline" })}
                </div>
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
            {suggestionList(
              suggestions.filter((s) => s.op === "replace_headline"),
            )}
          </header>
          {sectionList()}
          {suggestionList(
            suggestions.filter(
              (s) =>
                (s.op === "replace_summary" && document.summary.hidden) ||
                (s.op === "set_skills" && document.sections.skills.hidden) ||
                (s.op === "replace_field" && !fieldVisible(document, s)) ||
                (["replace_bullet", "insert_bullet", "delete_bullet"].includes(
                  s.op,
                ) &&
                  (document.sections.experience.hidden ||
                    !document.sections.experience.items.some(
                      (e) => e.id === s.experienceId && !e.hidden,
                    ))),
            ),
          )}
        </fieldset>
      </div>
    </div>
  );
}
