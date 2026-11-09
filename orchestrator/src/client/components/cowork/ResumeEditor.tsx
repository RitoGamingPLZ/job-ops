import { bulletsFromHtml, bulletsToHtml } from "@shared/resume-bullets";
import type { ReactiveResumeV5Document, ResumeSuggestion } from "@shared/types";
import { useRef } from "react";
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
        <article
          key={s.id}
          className="border rounded-md p-3 space-y-2 text-sm bg-muted/30"
        >
          <p className="font-medium">{s.op.replaceAll("_", " ")}</p>
          {resolved ? (
            <>
              <del className="block text-muted-foreground">{resolved.old}</del>
              <mark className="block bg-emerald-500/10 text-foreground">
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
          <div className="flex gap-2">
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
    return {
      onDragOver: (event: React.DragEvent) => {
        if (event.dataTransfer.types.includes(BULLET_TRANSFER_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const bullet = readBulletTransfer(
          event.dataTransfer.getData(BULLET_TRANSFER_TYPE),
        );
        if (bullet && !disabled)
          updateBullets(id, (current) =>
            dropBullet(current, index, bullet.text, mode),
          );
      },
    };
  }
  return (
    <fieldset disabled={disabled} className="space-y-6 min-w-0">
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
      <section className="space-y-2">
        <label htmlFor="cowork-headline" className="text-sm font-semibold">
          Headline
        </label>
        <Input
          id="cowork-headline"
          value={document.basics.headline}
          onChange={(e) =>
            change((next) => {
              next.basics.headline = e.target.value;
            })
          }
        />
        {suggestionList(suggestions.filter((s) => s.op === "replace_headline"))}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Summary</h2>
        <div
          ref={(element) => {
            element?.toggleAttribute("inert", Boolean(disabled));
          }}
        >
          <RichTextEditor
            value={document.summary.content}
            onChange={(value) =>
              change((next) => {
                next.summary.content = value;
              })
            }
          />
        </div>
        {suggestionList(suggestions.filter((s) => s.op === "replace_summary"))}
      </section>
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Experience</h2>
        {document.sections.experience.items
          .filter((e) => !e.hidden)
          .map((experience) => {
            const bullets = bulletsFromHtml(experience.description);
            return (
              <section key={experience.id} className="space-y-2 border-t pt-4">
                <h3 className="text-sm font-medium">
                  {experience.company} · {experience.position}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {experience.period}
                </p>
                {bullets.map((bullet, index) => (
                  <div key={`${experience.id}-${index}`}>
                    <div
                      {...dropZone(experience.id, index, "insert")}
                      className="h-4 border-t border-dashed text-[10px] text-muted-foreground"
                      title={`Insert before bullet ${index + 1}`}
                    >
                      Drop to insert
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
                      <div className="flex gap-1">
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
                          Delete bullet
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
                  </div>
                ))}
                <div
                  {...dropZone(experience.id, bullets.length, "insert")}
                  className="border border-dashed p-2 text-xs text-muted-foreground"
                >
                  Drop to append a duty
                </div>
                <Button
                  size="sm"
                  variant="outline"
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
          <div key={skill.id} className="flex gap-2">
            <Input
              aria-label={`Skill ${index + 1} name`}
              value={skill.name}
              onChange={(e) =>
                change((next) => {
                  next.sections.skills.items[index].name = e.target.value;
                })
              }
            />
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
        <Button
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
          <label key={project.id} className="flex gap-2 text-sm">
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
  );
}
