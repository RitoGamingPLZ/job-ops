import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import type {
  ExperienceBullet,
  ExperienceBulletInput,
  RankedBullet,
} from "@shared/types";
import { useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";
import { Textarea } from "@/components/ui/textarea";

export function coworkError(error: unknown) {
  if (error instanceof ApiClientError && error.status === 501)
    toast.message("Co-work is not available yet.");
  else showErrorToast(error, "Could not complete resume action");
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
