import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import type {
  ExperienceBullet,
  ExperienceBulletInput,
  RankedBullet,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";
import { Textarea } from "@/components/ui/textarea";
import { CommaListInput } from "./CommaListInput";
import { BULLET_TRANSFER_TYPE, type BulletReference } from "./editor";

export function coworkError(error: unknown) {
  if (error instanceof ApiClientError && error.status === 501)
    toast.message("Co-work is not available yet.");
  else showErrorToast(error, "Could not complete resume action");
}

/** Count each skill once per bullet, preserving the first spelling for display. */
export function summarizeSkills(bullets: ExperienceBullet[]) {
  const skills = new Map<string, { tag: string; count: number }>();
  for (const bullet of bullets) {
    const seen = new Set<string>();
    for (const raw of bullet.tags) {
      const tag = raw.trim();
      const key = tag.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const skill = skills.get(key);
      if (skill) skill.count += 1;
      else skills.set(key, { tag, count: 1 });
    }
  }
  return [...skills.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

export function groupBulletsByJob(bullets: ExperienceBullet[]) {
  const groups = new Map<
    string,
    {
      key: string;
      company: string;
      role: string;
      dates: string;
      startDate: string;
      endDate: string;
      other: boolean;
      bullets: ExperienceBullet[];
    }
  >();
  for (const bullet of bullets) {
    const fields = [
      bullet.company,
      bullet.role,
      bullet.startDate,
      bullet.endDate,
    ].map((value) => value?.trim() || null);
    const key = JSON.stringify(fields);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        company: fields[0] ?? "Other",
        role: fields[1] ?? "Other",
        dates: fields.slice(2).filter(Boolean).join(" – "),
        startDate: fields[2] ?? "",
        endDate:
          !fields[3] || fields[3].toLowerCase() === "present"
            ? "\uffff"
            : fields[3],
        other: !fields[0] || !fields[1],
        bullets: [],
      };
      groups.set(key, group);
    }
    group.bullets.push(bullet);
  }
  for (const group of groups.values()) {
    group.bullets.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.other) - Number(b.other) ||
      b.endDate.localeCompare(a.endDate) ||
      b.startDate.localeCompare(a.startDate) ||
      a.company.localeCompare(b.company) ||
      a.role.localeCompare(b.role) ||
      a.key.localeCompare(b.key),
  );
}

export function InlineTags({
  bullet,
  busy,
  onSave,
}: {
  bullet: ExperienceBullet;
  busy: boolean;
  onSave: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(showAll ? bullet.tags : bullet.tags.slice(0, 8)).map((tag, index) => (
          <button
            key={`${index}-${tag}`}
            type="button"
            disabled={busy}
            className="rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label={`Remove ${tag} from ${bullet.text}`}
            onClick={() => onSave(bullet.tags.filter((value) => value !== tag))}
          >
            {tag} <span aria-hidden="true">×</span>
          </button>
        ))}
        {bullet.tags.length > 8 && (
          <button
            type="button"
            className="text-xs text-muted-foreground"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Show less" : `+${bullet.tags.length - 8}`}
          </button>
        )}
        {!adding && (
          <button
            type="button"
            disabled={busy}
            className="text-xs text-muted-foreground"
            onClick={() => setAdding(true)}
          >
            + tag
          </button>
        )}
      </div>
      {adding && (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const seen = new Set(
              bullet.tags.map((value) => value.trim().toLowerCase()),
            );
            const added = draft
              .split(",")
              .map((value) => value.trim())
              .filter((value) => {
                const key = value.toLowerCase();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
              });
            if (added.length) onSave([...bullet.tags, ...added]);
            setDraft("");
            setAdding(false);
          }}
        >
          <Input
            className="h-7 min-w-0 text-xs"
            placeholder="Add skill…"
            aria-label={`Add skill to ${bullet.text}`}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy || !draft.trim()}
          >
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

