import { type LogEventFormValues, LogEventModal } from "@client/components/LogEventModal";
import { PageHeader, PageMain } from "@client/components/layout";
import {
  type ApplicationStage,
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS,
  type BoardColumn,
  boardColumnForStage,
  isTargeted,
  type JobListItem,
  STAGE_LABELS,
  type StageEvent,
  technicalRound,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownAZ, ChevronLeft, ChevronRight, Columns3, Plus } from "lucide-react";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { invalidateJobData } from "@/client/hooks/queries/invalidate";
import {
  useGenerateMissingResumesMutation,
  usePrepareResumeMutation,
} from "@/client/hooks/queries/useJobMutations";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { celebrateOffer } from "@/client/lib/celebrate";
import { showErrorToast } from "@/client/lib/error-toast";
import { logJobStageEvent } from "@/client/lib/logJobStageEvent";
import { needsRender } from "@/client/lib/pdf-freshness";
import { queryKeys } from "@/client/lib/queryKeys";
import { resumeEditorLocation } from "@/client/lib/resume-opening";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import * as api from "../api";
import { BoardStageIcon } from "./BoardStageIcon";
import { InProgressBoardCard } from "./InProgressBoardCard";
import { IN_PROGRESS_BOARD_APPLIED_COLLAPSED_STORAGE_KEY } from "./orchestrator/constants";

type BoardCard = {
  job: JobListItem;
  stage: BoardColumn;
  currentStage: ApplicationStage;
  round: number;
  latestEventAt: number | null;
};

const sortByRecent = (a: BoardCard, b: BoardCard) => {
  if (a.latestEventAt != null && b.latestEventAt != null) {
    return b.latestEventAt - a.latestEventAt;
  }
  if (a.latestEventAt != null) return -1;
  if (b.latestEventAt != null) return 1;
  return Date.parse(b.job.discoveredAt) - Date.parse(a.job.discoveredAt);
};

const sortByTitle = (a: BoardCard, b: BoardCard) => a.job.title.localeCompare(b.job.title);

const sortByCompany = (a: BoardCard, b: BoardCard) => a.job.employer.localeCompare(b.job.employer);

const BOARD_STAGES = BOARD_COLUMNS;

const getAppliedCollapsedStorageKey = () =>
  api.getAuthScopedStorageKey(IN_PROGRESS_BOARD_APPLIED_COLLAPSED_STORAGE_KEY);

const readAppliedCollapsed = () => localStorage.getItem(getAppliedCollapsedStorageKey()) === "1";

const resolveCurrentStage = (
  events: StageEvent[] | null,
): { stage: ApplicationStage; latestEventAt: number | null } => {
  const latest = events?.at(-1) ?? null;
  if (latest) {
    return { stage: latest.toStage, latestEventAt: latest.occurredAt };
  }
  return { stage: "applied", latestEventAt: null };
};

const canDrop = (from: BoardColumn, to: BoardColumn): to is Exclude<BoardColumn, "targeted"> =>
  from !== to && to !== "targeted" && (from !== "targeted" || to === "applied");

