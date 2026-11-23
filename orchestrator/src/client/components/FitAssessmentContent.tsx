import { Glasses } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface FitAssessmentContentProps {
  score: number | null;
  suitabilityReason: string;
  className?: string;
}

export const FitAssessmentContent: React.FC<FitAssessmentContentProps> = ({
  score,
  suitabilityReason,
  className,
}) => {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-2">
          <Glasses className="h-4 w-4 text-success animate-pulse" />
          <span className="font-semibold text-sm text-foreground">Fit Assessment</span>
        </div>
        {score !== null && (
          <span
            className={cn(
              "text-xs font-semibold px-2 py-0.5 rounded-full border",
              score >= 70
                ? "bg-success/15 text-success border-success/30"
                : score >= 60
                  ? "bg-warning/15 text-warning border-warning/30"
                  : "bg-muted/40 text-muted-foreground border-border",
            )}
          >
            {score}/100
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
        {suitabilityReason}
      </p>
    </div>
  );
};
