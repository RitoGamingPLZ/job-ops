import { ApiClientError } from "@client/api/core";
import * as api from "@client/api/cowork";
import { generateJobPdf, getJob } from "@client/api/jobs";
import {
  generateDesignResumePdf,
  getDesignResume,
  importDesignResumeFromFile,
  updateDesignResume,
} from "@client/api/settings-profile";
import {
  applyLibraryUpdate,
  changedLibraryFields,
  getItemLines,
  isOnResume,
  setItemLines,
} from "@shared/resume-links";
import type {
  DesignResumeDocument,
  EntrySection,
  ExperienceBullet,
  ExperienceBulletInput,
  Job,
  JobResumeState,
  ResumeV5Document,
  ResumeFocusRef,
  ResumeListItem,
  ResumeSuggestionV2,
} from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  executeAcceptedSuggestions,
  librarySaveInput,
} from "@/client/components/cowork/acceptSuggestions";
import { CandidateLibrary } from "@/client/components/cowork/CandidateLibrary";
import { coworkError } from "@/client/components/cowork/DutyLibrary";
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
import { focusResumePart, JobMatchPanel } from "@/client/components/cowork/JobMatchPanel";
import { PdfCanvasPreview } from "@/client/components/cowork/PdfCanvasPreview";
import { ResumeEditor } from "@/client/components/cowork/ResumeEditor";
import { GhostwriterPanel } from "@/client/components/ghostwriter/GhostwriterPanel";
import { fileToUploadPayload } from "@/client/lib/file-upload-payload";
import {
  getResumeState,
  isPdfRegenerating,
  needsRender,
  PDF_REGENERATING_MESSAGE,
} from "@/client/lib/pdf-freshness";
import {
  createDesignResumePreviewPdfObjectUrl,
  createJobPdfObjectUrl,
  createJobPreviewPdfObjectUrl,
  downloadDesignResumePdf,
  downloadJobPdf,
} from "@/client/lib/private-pdf";
import { queryKeys } from "@/client/lib/queryKeys";
import { type ResumeEditorMode, readResumeEditorMode } from "@/client/lib/resume-opening";
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
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";

// Matches Tailwind's xl breakpoint, where all three panes show side by side.
const PREVIEW_KEY = "resume-cowork-preview";
const WIDE_QUERY = "(min-width: 1280px)";
function useWideLayout() {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_QUERY);
    if (!query) return;
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

function baseState(base: DesignResumeDocument): JobResumeState {
  return {
    document: base.resumeJson,
    revision: base.revision,
    exists: true,
    updatedAt: base.updatedAt,
  };
}

