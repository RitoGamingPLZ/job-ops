import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import { generateJobPdf, getJob } from "@client/api/jobs";
import { joinDescription, splitDescription } from "@shared/resume-bullets";
import type {
  Job,
  JobResumeState,
  ReactiveResumeV5Document,
  ResumeFocusRef,
  ResumeSuggestion,
} from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  coworkError,
  DutyLibrary,
} from "@/client/components/cowork/DutyLibrary";
import {
  addFocus,
  BULLET_TRANSFER_TYPE,
  type BulletReference,
  FOCUS_TRANSFER_TYPE,
  focusKey,
  MAX_FOCUS,
  readBulletTransfer,
  readFocusTransfer,
} from "@/client/components/cowork/editor";
import {
  focusResumePart,
  JobMatchPanel,
} from "@/client/components/cowork/JobMatchPanel";
import { ResumeEditor } from "@/client/components/cowork/ResumeEditor";
import { GhostwriterPanel } from "@/client/components/ghostwriter/GhostwriterPanel";
import {
  createJobPdfObjectUrl,
  downloadJobPdf,
} from "@/client/lib/private-pdf";
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

// Matches Tailwind's xl breakpoint, where all three panes show side by side.
const WIDE_QUERY = "(min-width: 1280px)";
function useWideLayout() {
  const [wide, setWide] = useState(
    () => window.matchMedia?.(WIDE_QUERY).matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_QUERY);
    if (!query) return;
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function ResumeCoworkPage() {
  const { jobId } = useParams();
  return jobId ? <CoworkWorkspace key={jobId} jobId={jobId} /> : null;
}
function CoworkWorkspace({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [state, setState] = useState<JobResumeState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [suggestions, setSuggestions] = useState<ResumeSuggestion[]>([]);
  const [references, setReferences] = useState<BulletReference[]>([]);
  const [focus, setFocus] = useState<ResumeFocusRef[]>([]);
  const chat = useRef<HTMLElement>(null);
  const [tab, setTab] = useState("editor");
  const [status, setStatus] = useState("Loading…");
  const [undoStack, setUndoStack] = useState<ReactiveResumeV5Document[]>([]);
  const history = useRef<ReactiveResumeV5Document[]>([]);
  const lastTyping = useRef<{ element: Element; time: number } | null>(null);
  const conflict = useRef<JobResumeState | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Enter/leave fire for every child crossed; count them so the highlight holds.
  const dragDepth = useRef(0);
  const lastInsert = useRef<{ key: string; time: number } | null>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rightTab, setRightTab] = useState<"match" | "duties">("match");
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const wide = useWideLayout();
  const editorPane = useRef<HTMLElement>(null);
  const latest = useRef<JobResumeState | null>(null);
  const dirty = useRef(false);
  const version = useRef(0);
  const mounted = useRef(true);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publish = useCallback((next: JobResumeState) => {
    latest.current = next;
    if (mounted.current) setState(next);
  }, []);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextJob, next] = await Promise.all([
        getJob(jobId),
        api.getJobResume(jobId),
      ]);
      if (!mounted.current) return;
      setJob(nextJob);
      publish(next);
      dirty.current = false;
      setStatus("Saved");
    } catch (failure) {
      if (mounted.current) setError(failure);
    }
  }, [jobId, publish]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  const save = useCallback(async (): Promise<boolean> => {
    if (conflict.current) return false;
    if (saving.current) return saving.current;
    if (!dirty.current || !latest.current) return true;
    const snapshot = latest.current;
    const editVersion = version.current;
    if (mounted.current) setStatus("Saving…");
    const operation = (async () => {
      try {
        const saved = await api.saveJobResume(jobId, {
          baseRevision: snapshot.revision,
          document: snapshot.document,
        });
        const changed = version.current !== editVersion;
        publish(
          changed && latest.current
            ? { ...saved, document: latest.current.document }
            : saved,
        );
        dirty.current = changed;
        if (mounted.current) setStatus(changed ? "Unsaved changes" : "Saved");
        return true;
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.status === 409) {
          if (!mounted.current) {
            toast.message(
              "Resume changed elsewhere. Your last edits could not be saved; reopen the resume to review the latest copy.",
            );
            return false;
          }
          try {
            conflict.current = await api.getJobResume(jobId);
            setConflictOpen(true);
            setStatus("Save conflict · choose which copy to keep");
          } catch (reloadError) {
            coworkError(reloadError);
            setStatus("Could not load the latest copy · retry saving");
          }
        } else {
          coworkError(failure);
          if (mounted.current)
            setStatus("Save failed · retry to keep your changes");
        }
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = operation;
    return operation;
  }, [jobId, publish]);
  // A child unmounting mid-drag never fires dragleave; reset when any drag ends.
  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setDragOver(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  // Flush the last debounced edit when leaving this job, including edits queued
  // behind an in-flight save. References still advance after unmount.
  useEffect(
    () => () => {
      void (async () => {
        while (dirty.current || saving.current) {
          if (await save()) continue;
          // Leaving with the conflict dialog open: say the local copy was dropped.
          if (conflict.current)
            toast.message(
              "Resume changed elsewhere. Your unsaved edits were not saved; reopen the resume to review the latest copy.",
            );
          break;
        }
      })();
    },
    [save],
  );
  // Schedule again when a save returns with newer local edits still pending.
  useEffect(() => {
    if (!state || !dirty.current || busy || conflict.current) return;
    timer.current = setTimeout(() => void save(), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, busy, save]);
  function pushUndo(document: ReactiveResumeV5Document) {
    history.current = [...history.current.slice(-49), document];
    setUndoStack(history.current);
  }
  function edit(document: ReactiveResumeV5Document, typing = false) {
    if (!latest.current || document === latest.current.document) return;
    const element = window.document.activeElement;
    const now = Date.now();
    const field =
      typing &&
      element?.closest(
        "input, textarea, [contenteditable]:not([contenteditable=false])",
      );
    if (
      !field ||
      lastTyping.current?.element !== element ||
      now - lastTyping.current.time > 1000
    )
      pushUndo(latest.current.document);
    lastTyping.current = field && element ? { element, time: now } : null;
    version.current++;
    dirty.current = true;
    publish({ ...latest.current, document });
    setStatus("Unsaved changes");
  }
  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous || !latest.current) return;
    setUndoStack([...history.current]);
    lastTyping.current = null;
    version.current++;
    dirty.current = true;
    publish({ ...latest.current, document: previous });
    setStatus("Unsaved changes");
  }, [publish]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, [contenteditable]:not([contenteditable=false])",
        )
      )
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z" &&
        !busy &&
        !conflictOpen &&
        !resetOpen &&
        history.current.length
      ) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [undo, busy, conflictOpen, resetOpen]);
  async function resolveConflict(keepMine: boolean) {
    const remote = conflict.current;
    if (!remote || !latest.current) return;
    if (!keepMine) pushUndo(latest.current.document);
    version.current++;
    publish(
      keepMine ? { ...remote, document: latest.current.document } : remote,
    );
    dirty.current = keepMine;
    conflict.current = null;
    lastTyping.current = null;
    setConflictOpen(false);
    setStatus(keepMine ? "Unsaved changes" : "Saved");
    if (keepMine) await save();
  }
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    while (dirty.current || saving.current) {
      if (!(await save())) return false;
    }
    return true;
  }
  async function resetToBase() {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    try {
      if (saving.current) await saving.current;
      await api.deleteJobResume(jobId);
      dirty.current = false;
      setSuggestions([]);
      history.current = [];
      setUndoStack([]);
      lastTyping.current = null;
      await load();
    } catch (failure) {
      coworkError(failure);
    } finally {
      setBusy(false);
    }
  }
  function reference(bullet: BulletReference) {
    setReferences((current) =>
      current.some((b) => b.id === bullet.id) ? current : [...current, bullet],
    );
  }
  function addFocusRef(ref: ResumeFocusRef) {
    if (focus.length >= MAX_FOCUS)
      toast.message(`At most ${MAX_FOCUS} resume parts can be in focus`);
    setFocus((current) => addFocus(current, ref));
  }
  function insertDuty(bullet: BulletReference, id: string) {
    if (busy || !latest.current) return;
    const key = `${id}:${bullet.id}:${bullet.text}`;
    const now = Date.now();
    if (lastInsert.current?.key === key && now - lastInsert.current.time < 500)
      return;
    lastInsert.current = { key, time: now };
    const next = structuredClone(latest.current.document);
    const experience = next.sections.experience.items.find((e) => e.id === id);
    if (experience) {
      const { introHtml, bullets } = splitDescription(experience.description);
      experience.description = joinDescription(
        introHtml,
        [...bullets, bullet.text],
        experience.description,
      );
      edit(next);
      toast.success("Duty inserted");
    }
  }
  const getDocument = useCallback(
    () => latest.current?.document as ReactiveResumeV5Document,
    [],
  );
  const receiveSuggestions = useCallback(
    (items: ResumeSuggestion[] | null) => {
      if (items?.length && !wide)
        toast.message(
          `${items.length} suggestion${items.length === 1 ? "" : "s"} - review in Editor`,
        );
      if (items)
        setSuggestions((current) => [
          ...current.filter((s) => !items.some((next) => next.id === s.id)),
          ...items,
        ]);
    },
    [wide],
  );
  if (error)
    return (
      <main className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">Resume co-work</h1>
        <p>
          {error instanceof ApiClientError && error.status === 409
            ? "Import or create a resume first."
            : "Could not load this job’s resume."}
        </p>
        <Button asChild>
          <Link to="/design-resume">Open Resume Studio</Link>
        </Button>
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </main>
    );
  if (!job || !state) return <output className="p-6">Loading resume…</output>;
  const document = state.document;
  const targets = document.sections.experience.items
    .filter((e) => !e.hidden)
    .map((e) => ({ id: e.id, label: `${e.company} · ${e.position}` }));
  return (
    <main className="flex min-h-0 flex-col h-[calc(100dvh-5rem)] p-4 gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to="/resumes" className="text-sm underline">
          Resumes
        </Link>
        <h1 className="font-semibold mr-auto min-w-0 break-words">
          {job.title} · {job.employer}
        </h1>
        <output className="text-xs text-muted-foreground">
          {rendering ? "Rendering PDF…" : status}
        </output>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !undoStack.length}
          onClick={undo}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void flush()}
        >
          Save now
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setResetOpen(true)}
        >
          Reset to base
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            const pdfTab = window.open("about:blank", "_blank");
            if (pdfTab) pdfTab.opener = null;
            setBusy(true);
            setRendering(true);
            try {
              if (await flush()) {
                await generateJobPdf(jobId);
                setPdfReady(true);
                if (pdfTab && !pdfTab.closed) {
                  const url = await createJobPdfObjectUrl(jobId);
                  pdfTab.location.href = url;
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                } else await downloadJobPdf(jobId, "resume.pdf");
              } else pdfTab?.close();
            } catch (failure) {
              pdfTab?.close();
              coworkError(failure);
            } finally {
              setRendering(false);
              setBusy(false);
            }
          }}
        >
          Render PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || (!job.pdfPath && !pdfReady)}
          title="Download the last rendered PDF"
          onClick={() =>
            void downloadJobPdf(jobId, "resume.pdf").catch(coworkError)
          }
        >
          Download PDF
        </Button>
      </header>
      <div
        className="flex gap-2 xl:hidden"
        role="tablist"
        aria-label="Resume workspace"
      >
        {["chat", "editor", "library"].map((name) => (
          <Button
            key={name}
            id={`cowork-tab-${name}`}
            aria-controls={`cowork-panel-${name}`}
            role="tab"
            aria-selected={tab === name}
            variant={tab === name ? "secondary" : "ghost"}
            onClick={() => setTab(name)}
          >
            {name === "library"
              ? "Match & duties"
              : name === "editor" && suggestions.length
                ? `Editor (${suggestions.length})`
                : name[0].toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(260px,3fr)_minmax(360px,5fr)_minmax(260px,3fr)]">
        <section
          id="cowork-panel-chat"
          role="tabpanel"
          aria-labelledby="cowork-tab-chat"
          aria-label="Chat"
          className={`${tab === "chat" ? "flex" : "hidden"} ${dragOver ? "ring-2 ring-primary" : ""} xl:flex min-h-0 min-w-0 flex-col border rounded-md p-3`}
          ref={chat}
          data-drag={dragOver || undefined}
          onDragEnter={(e) => {
            if (
              e.dataTransfer.types.includes(BULLET_TRANSFER_TYPE) ||
              e.dataTransfer.types.includes(FOCUS_TRANSFER_TYPE)
            ) {
              dragDepth.current++;
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (
              (e.dataTransfer.types.includes(BULLET_TRANSFER_TYPE) ||
                e.dataTransfer.types.includes(FOCUS_TRANSFER_TYPE)) &&
              --dragDepth.current <= 0
            ) {
              dragDepth.current = 0;
              setDragOver(false);
            }
          }}
          onDragOver={(e) => {
            if (
              e.dataTransfer.types.includes(BULLET_TRANSFER_TYPE) ||
              e.dataTransfer.types.includes(FOCUS_TRANSFER_TYPE)
            )
              e.preventDefault();
          }}
          onDrop={(e) => {
            dragDepth.current = 0;
            setDragOver(false);
            if (e.dataTransfer.types.includes(FOCUS_TRANSFER_TYPE)) {
              e.preventDefault();
              const ref = readFocusTransfer(
                e.dataTransfer.getData(FOCUS_TRANSFER_TYPE),
              );
              if (ref) addFocusRef(ref);
              return;
            }
            if (!e.dataTransfer.types.includes(BULLET_TRANSFER_TYPE)) return;
            e.preventDefault();
            const bullet = readBulletTransfer(
              e.dataTransfer.getData(BULLET_TRANSFER_TYPE),
            );
            if (bullet) reference(bullet);
          }}
        >
          <h2 className="text-sm font-semibold mb-3">Co-work chat</h2>
          <GhostwriterPanel
            job={job}
            initialPrompt={chatPrompt}
            onInitialPromptConsumed={() => setChatPrompt(null)}
            cowork={() => ({
              document: latest.current?.document ?? document,
              referencedBulletIds: references.map((b) => b.id),
              focus,
            })}
            onSuggestions={receiveSuggestions}
            referenceChips={
              <div className="flex flex-wrap gap-1 mb-2">
                {focus.map((ref) => (
                  <Button
                    key={focusKey(ref)}
                    size="sm"
                    variant="outline"
                    className="max-w-full"
                    title={ref.label}
                    aria-label={`Remove focus: ${ref.label}`}
                    onClick={() =>
                      setFocus((current) =>
                        current.filter(
                          (item) => focusKey(item) !== focusKey(ref),
                        ),
                      )
                    }
                  >
                    <span className="truncate">{ref.label}</span>
                    <span aria-hidden="true"> ×</span>
                  </Button>
                ))}
                {references.map((b) => (
                  <Button
                    key={b.id}
                    size="sm"
                    variant="secondary"
                    className="max-w-full"
                    title={b.text}
                    aria-label={`Remove reference: ${b.text}`}
                    onClick={() =>
                      setReferences((current) =>
                        current.filter((item) => item.id !== b.id),
                      )
                    }
                  >
                    <span className="truncate">{b.text}</span>
                    <span aria-hidden="true"> ×</span>
                  </Button>
                ))}
              </div>
            }
          />
        </section>
        <section
          ref={editorPane}
          id="cowork-panel-editor"
          role="tabpanel"
          aria-labelledby="cowork-tab-editor"
          aria-label="Resume editor"
          className={`${tab === "editor" ? "block" : "hidden"} xl:block min-h-0 min-w-0 overflow-auto [scrollbar-gutter:stable] border rounded-md bg-[#e4e5e7] p-3`}
        >
          <ResumeEditor
            disabled={busy}
            document={document}
            onChange={(next) => edit(next, true)}
            onAskAi={(ref) => {
              addFocusRef(ref);
              setTab("chat");
              // The chat panel may only become visible after this render.
              setTimeout(() =>
                chat.current?.querySelector<HTMLElement>("textarea")?.focus(),
              );
            }}
            suggestions={suggestions}
            onDismiss={(ids) =>
              setSuggestions((current) =>
                current.filter((s) => !ids.includes(s.id)),
              )
            }
          />
        </section>
        <section
          id="cowork-panel-library"
          role="tabpanel"
          aria-labelledby="cowork-tab-library"
          aria-label="Duty library"
          className={`${tab === "library" ? "block" : "hidden"} xl:block min-h-0 min-w-0 overflow-auto border rounded-md p-3`}
        >
          <div
            className="flex gap-1 mb-3"
            role="tablist"
            aria-label="Job match and duties"
          >
            {(
              [
                ["match", "Job match"],
                ["duties", "Duties"],
              ] as const
            ).map(([name, label]) => (
              <Button
                key={name}
                size="sm"
                role="tab"
                aria-selected={rightTab === name}
                variant={rightTab === name ? "secondary" : "ghost"}
                onClick={() => setRightTab(name)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div hidden={rightTab !== "match"}>
            <JobMatchPanel
              job={job}
              active={rightTab === "match" && (wide || tab === "library")}
              getDocument={getDocument}
              targets={targets}
              onInsert={insertDuty}
              onAskAi={(prompt) => {
                setChatPrompt(prompt);
                setTab("chat");
              }}
              onFocusRef={(ref) => {
                setTab("editor");
                // After the editor tab is shown on narrow screens.
                setTimeout(() => {
                  if (editorPane.current)
                    focusResumePart(editorPane.current, ref);
                });
              }}
            />
          </div>
          <div hidden={rightTab !== "duties"}>
            <DutyLibrary
              jobId={jobId}
              targets={targets}
              onReference={reference}
              onInsert={insertDuty}
            />
          </div>
        </section>
      </div>
      <AlertDialog open={conflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume changed elsewhere</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits are still here. Keep mine saves them against the latest
              revision. Use latest loads the server copy; Undo restores your
              edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => void resolveConflict(false)}
            >
              Use latest
            </Button>
            <Button onClick={() => void resolveConflict(true)}>
              Keep mine
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to base?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards your edits to this job’s resume and rebuilds it from
              your base resume and this job’s tailoring. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resetToBase()}>
              Reset resume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
