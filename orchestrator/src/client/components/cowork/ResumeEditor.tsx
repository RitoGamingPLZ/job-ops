import { bulletsFromHtml, bulletsToHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import { Fragment, useEffect, useRef, useState } from "react";
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
  readBulletTransfer,
  suggestionTarget,
} from "./editor";
import {
  EXPERIENCE_TRANSFER_TYPE,
  moveItem,
  moveResumeBullet,
  RESUME_BULLET_TRANSFER_TYPE,
  SKILL_TRANSFER_TYPE,
} from "./resumeReorder";

// Keep the bullet-only shared helpers unchanged; descriptions also carry prose.
function descriptionParts(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const hasList = Boolean(parsed.querySelector("li"));
  const bullets = hasList ? bulletsFromHtml(html) : [];
  for (const list of parsed.querySelectorAll("ul, ol")) list.remove();
  return { intro: bulletsFromHtml(parsed.body.innerHTML).join("\n"), bullets };
}
function descriptionHtml(intro: string, bullets: string[]) {
  const escaped = intro.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
  return `${intro ? `<p>${escaped}</p>` : ""}${bulletsToHtml(bullets)}`;
}
function bulletDocument(document: ReactiveResumeV5Document) {
  const next = structuredClone(document);
  for (const item of next.sections.experience.items)
    item.description = bulletsToHtml(
      descriptionParts(item.description).bullets,
    );
  return next;
}
function restoreDescriptions(
  original: ReactiveResumeV5Document,
  edited: ReactiveResumeV5Document,
) {
  for (const item of edited.sections.experience.items) {
    const previous = original.sections.experience.items.find(
      (e) => e.id === item.id,
    );
    if (!previous) continue;
    const { intro, bullets } = descriptionParts(previous.description);
    item.description =
      item.description === bulletsToHtml(bullets)
        ? previous.description
        : descriptionHtml(intro, bulletsFromHtml(item.description));
  }
  return edited;
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
};
export function ResumeEditor({
  document,
  onChange,
  suggestions,
  onDismiss,
  disabled,
}: Props) {
  const [addingSummary, setAddingSummary] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLFieldSetElement>(null);
  const [geometry, setGeometry] = useState({ scale: 1, height: 1123 });
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [libraryDrag, setLibraryDrag] = useState(false);
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
      if (!canvas.current || !page.current) return;
      setGeometry({
        scale: Math.max(
          0.6,
          Math.min(1, canvas.current.clientWidth / ((210 * 96) / 25.4)),
        ),
        height: page.current.offsetHeight,
      });
    };
    const observer = new ResizeObserver(measure);
    if (canvas.current) observer.observe(canvas.current);
    if (page.current) observer.observe(page.current);
    measure();
    return () => observer.disconnect();
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
        const { intro, bullets } = descriptionParts(experience.description);
        experience.description = descriptionHtml(intro, edit(bullets));
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
    return suggestionTarget(bulletDocument(document), suggestion);
  }
  // Capture even suggestions whose target currently has no visible bullet row.
  for (const suggestion of suggestions) target(suggestion);
  function accept(items: ResumeSuggestion[]) {
    const result = applySuggestions(
      bulletDocument(document),
      items.filter((item) => target(item) !== null),
    );
    if (result.applied.length) {
      onChange(restoreDescriptions(document, result.document));
      onDismiss(result.applied);
    }
  }
  function suggestionList(items: ResumeSuggestion[]) {
    return items.map((s) => {
      const resolved = target(s);
      return (
        <article key={s.id} className="resume-suggestion">
          <p className="font-medium">{s.op.replaceAll("_", " ")}</p>
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
              onChange(
                restoreDescriptions(
                  document,
                  moveResumeBullet(bulletDocument(document), source, id, index),
                ),
              );
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
    return (
      <section
        className={`resume-section resume-${kind}`}
        aria-label={simpleNames[kind]}
      >
        {section?.items.some((item) => !item.hidden) && (
          <h2>{simpleNames[kind]}</h2>
        )}
        <div className="resume-simple-items">
          {section?.items.map(
            (item, index) =>
              !item.hidden && (
                <div className="resume-row resume-simple-item" key={item.id}>
                  {fields.map((field) => {
                    const input =
                      field === "description" ? (
                        <BulletText
                          label={`${simpleNames[kind]} ${index + 1} ${field}`}
                          value={bulletsFromHtml(
                            String(item[field] ?? ""),
                          ).join("\n")}
                          onChange={(value) =>
                            change((next) => {
                              next.sections[kind].items[index][field] =
                                descriptionHtml(value, []);
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
                              else
                                next.sections[kind].items[index][field] =
                                  event.target.value;
                            })
                          }
                        />
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
    skills: document.sections.skills
      .hidden ? null : document.sections.skills.items.some((s) => !s.hidden) ||
      suggestions.some((s) => s.op === "set_skills") ? (
      <section className="resume-section" aria-label="Skills">
        <h2 className="text-sm font-semibold">Skills</h2>
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
                  value={skill.name}
                  onChange={(e) =>
                    change((next) => {
                      next.sections.skills.items[index].name = e.target.value;
                    })
                  }
                />
                <span aria-hidden="true">:</span>
                <CommaListInput
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
          <h2 className="text-sm font-semibold">Experiences</h2>
          {document.sections.experience.items
            .filter((e) => !e.hidden)
            .map((experience) => {
              const { intro, bullets } = descriptionParts(
                experience.description,
              );
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
                    <h3>
                      {experience.company}
                      {experience.location ? ` - ${experience.location}` : ""}
                    </h3>
                    <span>{experience.period}</span>
                  </div>
                  {intro && (
                    <BulletText
                      label={`${experience.company} intro`}
                      value={intro}
                      onChange={(value) =>
                        change((next) => {
                          const item = next.sections.experience.items.find(
                            (e) => e.id === experience.id,
                          );
                          if (item)
                            item.description = descriptionHtml(value, bullets);
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
            <h2>Projects</h2>
          )}
          {document.sections.projects.items.map((project, index) => (
            <div key={project.id} className="resume-project resume-row">
              <label className="resume-margin">
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
              {!project.hidden && (
                <>
                  <div className="resume-experience-heading">
                    <h3>
                      <a href={safeUrl(project.website?.url)}>{project.name}</a>
                    </h3>
                    <span>{project.period}</span>
                  </div>
                  {descriptionParts(project.description ?? "").intro && (
                    <p>{descriptionParts(project.description).intro}</p>
                  )}
                  <ul className="resume-bullets">
                    {descriptionParts(project.description ?? "").bullets.map(
                      (text, i) => (
                        <li key={`${project.id}-${i}`}>{text}</li>
                      ),
                    )}
                  </ul>
                </>
              )}
            </div>
          ))}
        </section>
      ) : null,
    education: simpleSection("education"),
    awards: simpleSection("awards"),
  };
  const defaults = [
    "skills",
    "certifications",
    "experience",
    "projects",
    "education",
    "awards",
  ] as const;
  const configured =
    document.metadata?.layout?.pages?.flatMap((p) => [
      ...p.main,
      ...p.sidebar,
    ]) ?? [];
  const sectionOrder = [...new Set([...configured, ...defaults])].filter(
    (key): key is keyof typeof sections => key in sections,
  );
  return (
    <div
      className="resume-canvas"
      ref={canvas}
      data-library-drag={libraryDrag && !disabled}
    >
      <div
        className="resume-paper-frame"
        style={{
          width: `${((210 * 96) / 25.4) * geometry.scale}px`,
          height: `${geometry.height * geometry.scale}px`,
        }}
      >
        <fieldset
          ref={page}
          disabled={disabled}
          className="resume-paper"
          style={{ transform: `scale(${geometry.scale})` }}
        >
          {Array.from(
            {
              length: Math.max(
                0,
                Math.ceil((geometry.height - 1) / ((297 * 96) / 25.4)) - 1,
              ),
            },
            (_, index) => (
              <div
                key={`page-${index + 2}`}
                className="resume-page-guide"
                style={{ top: `${(index + 1) * 297}mm` }}
                aria-hidden="true"
              >
                <span>Page {index + 2}</span>
              </div>
            ),
          )}
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
            {document.basics.headline?.trim() && (
              <Input
                aria-label="Headline"
                className="resume-headline"
                value={document.basics.headline}
                onChange={(e) =>
                  change((next) => {
                    next.basics.headline = e.target.value;
                  })
                }
              />
            )}
            {suggestionList(
              suggestions.filter((s) => s.op === "replace_headline"),
            )}
          </header>
          {!document.summary.hidden &&
          (addingSummary ||
            bulletsFromHtml(document.summary.content).length > 0) ? (
            <section className="resume-section" aria-label="Summary">
              <h2 className="text-sm font-semibold">Summary</h2>
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
                    if (bulletsFromHtml(value).length) setAddingSummary(false);
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
          )}
          {sectionOrder.map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
          {suggestionList(
            suggestions.filter(
              (s) =>
                ["replace_bullet", "insert_bullet", "delete_bullet"].includes(
                  s.op,
                ) &&
                !document.sections.experience.items.some(
                  (e) => e.id === s.experienceId && !e.hidden,
                ),
            ),
          )}
        </fieldset>
      </div>
    </div>
  );
}
