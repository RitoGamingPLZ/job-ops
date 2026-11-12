import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import type {
  ExperienceBullet,
  ExperienceBulletInput,
  RankedBullet,
} from "@shared/types";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";
import { Textarea } from "@/components/ui/textarea";

export function coworkError(error: unknown) {
  if (error instanceof ApiClientError && error.status === 501)
    toast.message("Co-work is not available yet.");
  else showErrorToast(error, "Could not complete resume action");
}

const tagClass =
  "shrink-0 whitespace-nowrap rounded border px-1 py-0.5 text-xs text-muted-foreground";

/** Read-only tag chips that collapse to the available width. */
export function InlineTags({ bullet }: { bullet: ExperienceBullet }) {
  const [visibleCount, setVisibleCount] = useState(8);
  const tagsRow = useRef<HTMLDivElement>(null);
  const tagChips = useRef<(HTMLSpanElement | null)[]>([]);
  const overflowMeasure = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = tagsRow.current;
    if (!row) return;
    function measure() {
      if (!row || !row.clientWidth) return;
      const gap = 4;
      const available = row.clientWidth;
      const widths = bullet.tags.map(
        (_, index) => tagChips.current[index]?.offsetWidth ?? 0,
      );
      const allWidth = widths.reduce((sum, width) => sum + width + gap, 0);
      const limit =
        allWidth <= available && bullet.tags.length <= 8
          ? available
          : available - (overflowMeasure.current?.offsetWidth ?? 0) - gap;
      let used = 0;
      let count = 0;
      for (const width of widths.slice(0, 8)) {
        if (used + width + gap > limit) break;
        used += width + gap;
        count++;
      }
      setVisibleCount(count);
    }
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [bullet.tags]);
  return (
    <div
      ref={tagsRow}
      className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap"
    >
      {bullet.tags.map((tag, index) => (
        <span
          key={`${index}-${tag}`}
          ref={(node) => {
            tagChips.current[index] = node;
          }}
          className={`${tagClass} ${index >= visibleCount ? "invisible absolute" : ""}`}
          aria-hidden={index >= visibleCount ? true : undefined}
        >
          {tag}
        </span>
      ))}
      <span
        ref={overflowMeasure}
        aria-hidden="true"
        className="invisible absolute text-xs"
      >
        +{bullet.tags.length}
      </span>
      {bullet.tags.length > visibleCount && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground"
              aria-label={`Show ${bullet.tags.length - visibleCount} more tags for ${bullet.text}`}
            >
              +{bullet.tags.length - visibleCount}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="flex max-h-60 flex-wrap gap-1 overflow-auto p-2"
          >
            {bullet.tags.slice(visibleCount).map((tag, index) => (
              <span
                key={`${index}-${tag}`}
                className={`${tagClass} max-w-full truncate`}
                title={tag}
              >
                {tag}
              </span>
            ))}
          </PopoverContent>
        </Popover>
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
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
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
            className="h-7 px-2 text-xs"
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
