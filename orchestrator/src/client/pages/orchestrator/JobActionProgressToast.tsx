import { Progress } from "@/components/ui/progress";
import { clampJobActionProgress } from "./utils";

interface JobActionProgressToastProps {
  completed: number;
  requested: number;
  succeeded: number;
  failed: number;
}

export function JobActionProgressToast({
  completed,
  requested,
  succeeded,
  failed,
}: JobActionProgressToastProps) {
  const progress = clampJobActionProgress(completed, requested);
  const progressValue = Math.round((progress.completed / progress.requested) * 100);

  return (
    <div className="mt-2 w-full space-y-1.5">
      <Progress value={progressValue} className="h-1.5 w-full" />
      <p className="tabular-nums text-xs text-muted-foreground">
        {succeeded} succeeded, {failed} failed
      </p>
    </div>
  );
}
