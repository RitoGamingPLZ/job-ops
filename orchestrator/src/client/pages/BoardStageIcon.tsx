import type { BoardColumn } from "@shared/types.js";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

/** How far through the interview loop each in-flight column is (Linear "started" pies). */
const STARTED_PROGRESS: Partial<Record<BoardColumn, number>> = {
  recruiter_screen: 0.25,
  technical_interview: 0.5,
  behavioural: 0.65,
  hiring_manager_screen: 0.8,
};

const RING_RADIUS = 5.5;
const PIE_RADIUS = 2.5;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

/**
 * Linear-style status glyph for a board column: dashed (backlog-like), empty ring,
 * partially filled ring, check (done) and cross (closed).
 */
export const BoardStageIcon: React.FC<{ stage: BoardColumn; className?: string }> = ({
  stage,
  className,
}) => {
  const base = cn("h-3.5 w-3.5 shrink-0", className);

  if (stage === "targeted") {
    return <CircleDashed aria-hidden className={cn(base, "text-muted-foreground")} />;
  }
  if (stage === "offer") {
    return <CircleCheck aria-hidden className={cn(base, "text-success")} />;
  }
  if (stage === "closed") {
    return <CircleX aria-hidden className={cn(base, "text-muted-foreground")} />;
  }

  const progress = STARTED_PROGRESS[stage] ?? 0;
  const started = progress > 0;

  return (
    <svg
      aria-hidden
      viewBox="0 0 14 14"
      className={cn(base, started ? "text-warning" : "text-muted-foreground")}
    >
      <circle cx="7" cy="7" r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {started ? (
        <circle
          cx="7"
          cy="7"
          r={PIE_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={PIE_RADIUS * 2}
          strokeDasharray={`${progress * PIE_CIRCUMFERENCE} ${PIE_CIRCUMFERENCE}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}
    </svg>
  );
};
