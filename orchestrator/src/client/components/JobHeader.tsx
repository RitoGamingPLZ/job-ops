import { isAwaitingAiScore, ScoreRing } from "@client/components";
import type { AppliedDuplicateMatch, Job, JobListItem } from "@shared/types.js";
import { Calendar, DollarSign, ExternalLink, MapPin } from "lucide-react";
import type React from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn, formatDate, formatJobSourceLabel, sourceLabel } from "@/lib/utils";
import { formatPostingAgeLabel } from "../lib/job-posting-age";
import { openLevelsFyiLookup } from "../lib/levels-fyi";
import { appliedDuplicateIndicator } from "../pages/orchestrator/constants";
import { getJobStatusIndicator, StatusIndicator } from "./StatusIndicator";

interface JobHeaderProps {
  job: Job | JobListItem;
  className?: string;
  jobCTA?: React.ReactNode;
}

const AppliedDuplicatePill: React.FC<{
  match: AppliedDuplicateMatch | null | undefined;
}> = ({ match }) => {
  if (!match) {
    return null;
  }

  const appliedDate = formatDate(match.appliedAt) ?? "Unknown date";
  const tooltip = (
    <div className="space-y-1">
      <p className="text-xs font-medium">{match.title}</p>
      <p className="text-xs opacity-80">{match.employer}</p>
      <p className="text-[10px] opacity-80">
        Applied {appliedDate} · {match.score}% match
      </p>
    </div>
  );

  return (
    <StatusIndicator
      dotColor={appliedDuplicateIndicator.dot}
      label={appliedDuplicateIndicator.label}
      className="cursor-help"
      tooltip={tooltip}
      tooltipClassName="max-w-xs"
    />
  );
};

const postingAgeDotColor = {
  fresh: "bg-success",
  aging: "bg-warning",
  old: "bg-muted-foreground",
};

export const JobHeader: React.FC<JobHeaderProps> = ({ job, className, jobCTA }) => {
  const jobStatus = getJobStatusIndicator(job.status);
  const fullJob = "isRemote" in job ? job : null;
  const location = useLocation();
  const { pathname } = location;
  const isJobPage = pathname.startsWith("/job/");
  const jobPageLinkState = isJobPage
    ? undefined
    : { jobPageBackTo: `${location.pathname}${location.search}` };
  const deadline = formatDate(job.deadline);
  const postingAge = formatPostingAgeLabel(job.datePosted);
  const jobStatusTooltip =
    job.status === "discovered" ? (
      <p className="text-xs">Found by the pipeline. Target it to prepare its resume.</p>
    ) : job.status === "ready" ? (
      <p className="text-xs">Resume prepared and ready to apply.</p>
    ) : undefined;
  return (
    <div
      className={cn(
        "space-y-3 p-4 bg-muted/30 rounded-lg rounded-b-none border border-b-0 border-border",
        className,
      )}
    >
      {/* Detail header: lighter weight than list items */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0 w-full sm:w-auto sm:flex-1">
          <Link
            to={`/job/${job.id}`}
            state={jobPageLinkState}
            className="block text-xl font-bold underline-offset-2 break-words hover:underline"
          >
            {job.title}
          </Link>

          <span>{job.employer}</span>

          <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground/70 mt-1">
            {(job.location || fullJob?.isRemote) && (
              <span className="flex items-center gap-1">
                <MapPin className="size-4" />
                {job.location?.trim()}
                {fullJob?.isRemote && ", Remote"}
              </span>
            )}
            {deadline && (
              <span className="flex items-center gap-1">
                <Calendar className="size-4" />
                {deadline}
              </span>
            )}
            {job.salary ? (
              <span className="flex items-center gap-1">
                <DollarSign className="size-4" />
                {job.salary}
              </span>
            ) : !isJobPage ? (
              <button
                type="button"
                onClick={() => openLevelsFyiLookup(job)}
                className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
              >
                <DollarSign className="size-4" />
                Check salary on Levels.fyi
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex h-full w-full min-w-0 flex-col items-stretch gap-3 sm:w-auto sm:items-end sm:justify-end">
          <div className="flex items-center gap-2 self-end">
            {!isJobPage && job.jobUrl ? (
              <Button size="sm" variant="ghost" asChild>
                <a href={job.jobUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  View job
                </a>
              </Button>
            ) : null}
            <ScoreRing
              score={job.suitabilityScore}
              size="sm"
              isAwaitingAi={isAwaitingAiScore(job)}
              suitabilityReason={fullJob?.suitabilityReason}
              jobId={job.id}
            />
          </div>
          {jobCTA && <div className="min-w-0 sm:w-auto">{jobCTA}</div>}
        </div>
      </div>

      {/* Status and score: single line, subdued */}
      <div className="flex items-center justify-between gap-2 py-1 border-y border-border/30 flex-wrap">
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          <StatusIndicator
            dotColor={jobStatus.dotColor}
            label={jobStatus.label}
            tooltip={jobStatusTooltip}
            tooltipClassName="max-w-xs"
            className={jobStatusTooltip ? "cursor-help" : undefined}
          />

          <AppliedDuplicatePill match={job.appliedDuplicateMatch} />

          {job.source && (
            <StatusIndicator
              variant="sky"
              tooltip={`Job found ${job.source === "manual" ? "manually" : `on ${formatJobSourceLabel(job.source)}`}`}
              label={sourceLabel[job.source] ?? formatJobSourceLabel(job.source)}
            />
          )}

          {postingAge && (
            <StatusIndicator
              dotColor={postingAgeDotColor[postingAge.tone]}
              label={postingAge.inlineLabel}
              tooltip={postingAge.tooltip}
              tooltipClassName="max-w-xs"
              className="cursor-help"
            />
          )}

          {fullJob?.isRemote === true && (
            <StatusIndicator
              variant="emerald"
              label="Remote"
              dotColor="bg-success"
              tooltip="The job claims to be remote"
            />
          )}
        </div>
      </div>
    </div>
  );
};
