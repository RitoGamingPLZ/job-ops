import { isAwaitingAiScore } from "@client/components";
import type { JobListItem } from "@shared/types.js";
import { isTargeted } from "@shared/types.js";
import { Loader2, XCircle } from "lucide-react";
import { Tip } from "@/client/components/Tip";
import { cn } from "@/lib/utils";
import { getStatusToken } from "./constants";

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  showSuitabilityScore?: boolean;
  statusDotClassName?: string;
  className?: string;
}

function getSuitabilityScoreTone(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 50) return "text-foreground/75";
  return "text-muted-foreground";
}

export const JobRowContent = ({
  job,
  isSelected = false,
  showStatusDot = true,
  showSuitabilityScore = true,
  statusDotClassName,
  className,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const isAwaitingAi = isAwaitingAiScore(job);
  const statusToken = getStatusToken(job.status);
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);
  const shortId = job.id.slice(0, 6);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2.5", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          statusToken.dot,
          !isSelected && "opacity-80",
          statusDotClassName,
          !showStatusDot && "hidden",
        )}
        title={statusToken.label}
      />

      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground/70 sm:inline">
        {shortId}
      </span>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[13px] leading-snug",
            isSelected ? "font-semibold text-foreground" : "font-medium text-foreground",
          )}
        >
          {job.title}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">{job.employer}</span>
          {job.location && (
            <>
              <span aria-hidden="true" className="text-muted-foreground/50">
                ·
              </span>
              <span className="truncate">{job.location}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isTargeted(job) && (
          <span className="inline-flex shrink-0 rounded border border-success/30 bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
            Targeted
          </span>
        )}
        {job.salary?.trim() && (
          <span className="hidden max-w-28 truncate text-xs text-muted-foreground xl:inline">
            {job.salary}
          </span>
        )}
        {showSuitabilityScore && hasScore ? (
          <span className={cn("w-7 text-right text-xs font-medium tabular-nums", suitabilityTone)}>
            {job.suitabilityScore}
          </span>
        ) : showSuitabilityScore && isAwaitingAi ? (
          <Tip content="Waiting for AI scoring to finish." contentClassName="max-w-60 text-xs">
            <Loader2
              aria-label="Waiting for AI scoring to finish."
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
            />
          </Tip>
        ) : showSuitabilityScore ? (
          <Tip
            content="AI misconfiguration or service error. Please check your settings and AI service status."
            contentClassName="max-w-60 text-xs"
          >
            <XCircle
              aria-label="AI misconfiguration or service error."
              className="h-3.5 w-3.5 text-destructive"
            />
          </Tip>
        ) : null}
      </div>
    </div>
  );
};
