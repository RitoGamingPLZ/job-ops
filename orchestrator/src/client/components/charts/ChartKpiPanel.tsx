/**
 * ChartKpiPanel
 * Reusable stat block used in card headers: label, bold rate, trend icon, subtext.
 */

import { TrendingDown, TrendingUp } from "lucide-react";

interface ChartKpiPanelProps {
  label: string;
  rate: number;
  subtext: string;
}

const LOW_RATE_THRESHOLD = 10;
const HIGH_RATE_THRESHOLD = 25;

export function ChartKpiPanel({ label, rate, subtext }: ChartKpiPanelProps) {
  return (
    <div className="flex flex-col items-start justify-center gap-3 border-t px-6 py-4 text-left sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold leading-none sm:text-3xl">{rate.toFixed(1)}%</span>
          {rate < LOW_RATE_THRESHOLD ? (
            <TrendingDown className="h-4 w-4 text-destructive" />
          ) : rate > HIGH_RATE_THRESHOLD ? (
            <TrendingUp className="h-4 w-4 text-success" />
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">{subtext}</span>
      </div>
    </div>
  );
}
