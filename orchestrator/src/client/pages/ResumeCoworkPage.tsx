import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import { generateJobPdf, getJob } from "@client/api/jobs";
import { bulletsFromHtml, bulletsToHtml } from "@shared/resume-bullets";
import type {
  Job,
  JobResumeState,
  ReactiveResumeV5Document,
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
  BULLET_TRANSFER_TYPE,
  type BulletReference,
  readBulletTransfer,
} from "@/client/components/cowork/editor";
import { ResumeEditor } from "@/client/components/cowork/ResumeEditor";
import { GhostwriterPanel } from "@/client/components/ghostwriter/GhostwriterPanel";
import { openJobPdf } from "@/client/lib/private-pdf";
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
  const [tab, setTab] = useState("editor");
  const [status, setStatus] = useState("Loading…");
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
      setStatus(next.exists ? "Saved" : "Base resume · edit to save a copy");
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
          dirty.current = false;
          try {
            publish(await api.getJobResume(jobId));
            setStatus("Reloaded latest copy");
            toast.message(
              "Resume changed elsewhere. Reloaded the latest copy; review before editing again.",
            );
          } catch (reloadError) {
            setError(reloadError);
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
          if (!(await save())) break;
        }
      })();
    },
    [save],
  );
  // Schedule again when a save returns with newer local edits still pending.
  useEffect(() => {
    if (!state || !dirty.current || busy) return;
    timer.current = setTimeout(() => void save(), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, busy, save]);
  function edit(document: ReactiveResumeV5Document) {
    if (!latest.current) return;
    version.current++;
    dirty.current = true;
    publish({ ...latest.current, document });
    setStatus("Unsaved changes");
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
  const receiveSuggestions = useCallback((items: ResumeSuggestion[] | null) => {
    if (items)
      setSuggestions((current) => [
        ...current.filter((s) => !items.some((next) => next.id === s.id)),
        ...items,
      ]);
  }, []);
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
  return (
    <main className="flex min-h-0 flex-col h-[calc(100dvh-5rem)] p-4 gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to="/resumes" className="text-sm underline">
          Resumes
        </Link>
        <h1 className="font-semibold mr-auto">
          {job.title} · {job.employer}
        </h1>
        <output className="text-xs text-muted-foreground">{status}</output>
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
            setBusy(true);
            try {
              if (await flush()) {
                await generateJobPdf(jobId);
                await openJobPdf(jobId);
              }
            } catch (failure) {
              coworkError(failure);
            } finally {
              setBusy(false);
            }
          }}
        >
          Render PDF
        </Button>
      </header>
      {state.exists && (
        <p className="text-xs text-muted-foreground">
          This job uses its co-work copy; Reset to base to re-tailor
        </p>
      )}
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
            {name[0].toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(260px,3fr)_minmax(360px,5fr)_minmax(260px,3fr)]">
        <section
          id="cowork-panel-chat"
          role="tabpanel"
          aria-labelledby="cowork-tab-chat"
          aria-label="Chat"
          className={`${tab === "chat" ? "flex" : "hidden"} xl:flex min-h-0 flex-col border rounded-md p-3`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(BULLET_TRANSFER_TYPE))
              e.preventDefault();
          }}
          onDrop={(e) => {
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
            cowork={() => ({
              document: latest.current?.document ?? document,
              referencedBulletIds: references.map((b) => b.id),
            })}
            onSuggestions={receiveSuggestions}
            referenceChips={
              <div className="flex flex-wrap gap-1 mb-2">
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
          id="cowork-panel-editor"
          role="tabpanel"
          aria-labelledby="cowork-tab-editor"
          aria-label="Resume editor"
          className={`${tab === "editor" ? "block" : "hidden"} xl:block min-h-0 overflow-auto border rounded-md p-4`}
        >
          <ResumeEditor
            disabled={busy}
            document={document}
            onChange={edit}
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
          className={`${tab === "library" ? "block" : "hidden"} xl:block min-h-0 overflow-auto border rounded-md p-3`}
        >
          <h2 className="text-sm font-semibold mb-3">Duty library</h2>
          <DutyLibrary
            jobId={jobId}
            targets={document.sections.experience.items
              .filter((e) => !e.hidden)
              .map((e) => ({
                id: e.id,
                label: `${e.company} · ${e.position}`,
              }))}
            onReference={reference}
            onInsert={(bullet, id) => {
              if (busy) return;
              const next = structuredClone(document);
              const experience = next.sections.experience.items.find(
                (e) => e.id === id,
              );
              if (experience) {
                experience.description = bulletsToHtml([
                  ...bulletsFromHtml(experience.description),
                  bullet.text,
                ]);
                edit(next);
                toast.success("Duty inserted");
              }
            }}
          />
        </section>
      </div>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to base?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this job’s co-work copy and its edits.
              This action cannot be undone.
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
