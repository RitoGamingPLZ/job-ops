import type { BoardColumn, JobListItem } from "@shared/types.js";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  ExternalLink,
  Loader2,
  MoreVertical,
  PlusCircle,
} from "lucide-react";
import type React from "react";
import { Link } from "react-router-dom";
import { Tip } from "@/client/components/Tip";
import { getResumeState } from "@/client/lib/pdf-freshness";
import { resumeEditorLocation } from "@/client/lib/resume-opening";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatTimestamp } from "@/lib/utils";

function ResumeStatusIndicator({
  tooltip,
  label,
  contentClassName = "text-xs",
  children,
}: {
  tooltip: string;
  label: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Tip asChild content={tooltip} contentClassName={contentClassName}>
      <span
        tabIndex={0}
        role="img"
        aria-label={label}
        className="inline-flex shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </span>
    </Tip>
  );
}

/** Small at-a-glance marker for the resume's prep state, visible in every stage column. */
const ResumeStatusDot: React.FC<{ job: JobListItem }> = ({ job }) => {
  const resumeState = getResumeState(job);
  if (resumeState === "untargeted") return null;

  if (resumeState === "available") {
    return (
      <ResumeStatusIndicator tooltip="Resume ready" label="Resume ready">
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-success" />
      </ResumeStatusIndicator>
    );
  }

  if (resumeState === "preparing") {
    return (
      <ResumeStatusIndicator tooltip="Preparing resume…" label="Preparing resume">
        <Loader2
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
        />
      </ResumeStatusIndicator>
    );
  }

  if (job.generationError) {
    return (
      <ResumeStatusIndicator
        tooltip={job.generationError}
        label="Resume generation failed"
        contentClassName="max-w-60 text-xs"
      >
        <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-destructive" />
      </ResumeStatusIndicator>
    );
  }

  return (
    <ResumeStatusIndicator tooltip="Resume not prepared yet" label="Resume not prepared yet">
      <Circle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
    </ResumeStatusIndicator>
  );
};

export type InProgressBoardCardProps = {
  job: JobListItem;
  stage: BoardColumn;
  round?: number;
  showResumeActions?: boolean;
  onUntarget?: () => void;
  onPreviewPdf?: () => void;
  onPrepareResume?: () => void;
  /** A preview render or prepare request for this card is in flight. */
  isResumeBusy?: boolean;
  latestEventAt: number | null;
  jobPageLinkState: { jobPageBackTo: string };
  isMoving: boolean;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onLogEvent: () => void;
};

export const InProgressBoardCard: React.FC<InProgressBoardCardProps> = ({
  job,
  stage,
  round = 0,
  showResumeActions = true,
  onUntarget,
  onPreviewPdf,
  onPrepareResume,
  isResumeBusy = false,
  latestEventAt,
  jobPageLinkState,
  isMoving,
  onDragStart,
  onDragEnd,
  onLogEvent,
}) => {
  const canLogEvents = stage !== "closed" && stage !== "targeted";
  const resumeState = getResumeState(job);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: full-card drag target for kanban lanes
    <div
      draggable={!isMoving}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg border border-border/60 bg-card p-3 shadow-sm transition-colors",
        "hover:border-border hover:bg-accent/40",
        isMoving && "opacity-70",
      )}
    >
      <div className="flex items-center gap-2">
        <Link
          to={`/job/${job.id}`}
          state={jobPageLinkState}
          className="min-w-0 flex-1 truncate rounded-sm text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {job.employer}
        </Link>
        {showResumeActions && <ResumeStatusDot job={job} />}
        <div className="relative h-7 w-7 shrink-0">
          <ExternalLink
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-muted-foreground/70 opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:hidden"
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "absolute inset-0 h-7 w-7 text-muted-foreground opacity-0 transition-opacity duration-150",
                  "pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100",
                  "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                  "data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
                  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                )}
                aria-label={`Actions for ${job.title}`}
                draggable={false}
                data-board-card-menu=""
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                disabled={!canLogEvents}
                onSelect={() => {
                  if (!canLogEvents) return;
                  onLogEvent();
                }}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Log event
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Link
        to={`/job/${job.id}`}
        state={jobPageLinkState}
        className="mt-1 block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="line-clamp-3 text-[13px] font-medium leading-snug text-foreground">
          {job.title}
        </div>
      </Link>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {stage === "technical_interview" && (
          <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[11px] font-normal">
            Round {Math.max(round, 1)}
          </Badge>
        )}
        {stage === "closed" && (
          <>
            <Badge
              variant="outline"
              className="rounded-md border-border/60 bg-muted/30 px-1.5 py-0 text-[11px] font-normal text-foreground/80"
            >
              Reject
            </Badge>
            {job.outcome ? (
              <Badge
                variant="outline"
                className="rounded-md px-1.5 py-0 text-[11px] font-normal capitalize"
              >
                {job.outcome.replaceAll("_", " ")}
              </Badge>
            ) : null}
          </>
        )}
        <span className="text-[11px] text-muted-foreground/80">
          {latestEventAt != null
            ? `Updated ${formatTimestamp(latestEventAt)}`
            : "No stage events yet"}
        </span>
      </div>
      {stage === "targeted" && (
        <div className="mt-3 flex flex-wrap gap-2" data-board-card-menu="">
          {showResumeActions && resumeState === "available" && (
            <>
              <Button size="sm" variant="outline" asChild>
                <Link to={resumeEditorLocation({ kind: "job", jobId: job.id }, "edit")}>
                  Open resume
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isMoving || isResumeBusy || job.pdfRegenerating}
                onClick={onPreviewPdf}
              >
                Preview PDF
              </Button>
            </>
          )}
          {showResumeActions && resumeState === "preparing" && (
            <Button size="sm" variant="outline" disabled>
              Preparing resume…
            </Button>
          )}
          {showResumeActions && resumeState === "unprepared" && (
            <>
              <span className="w-full text-[11px] text-muted-foreground">
                Resume not prepared yet
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={isMoving || isResumeBusy}
                onClick={onPrepareResume}
              >
                Prepare resume
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onUntarget}
            disabled={isMoving || job.status === "processing"}
          >
            Untarget
          </Button>
        </div>
      )}
    </div>
  );
};
