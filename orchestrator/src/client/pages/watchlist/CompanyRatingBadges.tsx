import type { WatchlistCompanyRating } from "@shared/types.js";
import type React from "react";
import { cn } from "@/lib/utils";

interface CompanyRatingBadgesProps {
  rating?: WatchlistCompanyRating | null;
  className?: string;
}

function toneClass(value: number): string {
  if (value >= 4) return "text-emerald-600 dark:text-emerald-400";
  if (value === 3) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function RatingChip({ short, long, value }: { short: string; long: string; value: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 tabular-nums"
      title={`${long}: ${value} of 5 (editorial estimate)`}
    >
      <span className="text-muted-foreground">{short}</span>
      <span className={cn("font-medium", toneClass(value))}>{value}/5</span>
    </span>
  );
}

/** Editorial work-life balance and pay ratings for a company, when we have them. */
export const CompanyRatingBadges: React.FC<CompanyRatingBadgesProps> = ({ rating, className }) => {
  if (!rating) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-[11px]", className)}>
      <RatingChip short="WLB" long="Work-life balance" value={rating.wlb} />
      <RatingChip short="Pay" long="Salary" value={rating.salary} />
    </div>
  );
};
