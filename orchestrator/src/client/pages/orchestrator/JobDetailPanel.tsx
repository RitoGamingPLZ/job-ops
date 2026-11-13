import * as api from "@client/api";
import {
  JobBriefPane,
  JobDescriptionPanel,
  JobHeader,
} from "@client/components";
import { JobDetailsEditDrawer } from "@client/components/JobDetailsEditDrawer";
import { OpenJobListingButton } from "@client/components/OpenJobListingButton";
import { usePrepareResumeMutation } from "@client/hooks/queries/useJobMutations";
import {
  getResumeState,
  isPdfRegenerating,
  isPdfStale,
  PDF_REGENERATING_MESSAGE,
  STALE_PDF_MESSAGE,
} from "@client/lib/pdf-freshness";
import { resumeEditorLocation } from "@client/lib/resume-opening";
import type { Job, JobListItem } from "@shared/types.js";
import { isTargeted } from "@shared/types.js";
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Copy,
  Edit2,
  FileText,
  Loader2,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { parseJobBrief } from "@/client/components/JobBriefPane";
import { RegenerateResumeButton } from "@/client/components/RegenerateResumeButton";
import { showErrorToast } from "@/client/lib/error-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, copyTextToClipboard, formatJobForWebhook } from "@/lib/utils";
import type { FilterTab } from "./constants";
import type { SelectedJobLoadState } from "./useOrchestratorData";

interface JobDetailPanelProps {
  activeTab: FilterTab;
  activeJobs: JobListItem[];
  selectedJob: Job | null;
  selectedJobListItem: JobListItem | null;
  selectedJobLoadState: SelectedJobLoadState;
  onSelectJobId: (jobId: string | null) => void;
  onJobUpdated: (job?: Job) => Promise<void>;
  onPauseRefreshChange?: (paused: boolean) => void;
  onRetrySelectedJob: () => void;
}

const statusTone: Record<
  Job["status"],
  {
    shell: string;
    eyebrow: string;
    icon: string;
    button?: string;
  }
> = {
  discovered: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-sky-500/70",
  },
  processing: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-amber-500/70",
  },
  ready: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-emerald-500/70",
    button: "bg-emerald-600 text-white hover:bg-emerald-500",
  },
  applied: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-teal-500/70",
    button: "bg-teal-600 text-white hover:bg-teal-500",
  },
  in_progress: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-cyan-500/70",
  },
  skipped: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-rose-500/70",
  },
  expired: {
    shell: "border-border/45 bg-muted/10",
    eyebrow: "text-muted-foreground",
    icon: "bg-slate-500/70",
  },
};

const getPrimaryAction = (job: Job): string =>
  job.status === "processing" && isTargeted(job)
    ? "Preparing resume…"
    : isTargeted(job)
      ? "Targeted ✓"
      : "Target";

const Stat: React.FC<{
  label: string;
  value?: string | null;
  tone?: "blue" | "green" | "neutral";
}> = ({ label, value, tone = "neutral" }) => {
  if (!value) return null;
  const toneClassName =
    tone === "blue"
      ? "border-sky-400/10 bg-muted/5"
      : tone === "green"
        ? "border-emerald-400/10 bg-muted/5"
        : "border-border/35 bg-muted/5";
  return (
    <div className={cn("min-w-0 rounded-md border px-3 py-2", toneClassName)}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-foreground/85">
        {value}
      </div>
    </div>
  );
};

