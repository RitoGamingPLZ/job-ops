import { isAwaitingAiScore, PropertyRow, ScoreRing } from "@client/components";
import type { Job } from "@shared/types.js";
import {
  ClipboardList,
  FileText,
  FolderKanban,
  Mail,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { Link } from "react-router-dom";
import { formatPostingAgeLabel } from "@/client/lib/job-posting-age";
import { Button } from "@/components/ui/button";
import { cn, formatDateTime } from "@/lib/utils";

export type JobMemoryView =
  | "overview"
  | "note"
  | "documents"
  | "timeline"
  | "emails"
  | "ghostwriter";

type JobPageLeftSidebarProps = {
  job: Job;
  activeMemoryView: JobMemoryView;
  baseJobPath: string;
  navigationState?: { jobPageBackTo: string };
  selectedProjects: string[];
  sourceLabel: string;
};

const memoryLinks = [
  {
    id: "overview" as const,
    label: "Overview",
    icon: FolderKanban,
  },
  {
    id: "note" as const,
    label: "Notes",
    icon: MessageSquareText,
  },
  {
    id: "documents" as const,
    label: "Documents",
    icon: FileText,
  },
  {
    id: "timeline" as const,
    label: "Timeline",
    icon: ClipboardList,
  },
  {
    id: "emails" as const,
    label: "Emails",
    icon: Mail,
  },
  {
    id: "ghostwriter" as const,
    label: "Ghostwriter",
    icon: Sparkles,
  },
];

const PostingAgeRow: React.FC<{ datePosted: Job["datePosted"] }> = ({ datePosted }) => {
  const postingAge = formatPostingAgeLabel(datePosted);
  if (!postingAge) return null;

  return (
    <PropertyRow label="Posted">
      <span title={postingAge.tooltip}>{postingAge.label}</span>
    </PropertyRow>
  );
};

export const JobPageLeftSidebar: React.FC<JobPageLeftSidebarProps> = ({
  job,
  activeMemoryView,
  baseJobPath,
  navigationState,
  selectedProjects,
  sourceLabel,
}) => (
  <aside className="space-y-3 xl:sticky xl:top-5">
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {job.id.slice(0, 8)}
          </div>
          <h1 className="text-lg font-semibold leading-tight">{job.employer}</h1>
          <div className="text-[13px] text-muted-foreground">{job.title}</div>
        </div>
        <div className="flex justify-start sm:justify-end">
          <ScoreRing
            score={job.suitabilityScore}
            isAwaitingAi={isAwaitingAiScore(job)}
            suitabilityReason={job.suitabilityReason}
            jobId={job.id}
          />
        </div>
      </div>

      <div className="mt-4 divide-y divide-border/60 border-t border-border/60">
        <PropertyRow label="Source">{sourceLabel}</PropertyRow>
        <PropertyRow label="Location">{job.location || "Unknown"}</PropertyRow>
        <PostingAgeRow datePosted={job.datePosted} />
        <PropertyRow label="Found">
          {formatDateTime(job.discoveredAt) ?? job.discoveredAt}
        </PropertyRow>
        {job.appliedAt && (
          <PropertyRow label="Applied">
            {formatDateTime(job.appliedAt) ?? job.appliedAt}
          </PropertyRow>
        )}
        <PropertyRow label="Outcome">
          {job.outcome ? job.outcome.replace(/_/g, " ") : "Open"}
        </PropertyRow>
        <PropertyRow label="Projects Chosen">
          {selectedProjects.length > 0 ? selectedProjects.length : "No projects"}
        </PropertyRow>
      </div>
    </section>

    <section className="rounded-lg border border-border bg-card p-2">
      <div className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Views
      </div>
      <div className="space-y-0.5">
        {memoryLinks.map(({ id: linkView, label, icon: Icon }) => {
          const path =
            linkView === "overview"
              ? baseJobPath
              : `${baseJobPath}/${linkView === "note" ? "notes" : linkView}`;
          return (
            <Button
              asChild
              key={linkView}
              variant={activeMemoryView === linkView ? "outline" : "ghost"}
              className={cn("h-8 w-full justify-between px-2 text-left text-[13px]")}
            >
              <Link to={path} state={navigationState}>
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
              </Link>
            </Button>
          );
        })}
      </div>
    </section>
  </aside>
);