type Props = {
  jobId?: string;
  targets?: { id: string; label: string }[];
  onInsert?: (bullet: BulletReference, experienceId: string) => void;
  onReference?: (bullet: BulletReference) => void;
};
export function DutyLibrary({
  jobId,
  targets = [],
  onInsert,
  onReference,
}: Props) {
  const [bullets, setBullets] = useState<ExperienceBullet[]>([]);
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [tag, setTag] = useState("");
  const [ranked, setRanked] = useState<RankedBullet[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsResume, setNeedsResume] = useState(false);
  const [edit, setEdit] = useState<ExperienceBulletInput | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [drafts, setDrafts] = useState<
    { input: ExperienceBulletInput; selected: boolean }[]
  >([]);
  const refresh = useCallback(async () => {
    const result = await api.listExperienceBullets();
    setBullets(result.bullets);
    setRanked([]);
  }, []);
  useEffect(() => {
    let active = true;
    api
      .listExperienceBullets()
      .then((result) => {
        if (active) setBullets(result.bullets);
      })
      .catch(coworkError)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409)
        setNeedsResume(true);
      else coworkError(error);
    } finally {
      setBusy(false);
    }
  }
  const scores = new Map(ranked.map((item) => [item.bulletId, item]));
  const filtered = bullets.filter(
    (b) =>
      (!company || b.company === company) &&
      (!tag ||
        b.tags.some(
          (value) => value.trim().toLowerCase() === tag.toLowerCase(),
        )) &&
      `${b.text} ${b.company ?? ""} ${b.role ?? ""} ${b.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const groups = groupBulletsByJob(filtered);
  if (ranked.length) {
    for (const group of groups) {
      group.bullets.sort(
        (a, b) =>
          (scores.get(b.id)?.score ?? -1) - (scores.get(a.id)?.score ?? -1),
      );
    }
  }
  const allGroups = new Map(
    groupBulletsByJob(bullets).map((group) => [group.key, group]),
  );
  const skills = summarizeSkills(bullets);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const unlabeled = bullets.filter((bullet) => bullet.tags.length === 0).length;
  const companies = [
    ...new Set(
      bullets.map((b) => b.company).filter((c): c is string => Boolean(c)),
    ),
  ].sort();
  const tags = skills.map((skill) => skill.tag).sort();
  return (
    <div className="space-y-4">
      {needsResume && (
        <p className="text-sm">
          Import or create a resume first.{" "}
          <Link className="underline" to="/design-resume">
            Open Resume Studio
          </Link>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            setEditId(null);
            setEdit({ text: "", company: "", role: "", tags: [] });
          }}
        >
          Add duty
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api.syncCandidateLibrary();
              await refresh();
              toast.success(
                `Synced ${result.created}; skipped ${result.skipped}; linked ${result.linked}`,
              );
            })
          }
        >
          Sync from resumes
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setPasteOpen(true);
            setDrafts([]);
          }}
        >
          Paste & extract
        </Button>
        {jobId && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setRanked((await api.rankExperienceBullets(jobId)).ranked);
              })
            }
          >
            Rank for this job
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Used by AI scoring, tailoring and chat
      </p>
      <section aria-label="Skills" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">Skills</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading || !unlabeled}
            onClick={() =>
              void run(async () => {
                try {
                  const result = await api.labelExperienceBullets();
                  const updated = new Map(
                    result.bullets.map((bullet) => [bullet.id, bullet]),
                  );
                  setBullets((current) =>
                    current.map((bullet) => updated.get(bullet.id) ?? bullet),
                  );
                  setRanked([]);
                  if (result.labeled === 0) toast.message("Nothing to label");
                  else
                    toast.success(
                      `Labeled ${result.labeled} ${result.labeled === 1 ? "duty" : "duties"}`,
                    );
                } catch (error) {
                  if (
                    error instanceof ApiClientError &&
                    (error.status === 404 || error.status === 501)
                  )
                    toast.message("AI labeling is not available yet.");
                  else throw error;
                }
              })
            }
          >
            Label with AI ({unlabeled} unlabeled)
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(showAllSkills ? skills : skills.slice(0, 8)).map((skill) => (
            <button
              key={skill.tag}
              type="button"
              aria-pressed={tag.toLowerCase() === skill.tag.toLowerCase()}
              className="rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              onClick={() =>
                setTag(
                  tag.toLowerCase() === skill.tag.toLowerCase()
                    ? ""
                    : skill.tag,
                )
              }
            >
              {skill.tag} <span className="tabular-nums">({skill.count})</span>
            </button>
          ))}
          {skills.length > 8 && (
            <button
              type="button"
              className="text-xs text-muted-foreground"
              onClick={() => setShowAllSkills(!showAllSkills)}
            >
              {showAllSkills ? "Show less" : `+${skills.length - 8}`}
            </button>
          )}
          {!skills.length && (
            <p className="text-xs text-muted-foreground">
              Add skills or label duties with AI.
            </p>
          )}
        </div>
      </section>
      <Input
        aria-label="Search duties"
        placeholder="Search duties…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              {company || "All companies"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setCompany("")}>
              All companies
            </DropdownMenuItem>
            {companies.map((c) => (
              <DropdownMenuItem key={c} onSelect={() => setCompany(c)}>
                {c}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              {tag || "All tags"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setTag("")}>
              All tags
            </DropdownMenuItem>
            {tags.map((t) => (
              <DropdownMenuItem key={t} onSelect={() => setTag(t)}>
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {loading ? (
        <output>Loading duties…</output>
      ) : (
        !filtered.length && (
          <p className="text-sm text-muted-foreground">
            {bullets.length
              ? "No duties match these filters."
              : "Import your resume or add a duty to build your library."}
          </p>
        )
      )}
      {groups.map((group) => {
        const groupSkills = summarizeSkills(
          allGroups.get(group.key)?.bullets ?? group.bullets,
        );
        return (
          <details key={group.key} open className="group border-t pt-2">
            <summary className="cursor-pointer text-sm font-medium">
              <span>
                {group.company} → {group.role}
              </span>
              {group.dates && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {group.dates}
                </span>
              )}
              <span className="ml-2 text-xs text-muted-foreground">
                ({group.bullets.length})
              </span>
            </summary>
            <div className="mt-1 flex flex-wrap gap-1 pl-4">
              {groupSkills.slice(0, 8).map((skill) => (
                <span
                  key={skill.tag}
                  className="rounded bg-muted px-2 py-1 text-xs font-normal text-muted-foreground"
                >
                  {skill.tag} ({skill.count})
                </span>
              ))}
              {groupSkills.length > 8 && (
                <span className="text-xs text-muted-foreground">
                  +{groupSkills.length - 8}
                </span>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {group.bullets.map((bullet) => (
                <article
                  key={bullet.id}
                  className="rounded-md border p-3 text-sm space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Drag duty: ${bullet.text}`}
                      className="cursor-grab text-muted-foreground"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          BULLET_TRANSFER_TYPE,
                          JSON.stringify({ id: bullet.id, text: bullet.text }),
                        );
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      ⋮⋮
                    </button>
                    <p>{bullet.text}</p>
                  </div>
                  <InlineTags
                    bullet={bullet}
                    busy={busy}
                    onSave={(tags) =>
                      void run(async () => {
                        const result = await api.updateExperienceBullet(
                          bullet.id,
                          { tags },
                        );
                        setBullets((current) =>
                          current.map((item) =>
                            item.id === result.bullet.id ? result.bullet : item,
                          ),
                        );
                        setRanked([]);
                      })
                    }
                  />
                  {scores.has(bullet.id) && (
                    <p className="text-xs">
                      <strong>{scores.get(bullet.id)?.score}/100</strong> ·{" "}
                      {scores.get(bullet.id)?.reason}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {onInsert && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            Insert into…
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {targets.map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              onSelect={() => onInsert(bullet, t.id)}
                            >
                              {t.label}
                            </DropdownMenuItem>
                          ))}
                          {onReference && (
                            <DropdownMenuItem
                              onSelect={() => onReference(bullet)}
                            >
                              Chat reference
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditId(bullet.id);
                        setEdit({
                          text: bullet.text,
                          company: bullet.company,
                          role: bullet.role,
                          startDate: bullet.startDate,
                          endDate: bullet.endDate,
                          tags: bullet.tags,
                        });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDeleteId(bullet.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </details>
        );
      })}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete duty?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the duty from your library. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleteId;
                if (id)
                  void run(async () => {
                    await api.deleteExperienceBullet(id);
                    await refresh();
                  });
              }}
            >
              Delete duty
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={edit !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit duty" : "Add duty"}</DialogTitle>
          </DialogHeader>
          {edit && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (editId) await api.updateExperienceBullet(editId, edit);
                  else await api.createExperienceBullet(edit);
                  await refresh();
                  setEdit(null);
                });
              }}
            >
              <label htmlFor="duty-text" className="block text-sm">
                Duty
                <Textarea
                  id="duty-text"
                  required
                  value={edit.text}
                  onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                />
              </label>
              {(["company", "role", "startDate", "endDate"] as const).map(
                (key) => (
                  <label
                    key={key}
                    htmlFor={`duty-${key}`}
                    className="block text-sm"
                  >
                    {
                      {
                        company: "Company",
                        role: "Role",
                        startDate: "Start date",
                        endDate: "End date",
                      }[key]
                    }
                    <Input
                      id={`duty-${key}`}
                      value={edit[key] ?? ""}
                      onChange={(e) =>
                        setEdit({ ...edit, [key]: e.target.value })
                      }
                    />
                  </label>
                ),
              )}
              <label htmlFor="duty-tags" className="block text-sm">
                Tags (comma separated)
                <CommaListInput
                  id="duty-tags"
                  value={edit.tags ?? []}
                  onCommit={(tags) =>
                    setEdit({
                      ...edit,
                      tags,
                    })
                  }
                />
              </label>
              <Button type="submit" disabled={busy || !edit.text.trim()}>
                Save duty
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={pasteOpen}
        onOpenChange={(open) => {
          if (!busy) setPasteOpen(open);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Paste & extract duties</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label="Text to extract"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste experience notes…"
          />
          <Button
            disabled={busy || !paste.trim()}
            onClick={() =>
              void run(async () => {
                setDrafts(
                  (await api.extractExperienceBullets(paste)).drafts.map(
                    (input) => ({ input, selected: true }),
                  ),
                );
              })
            }
          >
            Extract drafts
          </Button>
          {drafts.map((draft, index) => (
            <label
              key={`${index}-${draft.input.text}`}
              className="flex gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={draft.selected}
                onChange={(e) =>
                  setDrafts((current) =>
                    current.map((d, i) =>
                      i === index ? { ...d, selected: e.target.checked } : d,
                    ),
                  )
                }
              />
              {draft.input.text}
            </label>
          ))}
          {drafts.length > 0 && (
            <Button
              disabled={busy || !drafts.some((d) => d.selected)}
              onClick={() =>
                void run(async () => {
                  for (const draft of drafts.filter((d) => d.selected)) {
                    await api.createExperienceBullet({
                      ...draft.input,
                      source: "ai_extract",
                    });
                    setDrafts((current) => current.filter((d) => d !== draft));
                  }
                  await refresh();
                  setPasteOpen(false);
                  toast.success("Duties added");
                })
              }
            >
              Create selected duties
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Duty-specific tools shared with the candidate library checklist. */
export function DutyLibraryTools({
  jobId,
  roles,
  onRefresh,
  onRanked,
}: {
  jobId?: string;
  roles: ExperienceBullet[];
  onRefresh: () => Promise<void>;
  onRanked: (ranked: RankedBullet[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<
    { input: ExperienceBulletInput; selected: boolean }[]
  >([]);
  const [parentId, setParentId] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      coworkError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setParentId(roles[0]?.id ?? "");
            setDrafts([]);
            setOpen(true);
          }}
        >
          Paste & extract
        </Button>
        {jobId && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onRanked((await api.rankExperienceBullets(jobId)).ranked);
              })
            }
          >
            Rank for this job
          </Button>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Paste & extract duties</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label="Text to extract"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            disabled={busy || !text.trim()}
            onClick={() =>
              void run(async () => {
                setDrafts(
                  (await api.extractExperienceBullets(text)).drafts.map(
                    (input) => ({ input, selected: true }),
                  ),
                );
              })
            }
          >
            Extract drafts
          </Button>
          {drafts.map((draft, index) => (
            <label
              key={`${index}-${draft.input.text}`}
              className="flex gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={draft.selected}
                onChange={(e) =>
                  setDrafts((current) =>
                    current.map((d, i) =>
                      i === index ? { ...d, selected: e.target.checked } : d,
                    ),
                  )
                }
              />
              {draft.input.text}
            </label>
          ))}
          {drafts.length > 0 && (
            <>
              <SearchableDropdown
                ariaLabel="Add to role"
                placeholder="Choose a role"
                value={parentId}
                onValueChange={setParentId}
                disabled={busy}
                allowCustomValue={false}
                options={roles.map((role) => ({
                  value: role.id,
                  label: `${String(role.data?.company ?? "")} · ${role.text}`,
                }))}
              />
              {!roles.length && (
                <p className="text-sm">
                  Add a job and role before adding extracted duties.
                </p>
              )}
              <Button
                disabled={busy || !parentId || !drafts.some((d) => d.selected)}
                onClick={() =>
                  void run(async () => {
                    for (const draft of drafts.filter((d) => d.selected)) {
                      await api.createExperienceBullet({
                        ...draft.input,
                        kind: "bullet",
                        parentId,
                        source: "ai_extract",
                      });
                      setDrafts((current) =>
                        current.filter((d) => d !== draft),
                      );
                    }
                    await onRefresh();
                    setOpen(false);
                    toast.success("Duties added");
                  })
                }
              >
                Create selected duties
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
