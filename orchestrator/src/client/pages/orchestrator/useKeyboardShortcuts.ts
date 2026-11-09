import * as api from "@client/api";
import { useHotkeys } from "@client/hooks/useHotkeys";
import { SHORTCUTS } from "@client/lib/shortcut-map";
import type { JobListItem } from "@shared/types.js";
import { isTargeted } from "@shared/types.js";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import type { FilterTab } from "./constants";
import { tabs } from "./constants";

type UseKeyboardShortcutsArgs = {
  isAnyModalOpen: boolean;
  isAnyModalOpenExcludingCommandBar: boolean;
  isAnyModalOpenExcludingHelp: boolean;
  activeTab: FilterTab;
  activeJobs: JobListItem[];
  selectedJobId: string | null;
  selectedJob: JobListItem | null;
  selectedJobSummary: JobListItem | null;
  selectedJobIds: Set<string>;
  isDesktop: boolean;
  handleSelectJobId: (id: string | null) => void;
  requestScrollToJob: (id: string, opts?: { ensureSelected?: boolean }) => void;
  setActiveTab: (tab: FilterTab) => void;
  setIsCommandBarOpen: (open: boolean) => void;
  setIsHelpDialogOpen: (updater: (prev: boolean) => boolean) => void;
  clearSelection: () => void;
  toggleSelectJob: (id: string) => void;
  targetSelectedJobs: () => Promise<void>;
  loadJobs: () => Promise<void>;
};

export function useKeyboardShortcuts(args: UseKeyboardShortcutsArgs): void {
  const {
    isAnyModalOpen,
    isAnyModalOpenExcludingCommandBar,
    isAnyModalOpenExcludingHelp,
    activeTab,
    activeJobs,
    selectedJobId,
    selectedJob,
    selectedJobSummary,
    selectedJobIds,
    isDesktop: _isDesktop,
    handleSelectJobId,
    requestScrollToJob,
    setActiveTab,
    setIsCommandBarOpen,
    setIsHelpDialogOpen,
    clearSelection,
    toggleSelectJob,
    targetSelectedJobs,
    loadJobs,
  } = args;

  const shortcutActionInFlight = useRef(false);
  const navigateJobList = useCallback(
    (direction: 1 | -1) => {
      if (activeJobs.length === 0) return;
      const currentIndex = selectedJobId
        ? activeJobs.findIndex((j) => j.id === selectedJobId)
        : -1;
      const nextIndex = Math.max(
        0,
        Math.min(activeJobs.length - 1, currentIndex + direction),
      );
      const nextJob = activeJobs[nextIndex];
      if (nextJob && nextJob.id !== selectedJobId) {
        handleSelectJobId(nextJob.id);
        requestScrollToJob(nextJob.id);
      }
    },
    [activeJobs, selectedJobId, handleSelectJobId, requestScrollToJob],
  );

  const navigateTab = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
      setActiveTab(tabs[nextIndex].id);
    },
    [activeTab, setActiveTab],
  );

  const selectNextAfterAction = useCallback(
    (movedJobId: string) => {
      const idx = activeJobs.findIndex((j) => j.id === movedJobId);
      const next = activeJobs[idx + 1] || activeJobs[idx - 1];
      handleSelectJobId(next?.id ?? null);
    },
    [activeJobs, handleSelectJobId],
  );

  useHotkeys(
    {
      // ── Navigation ──────────────────────────────────────────────────────
      [SHORTCUTS.nextJob.key]: (e) => {
        e.preventDefault();
        navigateJobList(1);
      },
      [SHORTCUTS.nextJobArrow.key]: (e) => {
        e.preventDefault();
        navigateJobList(1);
      },
      [SHORTCUTS.prevJob.key]: (e) => {
        e.preventDefault();
        navigateJobList(-1);
      },
      [SHORTCUTS.prevJobArrow.key]: (e) => {
        e.preventDefault();
        navigateJobList(-1);
      },

      // ── Tab switching ───────────────────────────────────────────────────
      [SHORTCUTS.tabDiscovered.key]: () => setActiveTab("discovered"),
      [SHORTCUTS.tabAll.key]: () => setActiveTab("all"),
      [SHORTCUTS.prevTabArrow.key]: (e) => {
        e.preventDefault();
        navigateTab(-1);
      },
      [SHORTCUTS.nextTabArrow.key]: (e) => {
        e.preventDefault();
        navigateTab(1);
      },

      // ── Context actions ─────────────────────────────────────────────────
      [SHORTCUTS.moveToReady.key]: () => {
        if (shortcutActionInFlight.current) return;
        if (selectedJobIds.size > 0) {
          void targetSelectedJobs();
          return;
        }
        if (
          !selectedJob ||
          !["discovered", "processing", "ready"].includes(selectedJob.status)
        )
          return;
        const targeted = isTargeted(selectedJob);
        if (targeted && selectedJob.status === "processing") return;
        shortcutActionInFlight.current = true;
        const jobId = selectedJob.id;
        void (targeted ? api.untargetJob(jobId) : api.targetJob(jobId))
          .then(async () => {
            toast.success(targeted ? "Job untargeted" : "Job targeted");
            if (activeTab === "discovered" && !targeted)
              selectNextAfterAction(jobId);
            await loadJobs();
          })
          .catch((error: unknown) =>
            showErrorToast(error, "Failed to update target"),
          )
          .finally(() => {
            shortcutActionInFlight.current = false;
          });
      },

      [SHORTCUTS.openListing.key]: () => {
        const listingJob = selectedJob ?? selectedJobSummary;
        if (!listingJob) return;
        const link = listingJob.applicationLink || listingJob.jobUrl;
        if (link) window.open(link, "_blank", "noopener,noreferrer");
      },

      [SHORTCUTS.toggleSelect.key]: () => {
        if (!selectedJobId) return;
        toggleSelectJob(selectedJobId);
      },

      [SHORTCUTS.clearSelection.key]: () => {
        if (selectedJobIds.size > 0) clearSelection();
      },
    },
    { enabled: !isAnyModalOpen },
  );

  useHotkeys(
    {
      // ── Search ──────────────────────────────────────────────────────────
      [SHORTCUTS.searchSlash.key]: (e) => {
        e.preventDefault();
        setIsCommandBarOpen(true);
      },
    },
    { enabled: !isAnyModalOpenExcludingCommandBar },
  );

  useHotkeys(
    {
      // ── Help ────────────────────────────────────────────────────────────
      [SHORTCUTS.help.key]: (e) => {
        e.preventDefault();
        setIsHelpDialogOpen((prev) => !prev);
      },
    },
    { enabled: !isAnyModalOpenExcludingHelp },
  );
}
