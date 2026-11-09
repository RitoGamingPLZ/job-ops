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
import { Textarea } from "@/components/ui/textarea";
import { CommaListInput } from "./CommaListInput";
import { BULLET_TRANSFER_TYPE, type BulletReference } from "./editor";

export function coworkError(error: unknown) {
  if (error instanceof ApiClientError && error.status === 501)
    toast.message("not available yet");
  else showErrorToast(error, "Could not complete resume action");
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
  const filtered = bullets
    .filter(
      (b) =>
        (!company || b.company === company) &&
        (!tag || b.tags.includes(tag)) &&
        `${b.text} ${b.company ?? ""} ${b.role ?? ""} ${b.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      ranked.length
        ? (scores.get(b.id)?.score ?? -1) - (scores.get(a.id)?.score ?? -1)
        : `${a.company}${a.role}`.localeCompare(`${b.company}${b.role}`),
    );
  const groups = new Map<string, ExperienceBullet[]>();
  for (const bullet of filtered) {
    const key = `${bullet.company ?? "Independent"} / ${bullet.role ?? "General"}`;
    groups.set(key, [...(groups.get(key) ?? []), bullet]);
  }
  const companies = [
    ...new Set(
      bullets.map((b) => b.company).filter((c): c is string => Boolean(c)),
    ),
  ].sort();
  const tags = [...new Set(bullets.flatMap((b) => b.tags))].sort();
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
              const result = await api.importExperienceBulletsFromResume();
              await refresh();
              toast.success(
                `Imported ${result.created}; skipped ${result.skipped}`,
              );
            })
          }
        >
          Import from resume
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
            Import your resume or add a duty to build your library.
          </p>
        )
      )}
      {[...groups].map(([group, items]) => (
        <section key={group} className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            {group}
          </h3>
          {items.map((bullet) => (
            <article
              key={bullet.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  BULLET_TRANSFER_TYPE,
                  JSON.stringify({ id: bullet.id, text: bullet.text }),
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="rounded-md border p-3 text-sm space-y-2"
            >
              <p>{bullet.text}</p>
              <p className="text-xs text-muted-foreground">
                {[bullet.startDate, bullet.endDate].filter(Boolean).join(" – ")}{" "}
                {bullet.tags.join(" · ")}
              </p>
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
                        <DropdownMenuItem onSelect={() => onReference(bullet)}>
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
        </section>
      ))}
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
