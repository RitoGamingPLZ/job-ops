import type { WatchlistCompanyRating } from "@shared/types.js";
import type React from "react";
import { cn } from "@/lib/utils";

interface CompanyRatingBadgesProps {
  rating?: WatchlistCompanyRating | null;
  className?: string;
}

function toneClass(value: number): string {
  if (value >= 8) return "text-emerald-600 dark:text-emerald-400";
  if (value >= 5) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function RatingChip({
  short,
  long,
  value,
  source,
}: {
  short: string;
  long: string;
  value: number;
  source: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 leading-none tabular-nums"
      title={`${long}: ${formatRating(value)} out of 10 (${source})`}
    >
      <span className="text-muted-foreground">{short}</span>
      <span className={cn("font-medium", toneClass(value))}>{formatRating(value)}/10</span>
    </span>
  );
}

/** Work-life balance and pay ratings (0-10) for a company, when we have them. */
export const CompanyRatingBadges: React.FC<CompanyRatingBadgesProps> = ({ rating, className }) => {
  if (!rating || (rating.wlb === null && rating.salary === null)) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-[11px]", className)}>
      {rating.wlb !== null ? (
        <RatingChip
          short="WLB"
          long="Work-life balance"
          value={rating.wlb}
          source={rating.source}
        />
      ) : null}
      {rating.salary !== null ? (
        <RatingChip short="Pay" long="Salary" value={rating.salary} source={rating.source} />
      ) : null}
    </div>
  );
};
