import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import type {
  Job,
  ReactiveResumeV5Document,
  RequirementStatus,
  ResumeFocusRef,
  ScreeningReport,
  ScreeningRequirement,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { coworkError } from "./DutyLibrary";
import { BULLET_TRANSFER_TYPE, type BulletReference } from "./editor";

type Checked = {
  report: ScreeningReport;
  checkedAt: Date;
  // JSON of the document that was checked, so a remount can tell if it changed.
  document: string;
};
// Last report per job, kept for the session only (the server does not persist it).
const reports = new Map<string, Checked>();
// Jobs already checked once this session (success or not).
const autoChecked = new Set<string>();
export function clearScreeningCache() {
  reports.clear();
  autoChecked.clear();
}

const STATUS: Record<RequirementStatus, { label: string; tone: string }> = {
  met: { label: "Met", tone: "bg-success/15 text-success" },
  partial: { label: "Partial", tone: "bg-warning/15 text-warning" },
  in_library: { label: "In your library", tone: "bg-info/15 text-info" },
  missing: { label: "Missing", tone: "bg-destructive/15 text-destructive" },
};

/** Find the editor element for a focus ref: bullet → item → section. */
export function findFocusTarget(root: ParentNode, ref: ResumeFocusRef) {
  if (ref.kind === "headline") return root.querySelector(".resume-headline");
  const item = ref.itemId
    ? root.querySelector(`[data-focus-item=${JSON.stringify(ref.itemId)}]`)
    : null;
  const bullet =
    item && ref.bulletIndex != null
      ? item.querySelector(`[data-focus-bullet="${ref.bulletIndex}"]`)
      : null;
  const section = ref.kind === "summary" ? "summary" : ref.section;
  return (
    bullet ??
    item ??
    (section ? root.querySelector(`[data-focus-section=${JSON.stringify(section)}]`) : null)
  );
}

/** Scroll the editor to a focus ref and flash it. Returns false if not found. */
export function focusResumePart(root: ParentNode, ref: ResumeFocusRef) {
  const target = findFocusTarget(root, ref);
  if (!(target instanceof HTMLElement)) return false;
  target.scrollIntoView?.({ behavior: "smooth", block: "center" });
  target.classList.remove("resume-focus-flash");
  void target.offsetWidth; // restart the animation on repeat clicks
  target.classList.add("resume-focus-flash");
  setTimeout(() => target.classList.remove("resume-focus-flash"), 1600);
  return true;
}

function askAiPrompt(requirement: ScreeningRequirement) {
  const gap = requirement.status === "partial" ? "only partly shows this" : "does not show this";
  return [
    `The job requires: "${requirement.text}". My resume ${gap}.`,
    requirement.tip,
    "Suggest truthful edits to my resume that address it.",
  ]
    .filter(Boolean)
    .join(" ");
}

type Props = {
  job: Job;
  active: boolean;
  getDocument: () => ReactiveResumeV5Document;
  targets: { id: string; label: string }[];
  onInsert: (bullet: BulletReference, experienceId: string) => void;
  onAskAi: (prompt: string) => void;
  onFocusRef: (ref: ResumeFocusRef) => void;
};
export function JobMatchPanel({
  job,
  active,
  getDocument,
  targets,
  onInsert,
  onAskAi,
  onFocusRef,
}: Props) {
  const [checked, setChecked] = useState<Checked | null>(() => reports.get(job.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [gapsOnly, setGapsOnly] = useState(false);
  const [library, setLibrary] = useState<Map<string, string> | null>(null);

  const check = useCallback(async () => {
    autoChecked.add(job.id);
    setLoading(true);
    try {
      const document = getDocument();
      const fingerprint = JSON.stringify(document);
      const report = await api.getScreeningReport(job.id, document);
      const next = { report, checkedAt: new Date(), document: fingerprint };
      reports.set(job.id, next);
      setChecked(next);
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 404 || error.status === 501))
        toast.message("Job match is not available yet.");
      else coworkError(error);
    } finally {
      setLoading(false);
    }
  }, [job.id, getDocument]);

  useEffect(() => {
    // Auto-run at most once per job per page session; then wait for a click.
    if (active && !checked && !autoChecked.has(job.id)) void check();
  }, [active, checked, check, job.id]);

  const needsLibrary = Boolean(checked?.report.requirements.some((r) => r.libraryBulletIds.length));
  useEffect(() => {
    if (!needsLibrary || library) return;
    api
      .listExperienceBullets()
      .then(({ bullets }) => setLibrary(new Map(bullets.map((b) => [b.id, b.text]))))
      .catch(() => setLibrary(new Map()));
  }, [needsLibrary, library]);

  const report = checked?.report;
  const score = report ? Math.max(0, Math.min(100, Math.round(report.score))) : 0;
  const scoreTone =
    score >= 70
      ? "border-success text-success"
      : score >= 40
        ? "border-warning text-warning"
        : "border-destructive text-destructive";

  function requirementRow(r: ScreeningRequirement) {
    const status = STATUS[r.status];
    const duties = r.libraryBulletIds
      .map((id) => ({ id, text: library?.get(id) }))
      .filter((b): b is BulletReference => Boolean(b.text));
    return (
      <li key={r.id} className="rounded-md border p-2 text-sm space-y-1">
        <div className="flex items-start gap-2">
          <p className="mr-auto">{r.text}</p>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${status.tone}`}>
            {status.label}
          </span>
        </div>
        {r.evidence.map((e, i) =>
          e.focus ? (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: evidence has no id
              key={i}
              type="button"
              className="block w-full text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
              title={`Show in resume: ${e.focus.label}`}
              onClick={() => e.focus && onFocusRef(e.focus)}
            >
              ↳ {e.text}
            </button>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: evidence has no id
            <p key={i} className="text-xs text-muted-foreground">
              ↳ {e.text}
            </p>
          ),
        )}
        {r.tip && <p className="text-xs italic">{r.tip}</p>}
        {r.status === "in_library" &&
          duties.map((bullet) => (
            <div
              key={bullet.id}
              className="flex items-start gap-2 rounded bg-muted/50 p-1.5 text-xs"
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Drag duty: ${bullet.text}`}
                className="cursor-grab text-muted-foreground"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(BULLET_TRANSFER_TYPE, JSON.stringify(bullet));
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                ⋮⋮
              </button>
              <p className="mr-auto">{bullet.text}</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6">
                    Insert into…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {targets.map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => onInsert(bullet, t.id)}>
                      {t.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        {(r.status === "missing" || r.status === "partial") && (
          <Button
            size="sm"
            variant="outline"
            className="h-6"
            onClick={() => onAskAi(askAiPrompt(r))}
          >
            Ask AI
          </Button>
        )}
      </li>
    );
  }

  const groups = (["must", "nice"] as const).map((importance) => ({
    importance,
    items: (report?.requirements ?? []).filter(
      (r) => r.importance === importance && (!gapsOnly || r.status !== "met"),
    ),
  }));

  return (
    <div className="space-y-3" aria-busy={loading}>
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          {report && (
            <output
              aria-label={`Screening score ${score} of 100`}
              className={`grid size-12 shrink-0 place-items-center rounded-full border-4 text-sm font-semibold ${scoreTone}`}
            >
              {score}
            </output>
          )}
          <div className="mr-auto min-w-0">
            <p className="font-medium truncate">{report?.jobTitle || job.title}</p>
            <p className="text-xs text-muted-foreground truncate">
              {report?.employer || job.employer}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void check()}>
            {report ? "Check again" : "Check match"}
          </Button>
        </div>
        {checked && checked.document !== JSON.stringify(getDocument()) && (
          <p className="text-xs text-muted-foreground">Resume changed since this check</p>
        )}
        {report && <p className="text-sm">{report.summary}</p>}
        {checked && (
          <p className="text-xs text-muted-foreground">
            Last checked {checked.checkedAt.toLocaleTimeString()}
          </p>
        )}
        {job.jobDescription && (
          <details className="text-xs">
            <summary className="cursor-pointer">View job post</summary>
            <div className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border p-2">
              {job.jobDescription}
            </div>
          </details>
        )}
      </header>
      {loading ? (
        <div className="space-y-2" data-testid="job-match-loading">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        report && (
          <>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={gapsOnly}
                onChange={(e) => setGapsOnly(e.target.checked)}
              />
              Show gaps only
            </label>
            {groups.map(
              (group) =>
                group.items.length > 0 && (
                  <section key={group.importance} className="space-y-1">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                      {group.importance === "must" ? "Must-have" : "Nice-to-have"}
                    </h3>
                    <ul className="space-y-1">{group.items.map(requirementRow)}</ul>
                  </section>
                ),
            )}
            {groups.every((g) => !g.items.length) && (
              <p className="text-sm text-muted-foreground">
                {gapsOnly ? "No gaps found." : "No requirements found."}
              </p>
            )}
          </>
        )
      )}
    </div>
  );
}
