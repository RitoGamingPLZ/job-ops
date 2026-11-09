import { isAwaitingAiScore } from "@client/components";
import type { JobListItem } from "@shared/types.js";
import { isTargeted } from "@shared/types.js";
import { Loader2, XCircle } from "lucide-react";
import { Tip } from "@/client/components/Tip";
import { cn } from "@/lib/utils";
import { defaultStatusToken, statusTokens } from "./constants";

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  showSuitabilityScore?: boolean;
  statusDotClassName?: string;
  className?: string;
}

function getSuitabilityScoreTone(score: number): string {
  if (score >= 70) return "text-emerald-400/90";
  if (score >= 50) return "text-foreground/60";
  return "text-muted-foreground/60";
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
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          statusToken.dot,
          !isSelected && "opacity-70",
          statusDotClassName,
          !showStatusDot && "hidden",
        )}
        title={statusToken.label}
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate leading-tight",
            isSelected ? "font-semibold" : "font-medium",
          )}
        >
          {job.title}
        </div>
        <div className="truncate text-sm text-muted-foreground mt-0.5">
          {job.employer}
          {job.location && (
            <span className="before:content-['_in_']">{job.location}</span>
          )}
        </div>
        {(job.salary?.trim() || isTargeted(job)) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            {isTargeted(job) && (
              <span className="inline-flex shrink-0 rounded-sm border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-200">
                Targeted
              </span>
            )}
            {job.salary?.trim() && (
              <span className="truncate text-xs text-muted-foreground">
                {job.salary}
              </span>
            )}
          </div>
        )}
      </div>

      {showSuitabilityScore && hasScore ? (
        <div className="shrink-0 text-right">
          <span className={cn("text-sm tabular-nums", suitabilityTone)}>
            {job.suitabilityScore}
          </span>
        </div>
      ) : showSuitabilityScore && isAwaitingAi ? (
        <div className="shrink-0 text-right">
          <Tip
            content="Waiting for AI scoring to finish."
            contentClassName="max-w-60 text-xs"
          >
            <Loader2
              aria-label="Waiting for AI scoring to finish."
              className="h-4 w-4 animate-spin text-muted-foreground"
            />
          </Tip>
        </div>
      ) : showSuitabilityScore ? (
        <div className="shrink-0 text-right">
          <Tip
            content="AI misconfiguration or service error. Please check your settings and AI service status."
            contentClassName="max-w-60 text-xs"
          >
            <XCircle
              aria-label="AI misconfiguration or service error."
              className="h-4 w-4 text-destructive"
            />
          </Tip>
        </div>
      ) : null}
    </div>
  );
};