export function ResumeCoworkPage({ base = false }: { base?: boolean }) {
  const { jobId } = useParams();
  const requestedMode = readResumeEditorMode(useLocation().search);
  return base || jobId ? (
    <CoworkWorkspace
      key={base ? "base" : jobId}
      jobId={jobId ?? "base"}
      base={base}
      requestedMode={requestedMode}
    />
  ) : null;
}
function CoworkWorkspace({
  jobId,
  base,
  requestedMode,
}: {
  jobId: string;
  base: boolean;
  requestedMode?: ResumeEditorMode;
}) {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const readResume = useCallback(
    async () => (base ? baseState(await getDesignResume()) : api.getJobResume(jobId)),
    [base, jobId],
  );
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const switching = useRef(false);
  const [library, setLibrary] = useState<ExperienceBullet[]>([]);
  const [preview, setPreview] = useState(() => {
    if (requestedMode) return requestedMode === "preview";
    try {
      return localStorage.getItem(PREVIEW_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRunning = useRef(false);
  const loadRunning = useRef<Promise<void> | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [state, setState] = useState<JobResumeState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [suggestions, setSuggestions] = useState<ResumeSuggestionV2[]>([]);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const accepting = useRef(false);
  const pendingAcceptedIds = useRef<string[]>([]);
  const acceptedUndoIds = useRef(new WeakMap<ResumeV5Document, string[]>());
  const [references, setReferences] = useState<BulletReference[]>([]);
  const [focus, setFocus] = useState<ResumeFocusRef[]>([]);
  const chat = useRef<HTMLElement>(null);
  const [tab, setTab] = useState("editor");
  const [status, setStatus] = useState("Loading…");
  const [undoStack, setUndoStack] = useState<ResumeV5Document[]>([]);
  const history = useRef<ResumeV5Document[]>([]);
  const lastTyping = useRef<{ element: Element; time: number } | null>(null);
  const conflict = useRef<JobResumeState | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Enter/leave fire for every child crossed; count them so the highlight holds.
  const dragDepth = useRef(0);
  const lastInsert = useRef<{ key: string; time: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rightTab, setRightTab] = useState<"library" | "match">("library");
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const wide = useWideLayout();
  const editorPane = useRef<HTMLElement>(null);
  const latest = useRef<JobResumeState | null>(null);
  const dirty = useRef(false);
  const syncing = useRef(false);
  const resumeReloadRequired = useRef(false);
  const version = useRef(0);
  const mounted = useRef(true);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publish = useCallback((next: JobResumeState) => {
    latest.current = next;
    if (mounted.current) setState(next);
  }, []);
  const load = useCallback(async () => {
    if (loadRunning.current) return loadRunning.current;
    const operation = (async () => {
      setError(null);
      try {
        const nextJob = base ? null : await getJob(jobId);
        if (!mounted.current) return;
        if (nextJob) {
          setJob(nextJob);
          if (getResumeState(nextJob) !== "available")
            throw new Error(
              "Prepare this resume before opening it. Wait for preparation to finish, then retry.",
            );
          if (isPdfRegenerating(nextJob)) throw new Error(PDF_REGENERATING_MESSAGE);
        }
        // GET /library can stamp refs and advance the resume revision on first build.
        // Read the resume only after that build has finished.
        const result = await api.listCandidateLibrary();
        if (!mounted.current) return;
        setLibrary(result.items);
        const next = await readResume();
        if (!mounted.current) return;
        setJob(nextJob);
        publish(next);
        dirty.current = false;
        resumeReloadRequired.current = false;
        setStatus("Saved");
      } catch (failure) {
        if (mounted.current) setError(failure);
      }
    })();
    loadRunning.current = operation;
    try {
      await operation;
    } finally {
      loadRunning.current = null;
    }
  }, [base, jobId, publish, readResume]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap once per identity; query changes are handled separately.
  useEffect(() => {
    mounted.current = true;
    // Preview mode shows the same full workspace as edit mode, just toggled
    // to the PDF pane, so it also loads the same editable state. Mark the
    // preview as already requested synchronously, before load() starts, so
    // the state-triggered effect below never redundantly fires its own
    // (always-render) showPreview() for this mount no matter how the two
    // promises interleave. Trigger the actual entry-aware preview (only
    // renders if stale) after load() settles -- never in parallel with it --
    // so the PDF still shows even if load() failed (e.g. the editable JSON
    // source has its own error).
    if (!base && requestedMode === "preview") previewRequested.current = true;
    void load().then(() => {
      if (mounted.current && !base && requestedMode === "preview") {
        void showPreview(true);
      }
    });
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    void api
      .listResumes()
      .then((result) => {
        if (active) setResumes(result.resumes);
      })
      .catch(() => {
        // The current resume remains available when the switcher list fails.
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  const save = useCallback(async (): Promise<boolean> => {
    if (conflict.current || resumeReloadRequired.current) return false;
    if (saving.current) return saving.current;
    if (!dirty.current || !latest.current) return true;
    const snapshot = latest.current;
    const editVersion = version.current;
    if (mounted.current) setStatus("Saving…");
    const operation = (async () => {
      try {
        const input = {
          baseRevision: snapshot.revision,
          document: snapshot.document,
        };
        const saved = base
          ? baseState(await updateDesignResume(input))
          : await api.saveJobResume(jobId, input);
        if (base)
          void queryClient.invalidateQueries({
            queryKey: queryKeys.designResume.all,
          });
        const changed = version.current !== editVersion;
        publish(
          changed && latest.current ? { ...saved, document: latest.current.document } : saved,
        );
        dirty.current = changed;
        if (!changed && pendingAcceptedIds.current.length) {
          const ids = pendingAcceptedIds.current;
          pendingAcceptedIds.current = [];
          setSuggestions((current) => current.filter((s) => !ids.includes(s.id)));
        }
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
            conflict.current = await readResume();
            setConflictOpen(true);
            setStatus("Save conflict · choose which copy to keep");
          } catch (reloadError) {
            coworkError(reloadError);
            setStatus("Could not load the latest copy · retry saving");
          }
        } else {
          coworkError(failure);
          if (mounted.current) setStatus("Save failed · retry to keep your changes");
        }
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = operation;
    return operation;
  }, [base, jobId, publish, queryClient, readResume]);
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
  function pushUndo(document: ResumeV5Document) {
    history.current = [...history.current.slice(-49), document];
    setUndoStack(history.current);
  }
  function edit(document: ResumeV5Document, typing = false) {
    if (
      syncing.current ||
      resumeReloadRequired.current ||
      !latest.current ||
      document === latest.current.document
    )
      return;
    const element = window.document.activeElement;
    const now = Date.now();
    const field =
      typing && element?.closest("input, textarea, [contenteditable]:not([contenteditable=false])");
    if (!field || lastTyping.current?.element !== element || now - lastTyping.current.time > 1000)
      pushUndo(latest.current.document);
    lastTyping.current = field && element ? { element, time: now } : null;
    version.current++;
    dirty.current = true;
    publish({ ...latest.current, document });
    setStatus("Unsaved changes");
  }
  const undo = useCallback(() => {
    if (syncing.current || resumeReloadRequired.current) return;
    const previous = history.current.pop();
    if (!previous || !latest.current) return;
    const undoneIds = acceptedUndoIds.current.get(previous) ?? [];
    pendingAcceptedIds.current = pendingAcceptedIds.current.filter((id) => !undoneIds.includes(id));
    acceptedUndoIds.current.delete(previous);
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
        event.target.closest("input, textarea, [contenteditable]:not([contenteditable=false])")
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
    if (!keepMine) {
      pushUndo(latest.current.document);
      pendingAcceptedIds.current = [];
    }
    version.current++;
    publish(keepMine ? { ...remote, document: latest.current.document } : remote);
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
  function switchResume(nextJobId: string) {
    if (nextJobId === jobId) return;
    if (dirty.current || saving.current) setSwitchTarget(nextJobId);
    else navigate(`/resumes/${nextJobId}`);
  }
  async function saveAndSwitch() {
    if (!switchTarget || switching.current) return;
    switching.current = true;
    setBusy(true);
    try {
      if (await flush()) navigate(`/resumes/${switchTarget}`);
    } finally {
      switching.current = false;
      if (mounted.current) {
        setSwitchTarget(null);
        setBusy(false);
      }
    }
  }
  async function syncLibrary() {
    if (syncing.current || busy) throw new Error("A resume action is already running.");
    syncing.current = true;
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!(await flush())) throw new Error("Save your resume before syncing the library.");
      // Sync can stamp refs and increment the server revision. Block every save
      // until we know that no reload is needed or have read that new revision.
      resumeReloadRequired.current = true;
      const result = await api.syncCandidateLibrary();
      if (result.linked > 0) {
        const next = await api.getJobResume(jobId);
        publish(next);
        dirty.current = false;
        version.current++;
        history.current = [];
        lastTyping.current = null;
        if (mounted.current) {
          setUndoStack([]);
          setSuggestions([]);
          setStatus("Saved");
        }
      }
      resumeReloadRequired.current = false;
      return result;
    } catch (failure) {
      // An uncertain revision must be reloaded through Retry before editing.
      if (resumeReloadRequired.current && mounted.current) setError(failure);
      throw failure;
    } finally {
      syncing.current = false;
      if (mounted.current) setBusy(false);
    }
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
    if (busy || syncing.current || !latest.current) return;
    const key = `${id}:${bullet.id}:${bullet.text}`;
    const now = Date.now();
    if (lastInsert.current?.key === key && now - lastInsert.current.time < 500) return;
    lastInsert.current = { key, time: now };
    const original = library.find((item) => item.id === bullet.id);
    const ref = original?.kind === "bullet" ? original.id : null;
    if (ref && isOnResume(latest.current.document, ref)) return;
    const next = structuredClone(latest.current.document);
    const index = next.sections.experience.items.findIndex((e) => e.id === id);
    if (index >= 0) {
      const experience = next.sections.experience.items[index];
      next.sections.experience.items[index] = setItemLines(experience, [
        ...getItemLines(experience),
        { text: bullet.text, ref },
      ]) as typeof experience;
      edit(next);
      toast.success("Duty inserted");
    }
  }
  async function acceptSuggestions(items: ResumeSuggestionV2[]) {
    if (accepting.current || busy || !items.length) return;
    accepting.current = true;
    setBusy(true);
    try {
      if (!(await flush()) || !latest.current) return;
      syncing.current = true;
      const snapshot = latest.current;
      const result = await executeAcceptedSuggestions(
        {
          jobId,
          document: snapshot.document,
          baseRevision: snapshot.revision,
          library,
        },
        items,
        {
          createItem: api.createExperienceBullet,
          updateItem: api.updateExperienceBullet,
        },
      );
      if (!mounted.current) return;
      setLibrary(result.library);
      const reasons = Object.fromEntries(
        result.rejected.map(({ id, code }) => [
          id,
          code === "INVALID_TARGET" &&
          items.some((s) => s.id === id && s.op === "create_library_item")
            ? "Added to library; could not place on resume."
            : code === "FAILED"
              ? "Library update failed. Retry accepting this suggestion."
              : code === "INVALID_TARGET"
                ? "The linked library item or resume target is no longer available."
                : "This content has changed. Request a fresh suggestion.",
        ]),
      );
      syncing.current = false;
      if (result.applied.length) {
        const beforeEdit = latest.current?.document;
        edit(result.document);
        if (beforeEdit && beforeEdit !== result.document) {
          acceptedUndoIds.current.set(
            beforeEdit,
            result.applied.filter((id) =>
              items.some(
                (s) =>
                  s.id === id &&
                  s.op !== "save_to_library" &&
                  (s.op !== "create_library_item" || s.includeOnResume),
              ),
            ),
          );
        }
        // Even library-only acceptance checks that the reviewed resume revision still holds.
        dirty.current = true;
        pendingAcceptedIds.current = [
          ...new Set([...pendingAcceptedIds.current, ...result.applied]),
        ];
        if (!(await save())) {
          for (const id of result.applied)
            reasons[id] =
              "Resume save failed or conflicted. Review the current copy before retrying. Library changes may already be saved.";
        }
      }
      setRejectionReasons((current) => ({ ...current, ...reasons }));
    } catch (failure) {
      coworkError(failure);
      setRejectionReasons((current) => ({
        ...current,
        ...Object.fromEntries(items.map((s) => [s.id, "Acceptance failed. Review and retry."])),
      }));
    } finally {
      syncing.current = false;
      accepting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function saveEntryToLibrary(section: EntrySection, itemId: string) {
    const document = latest.current?.document;
    const item = document?.sections[section].items.find((entry) => entry.id === itemId);
    if (!document || typeof item?.libraryId !== "string") return;
    const saved = librarySaveInput(
      document,
      { kind: "entry", section, itemId, libraryId: item.libraryId },
      library,
      false,
    );
    if (!("input" in saved)) return;
    // Only the fields changed here: a skill's keywords are this job's pick.
    const changed = changedLibraryFields(item, library);
    const data = saved.input.data ?? {};
    const changedData = Object.keys(data).filter((key) => key in changed);
    const textChanged = Object.keys(changed).some((key) => !(key in data));
    await saveToLibrary(item.libraryId, {
      ...(textChanged ? { text: saved.input.text } : {}),
      ...(changedData.length
        ? {
            data: Object.fromEntries(
              [...changedData, "schemaVersion"]
                .filter((key) => key in data)
                .map((key) => [key, data[key]]),
            ),
          }
        : {}),
    });
  }
  async function saveToLibrary(id: string, input: Partial<ExperienceBulletInput>) {
    const before = library.find((item) => item.id === id);
    if (!before || busy) return;
    setBusy(true);
    try {
      const { bullet: after } = await api.updateExperienceBullet(id, input, jobId);
      if (!mounted.current) return;
      if (job?.status !== "applied" && job?.status !== "in_progress" && latest.current)
        edit(applyLibraryUpdate(latest.current.document, before, after));
      setLibrary((await api.listCandidateLibrary()).items);
    } catch (failure) {
      coworkError(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function showPreview(entry = false) {
    if (previewRunning.current) return;
    previewRunning.current = true;
    setBusy(true);
    setRendering(true);
    setPreviewError(null);
    try {
      const selectedJob = base ? null : await getJob(jobId);
      if (!mounted.current) return;
      if (selectedJob) {
        setJob(selectedJob);
        if (getResumeState(selectedJob) !== "available")
          throw new Error(
            "Prepare this resume before opening it. Wait for preparation to finish, then retry.",
          );
        if (isPdfRegenerating(selectedJob)) throw new Error(PDF_REGENERATING_MESSAGE);
      }
      const uploaded =
        selectedJob?.pdfSource === "uploaded" || selectedJob?.pdfFreshness === "uploaded";
      const render = base || (!uploaded && (!entry || needsRender(selectedJob)));
      if (render) {
        if (!latest.current) await load();
        if (!mounted.current) return;
        if (!latest.current)
          throw new Error(
            "Could not load the editable resume. Open Edit to resolve the source error, then retry.",
          );
        if (!(await flush()))
          throw new Error("Save the resume and resolve any conflict before previewing.");
        if (!mounted.current) return;
      } else if (!(await flush())) {
        throw new Error("Save the resume and resolve any conflict before previewing.");
      }
      if (!mounted.current) return;
      const url = base
        ? await createDesignResumePreviewPdfObjectUrl()
        : render
          ? await createJobPreviewPdfObjectUrl(jobId)
          : await createJobPdfObjectUrl(jobId);
      if (!mounted.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setPdfUrl(url);
    } catch (failure) {
      if (mounted.current) {
        setPreviewError(failure instanceof Error ? failure.message : "Could not preview the PDF.");
        coworkError(failure);
      }
    } finally {
      previewRunning.current = false;
      if (mounted.current) {
        setBusy(false);
        setRendering(false);
      }
    }
  }
  /** Renders the saved resume first, so the file matches the preview. */
  async function downloadPdf() {
    setBusy(true);
    try {
      if (!(await flush())) return;
      if (base) {
        await generateDesignResumePdf();
        await downloadDesignResumePdf("resume.pdf");
      } else {
        const selectedJob = await getJob(jobId);
        if (!mounted.current) return;
        if (getResumeState(selectedJob) !== "available")
          throw new Error("Prepare this resume before downloading it.");
        if (isPdfRegenerating(selectedJob)) throw new Error(PDF_REGENERATING_MESSAGE);
        if (
          selectedJob.pdfSource !== "uploaded" &&
          selectedJob.pdfFreshness !== "uploaded" &&
          (latest.current || needsRender(selectedJob))
        ) {
          if (!latest.current) await load();
          if (!mounted.current) return;
          if (!latest.current) throw new Error("Could not load the editable resume.");
          if (!(await flush()) || !mounted.current) return;
          await generateJobPdf(jobId);
        }
        await downloadJobPdf(jobId, "resume.pdf");
      }
    } catch (failure) {
      coworkError(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function importBase() {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!(await flush())) {
        setImportOpen(false);
        return;
      }
      if (!importFile) return;
      const payload = await fileToUploadPayload(importFile, "Could not read this resume file.");
      await importDesignResumeFromFile({
        ...payload,
        mediaType: payload.mediaType ?? undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.designResume.all }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.onboarding.status(),
        }),
      ]);
      history.current = [];
      setUndoStack([]);
      lastTyping.current = null;
      version.current++;
      setPdfUrl(null);
      setPreview(false);
      await load();
      setImportOpen(false);
      setImportFile(null);
    } catch (failure) {
      coworkError(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function setPreviewMode(next: boolean) {
    setPreview(next);
    if (!next && !latest.current) void load();
    try {
      localStorage.setItem(PREVIEW_KEY, String(next));
    } catch {
      /* Storage may be disabled. */
    }
  }
  function renderPreview() {
    setPreviewMode(true);
    previewRequested.current = true;
    void showPreview();
  }

  const getDocument = useCallback(() => latest.current?.document as ResumeV5Document, []);
  const receiveSuggestions = useCallback(
    (items: ResumeSuggestionV2[] | null) => {
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
  const previewRequested = useRef(false);
  const previousMode = useRef(requestedMode);
  useEffect(() => {
    if (previousMode.current === requestedMode) return;
    previousMode.current = requestedMode;
    if (!requestedMode) return;
    setPreviewMode(requestedMode === "preview");
    if (requestedMode === "preview") {
      previewRequested.current = true;
      void showPreview(!latest.current);
    }
  });
  useEffect(() => {
    if (!state || !preview || previewRequested.current) return;
    previewRequested.current = true;
    void showPreview();
  });
  const importControls = base && (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setImportFile(null);
          setImportOpen(true);
        }}
      >
        Import
      </Button>
      <input
        ref={fileInput}
        aria-label="Import resume file"
        type="file"
        accept=".pdf,.docx,.json"
        className="hidden"
        onChange={(event) => {
          setImportFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <AlertDialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!busy) setImportOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import base resume?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your base resume. Existing job resumes keep their current content.
              Choose a PDF, DOCX, or JSON resume file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            {importFile ? importFile.name : "Choose file"}
          </Button>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy || !importFile} onClick={() => void importBase()}>
              Import file
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  if (error && (!preview || base))
    return (
      <main className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">Resume co-work</h1>
        <p>
          {error instanceof ApiClientError && error.status === 409
            ? "Import or create a resume first."
            : base
              ? "Could not load your base resume. Import a resume to get started."
              : "Could not load this job’s resume."}
        </p>
        {!base && (
          <Button asChild>
            <Link to="/resumes/base">Open base resume</Link>
          </Button>
        )}
        {pdfUrl && (
          <Button variant="outline" onClick={() => setPreviewMode(true)}>
            Preview
          </Button>
        )}
        {importControls}
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </main>
    );
  const previewContent = (
    <>
      {previewError || (!pdfUrl && error) ? (
        <div role="alert" className="space-y-2">
          <p>
            {previewError ??
              "Could not load this job’s resume. Open Edit to resolve the source error."}
          </p>
          <Button disabled={busy} onClick={() => void showPreview(!latest.current)}>
            Retry
          </Button>
        </div>
      ) : pdfUrl ? (
        <div role="document" aria-label="Resume PDF preview">
          <PdfCanvasPreview url={pdfUrl} />
        </div>
      ) : (
        <output>{rendering ? "Rendering PDF…" : "Loading resume…"}</output>
      )}
    </>
  );
  if (preview && !state)
    return (
      <main className="p-6 space-y-4">
        <header className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            aria-label="Back"
            onClick={() => {
              if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
              else navigate("/resumes");
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h1 className="mr-auto">{job ? `${job.title} · ${job.employer}` : "Resume preview"}</h1>
          <fieldset aria-label="Editor mode">
            <Button disabled={busy} aria-pressed={false} onClick={() => setPreviewMode(false)}>
              Edit
            </Button>
            <Button disabled={busy} aria-pressed={true} onClick={() => void showPreview(true)}>
              Preview
            </Button>
          </fieldset>
          <Button disabled={busy || !pdfUrl} onClick={() => void downloadPdf()}>
            Download PDF
          </Button>
        </header>
        {previewContent}
      </main>
    );
  if ((!base && !job) || !state) return <output className="p-6">Loading resume…</output>;
  const title = base ? "Base resume" : `${job?.title} · ${job?.employer}`;
  const document = state.document;
  const targets = document.sections.experience.items
    .filter((e) => !e.hidden)
    .map((e) => ({ id: e.id, label: `${e.company} · ${e.position}` }));
  return (
    <main className="flex min-h-0 flex-col h-[calc(100dvh-5rem)] p-4 gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Back"
          onClick={() => {
            if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
            else navigate("/resumes");
          }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h1 className="sr-only">{title}</h1>
        <SearchableDropdown
          value={jobId}
          options={[
            ...(!base ? [{ value: jobId, label: title }] : []),
            { value: "base", label: "Base resume" },
            ...resumes
              .filter((resume) => resume.jobId !== jobId)
              .map((resume) => ({
                value: resume.jobId,
                label: `${resume.title} · ${resume.employer}`,
              })),
          ]}
          onValueChange={switchResume}
          allowCustomValue={false}
          ariaLabel={`Switch resume: ${title}`}
          placeholder="Select a resume"
          searchPlaceholder="Search resumes…"
          triggerClassName="mr-auto min-w-0 max-w-full font-semibold"
          disabled={busy}
        />
        <output className="text-xs text-muted-foreground">
          {rendering ? "Rendering PDF…" : status}
        </output>
        <Button size="sm" variant="outline" disabled={busy || !undoStack.length} onClick={undo}>
          Undo
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void flush()}>
          Save now
        </Button>
        {!base && job && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setResetOpen(true)}>
            Reset to base
          </Button>
        )}
        {importControls}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title="Save, render and download the PDF"
          onClick={() => void downloadPdf()}
        >
          Download PDF
        </Button>
      </header>
      <div className="flex gap-2 xl:hidden" role="tablist" aria-label="Resume workspace">
        {(base ? ["editor", "library"] : ["chat", "editor", "library"]).map((name) => (
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
              ? base
                ? "Library"
                : "Library & match"
              : name === "editor" && suggestions.length
                ? `Editor (${suggestions.length})`
                : name[0].toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </div>
      <div
        className={`grid min-h-0 flex-1 gap-4 ${base ? "xl:grid-cols-[minmax(360px,5fr)_minmax(260px,3fr)]" : "xl:grid-cols-[minmax(260px,3fr)_minmax(360px,5fr)_minmax(260px,3fr)]"}`}
      >
        {!base && job && (
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
                const ref = readFocusTransfer(e.dataTransfer.getData(FOCUS_TRANSFER_TYPE));
                if (ref) addFocusRef(ref);
                return;
              }
              if (!e.dataTransfer.types.includes(BULLET_TRANSFER_TYPE)) return;
              e.preventDefault();
              const bullet = readBulletTransfer(e.dataTransfer.getData(BULLET_TRANSFER_TYPE));
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
                          current.filter((item) => focusKey(item) !== focusKey(ref)),
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
                        setReferences((current) => current.filter((item) => item.id !== b.id))
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
        )}
        <section
          ref={editorPane}
          id="cowork-panel-editor"
          role="tabpanel"
          aria-labelledby="cowork-tab-editor"
          aria-label="Resume editor"
          className={`${tab === "editor" ? "block" : "hidden"} xl:block min-h-0 min-w-0 overflow-auto [scrollbar-gutter:stable] border rounded-md bg-[#e4e5e7] p-3`}
        >
          <div className="mb-3 flex items-center gap-2">
            <fieldset
              aria-label="Editor mode"
              className="inline-flex rounded-md border bg-background p-0.5"
            >
              <Button
                size="sm"
                className="h-7"
                variant={preview ? "ghost" : "default"}
                aria-pressed={!preview}
                disabled={busy}
                onClick={() => setPreviewMode(false)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                className="h-7"
                variant={preview ? "default" : "ghost"}
                aria-pressed={preview}
                disabled={busy}
                onClick={renderPreview}
                title="Render the PDF (click again to refresh)"
              >
                Preview
              </Button>
            </fieldset>
          </div>
          {preview ? (
            previewContent
          ) : (
            <ResumeEditor
              library={library}
              contactsFromLibrary={!base}
              onSaveLineToLibrary={
                base ? undefined : (id, text) => void saveToLibrary(id, { text })
              }
              onSaveEntryToLibrary={
                base ? undefined : (section, itemId) => void saveEntryToLibrary(section, itemId)
              }
              disabled={busy}
              document={document}
              onChange={(next) => edit(next, true)}
              onAskAi={
                base
                  ? undefined
                  : (ref) => {
                      addFocusRef(ref);
                      setTab("chat");
                      // The chat panel may only become visible after this render.
                      setTimeout(() =>
                        chat.current?.querySelector<HTMLElement>("textarea")?.focus(),
                      );
                    }
              }
              suggestions={suggestions}
              onAccept={(items) => void acceptSuggestions(items)}
              rejectionReasons={rejectionReasons}
              onDismiss={(ids) =>
                setSuggestions((current) => current.filter((s) => !ids.includes(s.id)))
              }
            />
          )}
        </section>
        <section
          id="cowork-panel-library"
          role="tabpanel"
          aria-labelledby="cowork-tab-library"
          aria-label="Candidate library"
          className={`${tab === "library" ? "block" : "hidden"} xl:block min-h-0 min-w-0 overflow-auto border rounded-md p-3`}
        >
          {!base && job && (
            <>
              <div className="flex gap-1 mb-3" role="tablist" aria-label="Library and job match">
                {(
                  [
                    ["library", "Library"],
                    ["match", "Job match"],
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
                      if (editorPane.current) focusResumePart(editorPane.current, ref);
                    });
                  }}
                />
              </div>
            </>
          )}
          <fieldset disabled={busy} hidden={rightTab !== "library"} className="min-w-0">
            <CandidateLibrary
              jobId={base ? undefined : jobId}
              items={library}
              onItemsChange={setLibrary}
              onSync={base ? undefined : syncLibrary}
              frozen={job?.status === "applied" || job?.status === "in_progress"}
              document={base ? undefined : document}
              onDocumentChange={
                base
                  ? undefined
                  : (update) => {
                      if (!busy && latest.current) edit(update(latest.current.document));
                    }
              }
              onReferenceBullet={base ? undefined : reference}
            />
          </fieldset>
        </section>
      </div>
      <AlertDialog
        open={switchTarget !== null}
        onOpenChange={(open) => {
          if (!open && !switching.current) setSwitchTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Save your changes before switching to another resume.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void saveAndSwitch()}>
              Save and switch
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={conflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume changed elsewhere</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits are still here. Keep mine saves them against the latest revision. Use
              latest loads the server copy; Undo restores your edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => void resolveConflict(false)}>
              Use latest
            </Button>
            <Button onClick={() => void resolveConflict(true)}>Keep mine</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to base?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards your edits to this job’s resume and rebuilds it from your base resume
              and this job’s tailoring. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resetToBase()}>Reset resume</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
