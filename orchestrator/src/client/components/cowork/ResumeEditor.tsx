import {
  bulletsFromHtml,
  introTextToHtml,
  joinDescription,
  splitDescription,
} from "@shared/resume-bullets";
import type {
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
} from "@shared/types";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import "./ResumeEditor.css";
import { RichTextEditor } from "@/client/components/design-resume/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BulletText } from "./BulletText";
import { CommaListInput } from "./CommaListInput";
import {
  applySuggestions,
  BULLET_TRANSFER_TYPE,
  dropBullet,
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
const MARGIN_Y = 12 * MM;
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

type Props = {
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
}: Props) {
  const [addingSummary, setAddingSummary] = useState(
    Boolean(bulletsFromHtml(document.summary.content).length),
  );
  const [addingHeadline, setAddingHeadline] = useState(
    Boolean(document.basics.headline),
  );
  const canvas = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLFieldSetElement>(null);
  const [scale, setScale] = useState(1);
  const [sheets, setSheets] = useState(1);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [libraryDrag, setLibraryDrag] = useState(false);
  // Typing in local-draft inputs and :focus-within reveals change layout
  // without a React render; bump this so pagination re-runs.
  const [, repaginate] = useReducer((n: number) => n + 1, 0);
  // Section Move buttons: React may move the focused node (losing focus) or
  // disable it at the ends, so refocus after the reorder renders.
  const focusAfterMove = useRef<{ label: string; fallback: string } | null>(
    null,
  );
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
    const pending = focusAfterMove.current;
    if (!pending) return;
    focusAfterMove.current = null;
    const buttons = [...page.current.querySelectorAll("button")];
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
        tabIndex={0}
        className="resume-drag resume-ask"
        aria-label={`Ask AI about ${ref.label}`}
        title="Ask AI (or drag into the chat)"
        {...focusDrag(ref)}
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
    const next = structuredClone(document);
    edit(next);
    onChange(next);
  }
  function updateBullets(id: string, edit: (bullets: string[]) => string[]) {
    change((next) => {
      const experience = next.sections.experience.items.find(
        (e) => e.id === id,
      );
      if (experience) {
        const { introHtml, bullets } = splitDescription(experience.description);
        experience.description = joinDescription(
          introHtml,
          edit(bullets),
          experience.description,
        );
      }
    });
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
      return (
        <article key={s.id} className="resume-suggestion">
          <p className="font-medium">
            {s.op === "replace_field"
              ? `replace ${s.field?.name ?? "field"}`
              : s.op.replaceAll("_", " ")}
          </p>
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
              onClick={() => accept([s])}
            >
              Accept
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDismiss([s.id])}>
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
            )
              onChange(moveResumeBullet(document, source, id, index));
          } catch {
            /* Ignore malformed external drags. */
          }
          return;
        }
        const bullet = readBulletTransfer(
          event.dataTransfer.getData(BULLET_TRANSFER_TYPE),
        );
        if (bullet)
          updateBullets(id, (current) =>
            dropBullet(current, index, bullet.text, mode),
          );
      },
    };
  }
  type SimpleSection = "education" | "certifications" | "awards";
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
          value={bulletsFromHtml(String(item[field] ?? "")).join("\n")}
          onChange={(value) =>
            change((next) => {
              next.sections[kind].items[index][field] = introTextToHtml(value);
            })
          }
        />
      ) : (
        <Input
          aria-label={`${simpleNames[kind]} ${index + 1} ${field}`}
          className={`resume-field-${field}`}
          value={
            field === "website"
              ? (item.website?.url ?? "")
              : String(item[field] ?? "")
          }
          placeholder={field}
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
    return (
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
            {simpleNames[kind]}
          </h2>
        )}
        <div className="resume-simple-items">
          {section?.items.map(
            (item, index) =>
              !item.hidden && (
                <div
                  className="resume-row resume-simple-item"
                  key={item.id}
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
                  <div className="resume-margin">
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
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${simpleNames[kind]} ${index + 1}`}
                      onClick={() =>
                        change((next) => {
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
    summary:
      !document.summary.hidden &&
      (addingSummary ||
        bulletsFromHtml(document.summary.content).length > 0) ? (
        <section className="resume-section" aria-label="Summary">
          <h2
            className="text-sm font-semibold"
            {...focusDrag({ kind: "summary", label: "Summary" })}
          >
            Summary
          </h2>
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
      ) : document.summary.hidden ? null : (
        <section className="resume-section resume-empty-summary">
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
    skills: document.sections.skills
      .hidden ? null : document.sections.skills.items.some((s) => !s.hidden) ||
      suggestions.some((s) => s.op === "set_skills") ? (
      <section className="resume-section" aria-label="Skills">
        <h2
          className="text-sm font-semibold"
          {...focusDrag({ kind: "section", section: "skills", label: "Skills" })}
        >
          Skills
        </h2>
        {document.sections.skills.items.map(
          (skill, index) =>
            !skill.hidden && (
              <div key={skill.id} className="resume-row resume-skill">
                {reorderZone("skills", index)}
                <div className="resume-margin resume-skill-controls">
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
                    aria-label={`Move skill ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() =>
                      change((next) => {
                        next.sections.skills.items = moveItem(
                          next.sections.skills.items,
                          index,
                          index - 1,
                        );
                      })
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move skill ${index + 1} down`}
                    disabled={
                      index === document.sections.skills.items.length - 1
                    }
                    onClick={() =>
                      change((next) => {
                        next.sections.skills.items = moveItem(
                          next.sections.skills.items,
                          index,
                          index + 2,
                        );
                      })
                    }
                  >
                    ↓
                  </Button>
                </div>
                <Input
                  aria-label={`Skill ${index + 1} name`}
                  className="resume-skill-name"
                  value={skill.name}
                  onChange={(e) =>
                    change((next) => {
                      next.sections.skills.items[index].name = e.target.value;
                    })
                  }
                />
                <CommaListInput
                  multiline
                  className="resume-skill-keywords"
                  aria-label={`Skill ${index + 1} keywords`}
                  value={skill.keywords}
                  onCommit={(keywords) =>
                    change((next) => {
                      next.sections.skills.items[index].keywords = keywords;
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="resume-skill-delete"
                  aria-label={`Delete skill ${skill.name}`}
                  onClick={() =>
                    change((next) => {
                      next.sections.skills.items.splice(index, 1);
                    })
                  }
                >
                  Delete
                </Button>
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
    experience:
      !document.sections.experience.hidden &&
      document.sections.experience.items.some((e) => !e.hidden) ? (
        <section className="resume-section" aria-label="Experiences">
          <h2
            className="text-sm font-semibold"
            {...focusDrag({
              kind: "section",
              section: "experience",
              label: "Experiences",
            })}
          >
            Experiences
          </h2>
          {document.sections.experience.items
            .filter((e) => !e.hidden)
            .map((experience) => {
              const { introHtml, bullets } = splitDescription(
                experience.description,
              );
              const itemRef: ResumeFocusRef = {
                kind: "item",
                section: "experience",
                itemId: experience.id,
                label: `Experience › ${experience.company}${experience.position ? ` — ${experience.position}` : ""}`,
              };
              return (
                <section
                  key={experience.id}
                  className="resume-experience resume-row"
                >
                  {reorderZone(
                    "experience",
                    document.sections.experience.items.indexOf(experience),
                  )}
                  <div className="resume-margin resume-entry-controls">
                    {dragHandle(
                      EXPERIENCE_TRANSFER_TYPE,
                      experience.id,
                      `Drag experience ${experience.company}`,
                    )}
                    {askAi(itemRef)}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move experience ${experience.company} up`}
                      disabled={
                        document.sections.experience.items.indexOf(
                          experience,
                        ) === 0
                      }
                      onClick={() =>
                        change((next) => {
                          const i = next.sections.experience.items.findIndex(
                            (e) => e.id === experience.id,
                          );
                          next.sections.experience.items = moveItem(
                            next.sections.experience.items,
                            i,
                            i - 1,
                          );
                        })
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move experience ${experience.company} down`}
                      disabled={
                        document.sections.experience.items.indexOf(
                          experience,
                        ) ===
                        document.sections.experience.items.length - 1
                      }
                      onClick={() =>
                        change((next) => {
                          const i = next.sections.experience.items.findIndex(
                            (e) => e.id === experience.id,
                          );
                          next.sections.experience.items = moveItem(
                            next.sections.experience.items,
                            i,
                            i + 2,
                          );
                        })
                      }
                    >
                      ↓
                    </Button>
                  </div>
                  {experience.position && (
                    <p className="resume-position">{experience.position}</p>
                  )}
                  <div className="resume-experience-heading">
                    <h3 {...focusDrag(itemRef)}>
                      {experience.company}
                      {experience.location ? ` - ${experience.location}` : ""}
                    </h3>
                    <span>{experience.period}</span>
                  </div>
                  {fieldSuggestions("experience", experience.id)}
                  {bulletsFromHtml(introHtml).length > 0 && (
                    <BulletText
                      label={`${experience.company} intro`}
                      value={bulletsFromHtml(introHtml).join("\n")}
                      onChange={(value) =>
                        change((next) => {
                          const item = next.sections.experience.items.find(
                            (e) => e.id === experience.id,
                          );
                          if (item)
                            item.description = joinDescription(
                              introTextToHtml(value),
                              bullets,
                            );
                        })
                      }
                    />
                  )}
                  <ul className="resume-bullets">
                    {bullets.map((bullet, index) => (
                      <li
                        key={`${experience.id}-${index}`}
                        className="resume-row resume-bullet"
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
                            label={`${experience.company} bullet ${index + 1}`}
                            value={bullet}
                            onChange={(value) =>
                              updateBullets(experience.id, (current) =>
                                current.map((text, i) =>
                                  i === index ? value : text,
                                ),
                              )
                            }
                          />
                          <div className="resume-margin resume-bullet-controls">
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
                              label: `${experience.company} › bullet ${index + 1}`,
                            })}
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Insert before bullet ${index + 1}`}
                              onClick={() =>
                                updateBullets(experience.id, (current) =>
                                  dropBullet(
                                    current,
                                    index,
                                    "New bullet",
                                    "insert",
                                  ),
                                )
                              }
                            >
                              +
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={index === 0}
                              aria-label={`Move bullet ${index + 1} up`}
                              onClick={() =>
                                updateBullets(experience.id, (current) => {
                                  [current[index - 1], current[index]] = [
                                    current[index],
                                    current[index - 1],
                                  ];
                                  return current;
                                })
                              }
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={index === bullets.length - 1}
                              aria-label={`Move bullet ${index + 1} down`}
                              onClick={() =>
                                updateBullets(experience.id, (current) => {
                                  [current[index + 1], current[index]] = [
                                    current[index],
                                    current[index + 1],
                                  ];
                                  return current;
                                })
                              }
                            >
                              ↓
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Delete bullet ${index + 1}`}
                              onClick={() =>
                                updateBullets(experience.id, (current) =>
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
                    {...dropZone(experience.id, bullets.length, "insert")}
                    className="resume-gap resume-append"
                    data-empty={bullets.length === 0}
                  >
                    <span>Drop to append a duty</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="resume-add"
                    onClick={() =>
                      updateBullets(experience.id, (current) => [
                        ...current,
                        "New bullet",
                      ])
                    }
                  >
                    Add bullet
                  </Button>
                  {suggestionList(
                    suggestions.filter(
                      (s) =>
                        s.experienceId === experience.id &&
                        (!target(s) || target(s)?.index === bullets.length),
                    ),
                  )}
                </section>
              );
            })}
          {reorderZone("experience", document.sections.experience.items.length)}
        </section>
      ) : null,
    projects:
      !document.sections.projects.hidden &&
      document.sections.projects.items.length ? (
        <section className="resume-section" aria-label="Projects">
          {document.sections.projects.items.some((p) => !p.hidden) && (
            <h2
              {...focusDrag({
                kind: "section",
                section: "projects",
                label: "Projects",
              })}
            >
              Projects
            </h2>
          )}
          {document.sections.projects.items.map((project, index) => (
            <div key={project.id} className="resume-project resume-row">
              <div className="resume-margin">
                {!project.hidden &&
                  askAi({
                    kind: "item",
                    section: "projects",
                    itemId: project.id,
                    label: `Projects › ${project.name}`,
                  })}
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Include project ${project.name}`}
                    checked={!project.hidden}
                    onChange={(e) =>
                      change((next) => {
                        next.sections.projects.items[index].hidden =
                          !e.target.checked;
                      })
                    }
                  />
                </label>
              </div>
              {project.hidden && (
                <p className="text-muted-foreground">{project.name}</p>
              )}
              {!project.hidden && (
                <>
                  <div className="resume-experience-heading">
                    <h3
                      {...focusDrag({
                        kind: "item",
                        section: "projects",
                        itemId: project.id,
                        label: `Projects › ${project.name}`,
                      })}
                    >
                      <a href={safeUrl(project.website?.url)}>{project.name}</a>
                    </h3>
                    <span>{project.period}</span>
                  </div>
                  {bulletsFromHtml(
                    splitDescription(project.description ?? "").introHtml,
                  ).join("\n") && (
                    <p>
                      {bulletsFromHtml(
                        splitDescription(project.description).introHtml,
                      ).join("\n")}
                    </p>
                  )}
                  <ul className="resume-bullets">
                    {splitDescription(project.description ?? "").bullets.map(
                      (text, i) => (
                        <li key={`${project.id}-${i}`}>{text}</li>
                      ),
                    )}
                  </ul>
                  {fieldSuggestions("projects", project.id)}
                </>
              )}
            </div>
          ))}
        </section>
      ) : null,
    education: simpleSection("education"),
    awards: simpleSection("awards"),
  };
  type SectionKey = keyof typeof sections;
  const sectionNames: Record<SectionKey, string> = {
    summary: "Summary",
    skills: "Skills",
    certifications: "Certifications",
    experience: "Experiences",
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
  function sectionList() {
    const keys = order;
    return (
      <>
        {keys.map((key, i) => (
          <Fragment key={key}>
            {sectionGap(key)}
            <div className="resume-row resume-section-slot">
              <div className="resume-margin resume-section-controls">
                {dragHandle(
                  SECTION_TRANSFER_TYPE,
                  key,
                  `Drag section ${sectionNames[key]}`,
                )}
                {askAi(
                  key === "summary"
                    ? { kind: "summary", label: "Summary" }
                    : { kind: "section", section: key, label: sectionNames[key] },
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move section ${sectionNames[key]} up`}
                  disabled={i === 0}
                  onClick={() => {
                    focusAfterMove.current = {
                      label: `Move section ${sectionNames[key]} up`,
                      fallback: `Move section ${sectionNames[key]} down`,
                    };
                    moveTo(key, keys[i - 1]);
                  }}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move section ${sectionNames[key]} down`}
                  disabled={i === keys.length - 1}
                  onClick={() => {
                    focusAfterMove.current = {
                      label: `Move section ${sectionNames[key]} down`,
                      fallback: `Move section ${sectionNames[key]} up`,
                    };
                    moveTo(key, keys[i + 2] ?? null);
                  }}
                >
                  ↓
                </Button>
              </div>
              {sections[key]}
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
          style={{
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
            <div className="resume-contact">
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
                        {profile.network ||
                          profile.website.label ||
                          profile.username}
                      </a>
                    </span>
                  ))}
            </div>
            {addingHeadline || document.basics.headline ? (
              <div className="resume-row">
                <div className="resume-margin">
                  {askAi({ kind: "headline", label: "Headline" })}
                </div>
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