export const InProgressBoardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const jobPageLinkState = React.useMemo(
    () => ({ jobPageBackTo: `${location.pathname}${location.search}` }),
    [location.pathname, location.search],
  );

  const [dragging, setDragging] = React.useState<{
    jobId: string;
    fromStage: BoardColumn;
  } | null>(null);
  const [dropTargetStage, setDropTargetStage] = React.useState<BoardColumn | null>(null);
  const [movingJobId, setMovingJobId] = React.useState<string | null>(null);
  const [sortMode, setSortMode] = React.useState<"updated" | "title" | "company">("updated");
  const [logEventTarget, setLogEventTarget] = React.useState<{
    job: JobListItem;
    stage: ApplicationStage;
  } | null>(null);
  const [isAppliedCollapsed, setIsAppliedCollapsed] = React.useState(readAppliedCollapsed);

  React.useEffect(() => {
    localStorage.setItem(getAppliedCollapsedStorageKey(), isAppliedCollapsed ? "1" : "0");
  }, [isAppliedCollapsed]);

  const activeBatch = React.useRef<{
    jobIds: Set<string>;
    expiresAt: number;
  } | null>(null);

  const boardQuery = useQuery({
    queryKey: queryKeys.jobs.inProgressBoard(),
    refetchInterval: (query) => {
      const cards = query.state.data ?? [];
      const batch = activeBatch.current;
      if (
        batch &&
        (Date.now() >= batch.expiresAt ||
          !cards.some(
            ({ job }) =>
              batch.jobIds.has(job.id) &&
              (job.status === "processing" || job.pdfRegenerating || needsRender(job)),
          ))
      ) {
        activeBatch.current = null;
      }
      return activeBatch.current ||
        cards.some(({ job }) => job.status === "processing" || job.pdfRegenerating)
        ? 2000
        : false;
    },
    queryFn: async () => {
      const response = await api.getJobs({
        statuses: ["discovered", "processing", "ready", "applied", "in_progress"],
        view: "list",
      });

      // ponytail: add a server targeted=1 filter if the discovered list grows.
      const jobs = response.jobs.filter(
        (job) => isTargeted(job) || job.status === "applied" || job.status === "in_progress",
      );
      const eventResults = await Promise.allSettled(
        jobs.map(async (job) => {
          return { events: await api.getJobStageEvents(job.id) };
        }),
      );

      return jobs.map((job, index) => {
        const result = eventResults[index];
        const events =
          result?.status === "fulfilled"
            ? [...result.value.events].sort((a, b) => a.occurredAt - b.occurredAt)
            : null;
        const resolved = resolveCurrentStage(events);
        return {
          job,
          stage: isTargeted(job) ? ("targeted" as const) : boardColumnForStage(resolved.stage),
          currentStage: resolved.stage,
          round: technicalRound(events ?? []),
          latestEventAt: resolved.latestEventAt,
        };
      });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: ({ jobId, toStage }: { jobId: string; toStage: ApplicationStage }) =>
      api.transitionJobStage(jobId, {
        toStage,
        metadata: {
          actor: "user",
          eventType: "status_update",
          eventLabel: `Moved to ${STAGE_LABELS[toStage]}`,
          reasonCode: "in_progress_board_drag",
        },
      }),
  });

  useQueryErrorToast(boardQuery.error, "Failed to load in-progress board");

  const cards = boardQuery.data ?? [];
  const isLoading = boardQuery.isPending;

  const lanes = React.useMemo(() => {
    const sortFn =
      sortMode === "title" ? sortByTitle : sortMode === "company" ? sortByCompany : sortByRecent;

    const grouped = Object.fromEntries(
      BOARD_COLUMNS.map((column) => [column, []]),
    ) as unknown as Record<BoardColumn, BoardCard[]>;

    for (const card of cards) {
      grouped[card.stage].push(card);
    }

    for (const stage of BOARD_STAGES) {
      grouped[stage].sort(sortFn);
    }

    return grouped;
  }, [cards, sortMode]);

  const handleDropToStage = React.useCallback(
    async (toStage: BoardColumn) => {
      if (!dragging || !canDrop(dragging.fromStage, toStage)) {
        setDropTargetStage(null);
        return;
      }

      const { jobId } = dragging;
      const previousCards =
        queryClient.getQueryData<BoardCard[]>(queryKeys.jobs.inProgressBoard()) ?? [];
      const nowEpoch = Math.floor(Date.now() / 1000);

      setMovingJobId(jobId);
      queryClient.setQueryData<BoardCard[]>(queryKeys.jobs.inProgressBoard(), (current) =>
        (current ?? []).map((card) =>
          card.job.id === jobId ? { ...card, stage: toStage, latestEventAt: nowEpoch } : card,
        ),
      );

      try {
        if (dragging.fromStage === "targeted") {
          await api.markAsApplied(jobId);
        } else {
          await transitionMutation.mutateAsync({ jobId, toStage });
        }
        toast.success(`Moved to ${BOARD_COLUMN_LABELS[toStage]}`);
        await invalidateJobData(queryClient, jobId);
        if (toStage === "offer") {
          celebrateOffer();
        }
      } catch (error) {
        queryClient.setQueryData(queryKeys.jobs.inProgressBoard(), previousCards);
        showErrorToast(error, "Failed to move stage");
      } finally {
        setMovingJobId(null);
        setDragging(null);
        setDropTargetStage(null);
      }
    },
    [dragging, queryClient, transitionMutation],
  );

  const generateMissingMutation = useGenerateMissingResumesMutation();
  // The server may also select current PDFs without a saved resume document.
  const missingResumeCount = lanes.targeted.filter(
    ({ job }) => job.status !== "processing" && !job.pdfRegenerating && needsRender(job),
  ).length;
  const handleGenerateMissing = () =>
    generateMissingMutation.mutate(undefined, {
      onSuccess: ({ jobIds, alreadyRunning }) => {
        if (alreadyRunning) {
          toast.success("Already running");
          return;
        }
        if (jobIds.length === 0) {
          toast.info("No resumes need generating");
          return;
        }
        activeBatch.current = {
          jobIds: new Set(jobIds),
          expiresAt: Date.now() + jobIds.length * 5 * 60_000,
        };
        // Re-evaluate polling even if invalidation landed before work started.
        void boardQuery.refetch();
        toast.success(
          `Generating ${jobIds.length} resume${jobIds.length === 1 ? "" : "s"} one at a time`,
        );
      },
      onError: (error) => showErrorToast(error, "Failed to generate resumes"),
    });

  const prepareResumeMutation = usePrepareResumeMutation();
  const isResumeBusy = (jobId: string) =>
    prepareResumeMutation.isPending && prepareResumeMutation.variables === jobId;

  const handlePreviewPdf = (job: JobListItem) =>
    navigate(resumeEditorLocation({ kind: "job", jobId: job.id }, "preview"));

  const handlePrepareResume = (job: JobListItem) =>
    prepareResumeMutation.mutate(job.id, {
      onError: (error) => showErrorToast(error, "Failed to prepare resume"),
    });

  const handleTargetAction = async (job: JobListItem) => {
    setMovingJobId(job.id);
    try {
      await api.untargetJob(job.id);
      await invalidateJobData(queryClient, job.id);
      toast.success("Job untargeted");
    } catch (error) {
      showErrorToast(error, "Failed to untarget job");
    } finally {
      setMovingJobId(null);
    }
  };

  const handleBoardLogEvent = React.useCallback(
    async (values: LogEventFormValues) => {
      if (!logEventTarget) return;

      const { job, stage: currentStage } = logEventTarget;

      try {
        const { effectiveStage } = await logJobStageEvent({
          jobId: job.id,
          currentStage,
          values,
          manualStageReasonCode: "in_progress_board_menu",
        });

        await invalidateJobData(queryClient, job.id);
        setLogEventTarget(null);
        toast.success("Event logged");

        if (effectiveStage === "offer") {
          celebrateOffer();
        }
      } catch (error) {
        showErrorToast(error, "Failed to log event");
      }
    },
    [logEventTarget, queryClient],
  );

  return (
    <>
      <PageHeader
        icon={Columns3}
        title="In Progress Board"
        subtitle="Kanban view of application stages"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={sortMode}
              onValueChange={(value) => setSortMode(value as "updated" | "title" | "company")}
            >
              <SelectTrigger className="h-8 w-[132px] text-xs">
                <ArrowDownAZ className="mr-1.5 h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Recent</SelectItem>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => navigate("/jobs/discovered")}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        }
      />
      <PageMain className="flex h-[calc(100dvh-5rem)] max-w-[1600px] flex-col">
        {isLoading ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
            Loading board...
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-x-auto pb-2">
            <div className="flex h-full min-w-max items-stretch gap-2">
              {BOARD_STAGES.map((stage) => {
                const laneCards = lanes[stage];
                const isCollapsedApplied = stage === "applied" && isAppliedCollapsed;
                return (
                  <section
                    key={stage}
                    aria-label={`${BOARD_COLUMN_LABELS[stage]} lane`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!dragging || !canDrop(dragging.fromStage, stage)) return;
                      setDropTargetStage(stage);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleDropToStage(stage);
                    }}
                    onDragLeave={() => {
                      if (dropTargetStage === stage) {
                        setDropTargetStage(null);
                      }
                    }}
                    className={cn(
                      "flex h-full flex-col rounded-xl bg-muted/40 transition-colors",
                      isCollapsedApplied ? "w-11" : "w-[320px]",
                      dropTargetStage === stage && "bg-primary/10 ring-1 ring-primary/40",
                    )}
                  >
                    <header
                      className={cn(
                        "flex items-center px-3 pt-3 pb-1.5",
                        isCollapsedApplied ? "flex-col gap-2" : "flex-wrap gap-2",
                      )}
                    >
                      {stage === "applied" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="-ml-1 h-6 w-6 shrink-0 text-muted-foreground"
                          aria-label={
                            isAppliedCollapsed ? "Expand Applied lane" : "Collapse Applied lane"
                          }
                          onClick={() => setIsAppliedCollapsed((collapsed) => !collapsed)}
                        >
                          {isAppliedCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronLeft className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      <BoardStageIcon stage={stage} />
                      <h2
                        className={cn(
                          "text-[13px] font-medium text-foreground",
                          isCollapsedApplied && "[writing-mode:vertical-rl]",
                        )}
                      >
                        {BOARD_COLUMN_LABELS[stage]}
                      </h2>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {laneCards.length}
                      </span>
                      {stage === "targeted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-full text-xs"
                          disabled={missingResumeCount === 0 || generateMissingMutation.isPending}
                          onClick={handleGenerateMissing}
                          title="Includes jobs with no resume yet and jobs whose PDF is out of date with the saved resume"
                        >
                          Generate/refresh resumes ({missingResumeCount})
                        </Button>
                      )}
                    </header>

                    {isCollapsedApplied ? null : (
                      <div
                        className={cn(
                          "min-h-0 flex-1 space-y-2 p-2 [scrollbar-gutter:stable]",
                          dragging ? "overflow-hidden" : "overflow-y-auto",
                        )}
                      >
                        {laneCards.length === 0 ? (
                          <div className="px-1.5 py-2 text-xs text-muted-foreground/70">
                            Drop a card here or log a stage.
                          </div>
                        ) : (
                          laneCards.map(({ job, latestEventAt, stage, currentStage, round }) => (
                            <InProgressBoardCard
                              key={job.id}
                              job={job}
                              stage={stage}
                              round={round}
                              onUntarget={() => void handleTargetAction(job)}
                              onPreviewPdf={() => handlePreviewPdf(job)}
                              onPrepareResume={() => handlePrepareResume(job)}
                              isResumeBusy={isResumeBusy(job.id)}
                              latestEventAt={latestEventAt}
                              jobPageLinkState={jobPageLinkState}
                              isMoving={movingJobId === job.id}
                              onDragStart={(event) => {
                                if (
                                  (event.target as HTMLElement).closest("[data-board-card-menu]")
                                ) {
                                  event.preventDefault();
                                  return;
                                }
                                setDragging({
                                  jobId: job.id,
                                  fromStage: stage,
                                });
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDragging(null);
                                setDropTargetStage(null);
                              }}
                              onLogEvent={() =>
                                stage !== "targeted" &&
                                setLogEventTarget({
                                  job,
                                  stage: currentStage,
                                })
                              }
                            />
                          ))
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </PageMain>

      <LogEventModal
        isOpen={logEventTarget != null}
        onClose={() => setLogEventTarget(null)}
        onLog={handleBoardLogEvent}
        jobTitle={logEventTarget?.job.title}
        employer={logEventTarget?.job.employer}
      />
    </>
  );
};
