import { Loader2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface PipelineActionRequiredProps {
  title: string;
  description?: string;
  actionLabel: string;
  pendingLabel: string;
  pending?: boolean;
  onAction: () => void;
  secondaryActionLabel?: string;
  secondaryPendingLabel?: string;
  secondaryPending?: boolean;
  onSecondaryAction?: () => void;
}

const StableActionContent = ({
  label,
  pendingLabel,
  pending,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
}) => (
  <span className="inline-grid items-center justify-items-center">
    <span
      className="col-start-1 row-start-1 inline-flex items-center gap-1.5 invisible"
      aria-hidden="true"
    >
      <Loader2 className="h-4 w-4 shrink-0" />
      <span>{pendingLabel.length >= label.length ? pendingLabel : label}</span>
    </span>
    <span className="col-start-1 row-start-1 inline-flex items-center gap-1.5">
      {pending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
      <span>{pending ? pendingLabel : label}</span>
    </span>
  </span>
);

export const PipelineActionRequired = ({
  title,
  description,
  actionLabel,
  pendingLabel,
  pending = false,
  onAction,
  secondaryActionLabel,
  secondaryPendingLabel,
  secondaryPending = false,
  onSecondaryAction,
}: PipelineActionRequiredProps) => (
  <Alert variant="warning">
    <ShieldAlert />
    <div className="flex min-w-0 size-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <AlertTitle className="mb-0">{title}</AlertTitle>
        {description ? <AlertDescription>{description}</AlertDescription> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || secondaryPending}
          onClick={onAction}
        >
          <StableActionContent label={actionLabel} pendingLabel={pendingLabel} pending={pending} />
        </Button>
        {secondaryActionLabel && onSecondaryAction ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || secondaryPending}
            onClick={onSecondaryAction}
          >
            <StableActionContent
              label={secondaryActionLabel}
              pendingLabel={secondaryPendingLabel ?? secondaryActionLabel}
              pending={secondaryPending}
            />
          </Button>
        ) : null}
      </div>
    </div>
  </Alert>
);