export const JobDetailPanel: React.FC<JobDetailPanelProps> = ({
  activeTab,
  activeJobs,
  selectedJob,
  selectedJobListItem,
  selectedJobLoadState,
  onSelectJobId,
  onJobUpdated,
  onPauseRefreshChange,
  onRetrySelectedJob,
}) => {
  const [isTargeting, setIsTargeting] = useState(false);
  const [isEditDetailsOpen, setIsEditDetailsOpen] = useState(false);
  const previousSelectionKeyRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const prepareResumeMutation = usePrepareResumeMutation();
  const brief = parseJobBrief(selectedJob?.jobBrief || null);

  useEffect(() => {
    const selection = selectedJob ?? selectedJobListItem;
    const currentSelectionKey = `${activeTab}:${selection?.id ?? ""}`;
    if (previousSelectionKeyRef.current === currentSelectionKey) return;
    previousSelectionKeyRef.current = currentSelectionKey;
    setIsEditDetailsOpen(false);
    onPauseRefreshChange?.(false);
  }, [activeTab, selectedJob, selectedJobListItem, onPauseRefreshChange]);

  useEffect(() => {
    return () => onPauseRefreshChange?.(false);
  }, [onPauseRefreshChange]);

  const handleJobMoved = useCallback(
    (jobId: string) => {
      const currentIndex = activeJobs.findIndex((job) => job.id === jobId);
      const nextJob =
        activeJobs[currentIndex + 1] || activeJobs[currentIndex - 1];
      onSelectJobId(nextJob?.id ?? null);
    },
    [activeJobs, onSelectJobId],
  );

  const handleSaveDescription = useCallback(
    async (jobDescription: string) => {
      if (!selectedJob) return;
      await api.updateJob(selectedJob.id, { jobDescription });
      await onJobUpdated();
    },
    [onJobUpdated, selectedJob],
  );

  const openEditDetails = useCallback(() => {
    window.setTimeout(() => setIsEditDetailsOpen(true), 0);
  }, []);

  const handleCopyInfo = useCallback(async () => {
    if (!selectedJob) return;

    try {
      await copyTextToClipboard(formatJobForWebhook(selectedJob));
      toast.success("Copied job info");
    } catch {
      toast.error("Could not copy job info");
    }
  }, [selectedJob]);

  const handlePrimaryAction = useCallback(async () => {
    if (!selectedJob || isTargeting) return;
    try {
      setIsTargeting(true);
      const targeted = isTargeted(selectedJob);
      const updated = await (targeted
        ? api.untargetJob(selectedJob.id)
        : api.targetJob(selectedJob.id));
      toast.success(targeted ? "Job untargeted" : "Job targeted");
      if (activeTab === "discovered" && !targeted)
        handleJobMoved(selectedJob.id);
      await onJobUpdated(updated);
    } catch (error) {
      showErrorToast(error, "Failed to update target");
    } finally {
      setIsTargeting(false);
    }
  }, [activeTab, handleJobMoved, isTargeting, onJobUpdated, selectedJob]);

  const handleOpenPdf = useCallback(() => {
    if (!selectedJob) return;
    navigate(
      resumeEditorLocation({ kind: "job", jobId: selectedJob.id }, "preview"),
    );
  }, [navigate, selectedJob]);

  const handlePrepareResume = useCallback(() => {
    if (!selectedJob) return;
    prepareResumeMutation.mutate(selectedJob.id, {
      onError: (error) => showErrorToast(error, "Failed to prepare resume"),
    });
  }, [prepareResumeMutation, selectedJob]);

  const handleBlacklistEmployer = useCallback(async () => {
    if (!selectedJob) return;
    try {
      const { job, hiddenCount } = await api.blacklistJobEmployer(
        selectedJob.id,
      );
      toast.success(
        `Won't ingest jobs from ${selectedJob.employer} anymore` +
          (hiddenCount > 0
            ? ` — hid ${hiddenCount} existing job post${hiddenCount === 1 ? "" : "s"}`
            : ""),
      );
      if (job.status === "skipped") handleJobMoved(selectedJob.id);
      await onJobUpdated(job);
    } catch (error) {
      showErrorToast(error, "Failed to blacklist company");
    }
  }, [handleJobMoved, onJobUpdated, selectedJob]);

  if (!selectedJob) {
    if (selectedJobListItem) {
      const isLoadingDetails = selectedJobLoadState !== "error";
      const listingUrl =
        selectedJobListItem.applicationLink || selectedJobListItem.jobUrl;
      const summaryPdfMessage = isPdfRegenerating(selectedJobListItem)
        ? PDF_REGENERATING_MESSAGE
        : isPdfStale(selectedJobListItem)
          ? STALE_PDF_MESSAGE
          : null;

      return (
        <div
          aria-busy={isLoadingDetails}
          className="flex min-h-0 min-w-0 flex-1 flex-col p-1 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:self-start lg:overflow-y-auto"
        >
          <JobHeader
            job={selectedJobListItem}
            jobCTA={
              listingUrl ? (
                <OpenJobListingButton href={listingUrl} />
              ) : undefined
            }
          />

          <div className="flex min-w-0 flex-col gap-4 rounded-lg rounded-t-none border border-t-0 border-border/50 bg-card p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat
                label="Location"
                value={selectedJobListItem.location}
                tone="blue"
              />
              <Stat
                label="Salary"
                value={selectedJobListItem.salary}
                tone="green"
              />
              <Stat label="Function" value={selectedJobListItem.jobFunction} />
              <Stat label="Type" value={selectedJobListItem.jobType} />
            </div>

            {summaryPdfMessage ? (
              <p className="text-xs text-muted-foreground">
                {summaryPdfMessage}
              </p>
            ) : null}

            {selectedJobLoadState === "error" ? (
              <Alert>
                <CircleAlert />
                <AlertTitle>Couldn&apos;t load job details</AlertTitle>
                <AlertDescription className="flex flex-col items-start gap-3">
                  <p>
                    The summary is still available. Try loading the details
                    again.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRetrySelectedJob}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <output
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  Loading full job details…
                </output>
                <div
                  className="flex flex-col gap-4"
                  aria-hidden="true"
                  data-testid="job-detail-skeleton"
                >
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                  </div>
                  <Skeleton className="h-24 w-full" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/50 bg-muted/20">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            No job selected
          </div>
          <p className="max-w-[220px] text-xs text-muted-foreground/70">
            Select a job to see its brief and resume.
          </p>
        </div>
      </div>
    );
  }

  const resumeState = getResumeState(selectedJob);
  const primaryBusy = isTargeting;
  const tone = statusTone[selectedJob.status];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto p-1">
      <JobHeader
        job={selectedJob}
        onCheckSponsor={async () => {
          await api.checkSponsor(selectedJob.id);
          await onJobUpdated();
        }}
        jobCTA={
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:shrink-0">
            <Button
              size="sm"
              onClick={() => void handlePrimaryAction()}
              disabled={
                primaryBusy ||
                !["discovered", "processing", "ready"].includes(
                  selectedJob.status,
                ) ||
                (selectedJob.status === "processing" && isTargeted(selectedJob))
              }
              className={cn(
                "col-start-1 row-start-2 w-full min-w-0 justify-start sm:w-auto sm:justify-center",
                tone.button,
              )}
            >
              {primaryBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : selectedJob.status === "discovered" ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {getPrimaryAction(selectedJob)}
            </Button>

            {resumeState === "available" && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to={resumeEditorLocation(
                      { kind: "job", jobId: selectedJob.id },
                      "edit",
                    )}
                  >
                    Open resume
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPdfRegenerating(selectedJob)}
                  onClick={handleOpenPdf}
                >
                  Preview PDF
                </Button>
              </>
            )}
            {isTargeted(selectedJob) && resumeState === "available" && (
              <RegenerateResumeButton
                job={selectedJob}
                disabled={primaryBusy || prepareResumeMutation.isPending}
              />
            )}
            {resumeState === "unprepared" && (
              <Button
                size="sm"
                variant="outline"
                title="Resume not prepared yet"
                disabled={prepareResumeMutation.isPending}
                onClick={handlePrepareResume}
              >
                Prepare resume
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleBlacklistEmployer()}
            >
              <Ban className="h-3.5 w-3.5" />
              Blacklist company
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="More actions"
                  className="col-start-2 row-span-2 row-start-1 self-center"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={openEditDetails}>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleCopyInfo()}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy job info
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex min-w-0 flex-col rounded-lg rounded-t-none border border-t-0 border-border/50 bg-card p-4">
        <div className="space-y-4">
          {selectedJob.generationError &&
            selectedJob.status !== "processing" && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Resume generation failed</AlertTitle>
                <AlertDescription>
                  {selectedJob.generationError}
                </AlertDescription>
              </Alert>
            )}

          {!brief && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Location" value={selectedJob.location} tone="blue" />
              <Stat label="Salary" value={selectedJob.salary} tone="green" />
              <Stat label="Level" value={selectedJob.jobLevel} />
              <Stat label="Function" value={selectedJob.jobFunction} />
              <Stat label="Type" value={selectedJob.jobType} />
              <Stat label="Discipline" value={selectedJob.disciplines} />
            </div>
          )}

          <JobBriefPane job={selectedJob} />
          <JobDescriptionPanel
            description={selectedJob.jobDescription}
            jobUrl={selectedJob.jobUrl}
            onSave={handleSaveDescription}
          />
        </div>

        <JobDetailsEditDrawer
          open={isEditDetailsOpen}
          onOpenChange={setIsEditDetailsOpen}
          job={selectedJob}
          onJobUpdated={onJobUpdated}
        />
      </div>
    </div>
  );
};
