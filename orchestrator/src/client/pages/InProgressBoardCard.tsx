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

/** Small at-a-glance marker for the resume's prep state, visible in every stage column. */
const ResumeStatusDot: React.FC<{ job: JobListItem }> = ({ job }) => {
  const resumeState = getResumeState(job);
  if (resumeState === "untargeted") return null;

  if (resumeState === "available") {
    return (
      <Tip content="Resume ready" contentClassName="text-xs">
        <CheckCircle2
          aria-label="Resume ready"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
        />
      </Tip>
    );
  }

  if (resumeState === "preparing") {
    return (
      <Tip content="Preparing resume…" contentClassName="text-xs">
        <Loader2
          aria-label="Preparing resume"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
        />
      </Tip>
    );
  }

  if (job.generationError) {
    return (
      <Tip content={job.generationError} contentClassName="max-w-60 text-xs">
        <CircleAlert
          aria-label="Resume generation failed"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
        />
      </Tip>
    );
  }

  return (
    <Tip content="Resume not prepared yet" contentClassName="text-xs">
      <Circle
        aria-label="Resume not prepared yet"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
      />
    </Tip>
  );
};

export type InProgressBoardCardProps = {
  job: JobListItem;
  stage: BoardColumn;
  round?: number;
  onUntarget?: () => void;
  onPreviewPdf?: () => void;
  onPrepareResume?: () => void;
  /** A preview render or prepare request for this card is in flight. */
  isResumeBusy?: boolean;
  latestEventAt: number | null;
  jobPageLinkState: { jobPageBackTo: string };
  isMoving: boolean;
  cardClassName?: string;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onLogEvent: () => void;
};

export const InProgressBoardCard: React.FC<InProgressBoardCardProps> = ({
  job,
  stage,
  round = 0,
  onUntarget,
  onPreviewPdf,
  onPrepareResume,
  isResumeBusy = false,
  latestEventAt,
  jobPageLinkState,
  isMoving,
  cardClassName,
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
        "group rounded-lg border border-border bg-card p-2.5 transition-colors",
        "hover:border-border/90 hover:bg-accent/40",
        cardClassName,
        isMoving && "opacity-70",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <Link
          to={`/job/${job.id}`}
          state={jobPageLinkState}
          className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {job.title}
          </div>
        </Link>
        <ResumeStatusDot job={job} />
        <div className="relative h-7 w-7 shrink-0">
          <ExternalLink
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-muted-foreground opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
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
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="text-xs text-muted-foreground/90">{job.employer}</div>
        {stage === "technical_interview" && (
          <Badge variant="outline" className="mt-2">
            Round {Math.max(round, 1)}
          </Badge>
        )}
        {stage === "closed" && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="border-border/60 bg-muted/30 text-foreground/80">
              Reject
            </Badge>
            {job.outcome ? (
              <Badge variant="outline" className="capitalize">
                {job.outcome.replaceAll("_", " ")}
              </Badge>
            ) : null}
          </div>
        )}
        <div className="mt-2 text-[11px] text-muted-foreground/70">
          {latestEventAt != null
            ? `Updated ${formatTimestamp(latestEventAt)}`
            : "No stage events yet"}
        </div>
      </Link>
      {stage === "targeted" && (
        <div className="mt-3 flex flex-wrap gap-2" data-board-card-menu="">
          {resumeState === "available" && (
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
          {resumeState === "preparing" && (
            <Button size="sm" variant="outline" disabled>
              Preparing resume…
            </Button>
          )}
          {resumeState === "unprepared" && (
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
