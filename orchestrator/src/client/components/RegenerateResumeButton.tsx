import type { Job } from "@shared/types";
import { useState } from "react";
import { toast } from "sonner";
import { useRegenerateJobResumeMutation } from "@/client/hooks/queries/useJobMutations";
import { showErrorToast } from "@/client/lib/error-toast";
import { isPdfRegenerating } from "@/client/lib/pdf-freshness";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function RegenerateResumeButton({
  job,
  disabled = false,
}: {
  job: Job;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useRegenerateJobResumeMutation();
  const busy =
    disabled ||
    mutation.isPending ||
    job.status === "processing" ||
    isPdfRegenerating(job);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          Regenerate resume
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate resume?</AlertDialogTitle>
          <AlertDialogDescription>
            Re-tailors from your candidate library and replaces this job's
            resume, including your edits.
            {(job.pdfFreshness === "uploaded" ||
              job.pdfSource === "uploaded") &&
              " The uploaded PDF will be replaced by a generated one."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={() =>
              mutation.mutate(job.id, {
                onSuccess: () => toast.success("Regenerating resume"),
                onError: (error) =>
                  showErrorToast(error, "Failed to regenerate resume"),
              })
            }
          >
            Regenerate resume
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
