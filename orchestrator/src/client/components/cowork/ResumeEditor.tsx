import { bulletsFromHtml, bulletsToHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import { useEffect, useRef, useState } from "react";
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
  const canvas = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLFieldSetElement>(null);
  const [geometry, setGeometry] = useState({ scale: 1, height: 1123 });
  const [dragOver, setDragOver] = useState<string | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!canvas.current || !page.current) return;
      setGeometry({
        scale: Math.min(1, canvas.current.clientWidth / ((210 * 96) / 25.4)),
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
      <button
        type="button"
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
      </button>
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
      if (experience)
        experience.description = bulletsToHtml(
          edit(bulletsFromHtml(experience.description)),
        );
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
  return (
    <div className="resume-canvas" ref={canvas}>
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
            <label htmlFor="cowork-headline" className="sr-only">
              Headline
            </label>
            <Input
              id="cowork-headline"
              className="resume-headline"
              value={document.basics.headline}
              onChange={(e) =>
                change((next) => {
                  next.basics.headline = e.target.value;
                })
              }
            />
            <p className="resume-contact">
              {[
                document.basics.email,
                document.basics.phone,
                document.basics.location,
                document.basics.website?.url,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {suggestionList(
              suggestions.filter((s) => s.op === "replace_headline"),
            )}
          </header>
          <section className="space-y-2">
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
                onChange={(value) =>
                  change((next) => {
                    next.summary.content = value;
                  })
                }
              />
            </div>
            {suggestionList(
              suggestions.filter((s) => s.op === "replace_summary"),
            )}
          </section>
          <section className="space-y-4">
            <h2 className="text-sm font-semibold">Experience</h2>
            {document.sections.experience.items
              .filter((e) => !e.hidden)
              .map((experience) => {
                const bullets = bulletsFromHtml(experience.description);
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
                    <div className="resume-experience-heading">
                      <h3>
                        {experience.position}
                        {experience.position && experience.company ? " · " : ""}
                        {experience.company}
                      </h3>
                      <span>{experience.period}</span>
                    </div>
                    {experience.location && (
                      <p className="resume-location">{experience.location}</p>
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
            {reorderZone(
              "experience",
              document.sections.experience.items.length,
            )}
          </section>
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
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Skills</h2>
            {document.sections.skills.items.map((skill, index) => (
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
            ))}
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
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Projects</h2>
            {document.sections.projects.items.map((project, index) => (
              <label key={project.id} className="resume-project resume-row">
                <input
                  type="checkbox"
                  checked={!project.hidden}
                  onChange={(e) =>
                    change((next) => {
                      next.sections.projects.items[index].hidden =
                        !e.target.checked;
                    })
                  }
                />
                {project.name}
              </label>
            ))}
          </section>
        </fieldset>
      </div>
    </div>
  );
}
