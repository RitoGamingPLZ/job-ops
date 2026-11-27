import type { ExperienceBullet, LibraryEditAction, LibraryItemUsage } from "@shared/types";
import { useEffect, useState } from "react";
import { getLibraryItemUsage } from "@client/api/cowork";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, v]) => `${key}: ${display(v)}`)
      .join(", ");
  return String(value ?? "") || "(empty)";
}

export function LibraryEditDialog({
  action,
  before,
  busy,
  onConfirm,
  onCancel,
}: {
  action: LibraryEditAction;
  before?: ExperienceBullet;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [usage, setUsage] = useState<LibraryItemUsage | null | undefined>(undefined);
  useEffect(() => {
    if (action.kind !== "update") return;
    let active = true;
    getLibraryItemUsage(action.target.libraryId).then(
      (value) => {
        if (active) setUsage(value);
      },
      () => {
        if (active) setUsage(null);
      },
    );
    return () => {
      active = false;
    };
  }, [action]);
  const values = action.kind === "update" ? action.patch : action.item;
  const fields = Object.entries({ ...values, data: undefined, ...values.data }).filter(
    ([key, value]) => value != null && key !== "schemaVersion",
  );
  const button =
    action.kind === "update"
      ? "Update library item"
      : action.includeOnResume
        ? "Save to library and resume"
        : "Save to library";
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>
          {action.kind === "update" ? "Review library update" : "Review new library item"}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {action.kind === "create"
            ? action.includeOnResume
              ? "Save this fact and include the linked item on this resume."
              : "Save this fact for reuse in future resumes."
            : "Linked resumes receive shared changes where their wording still matches. Applied and in-progress resumes keep their saved wording."}
        </AlertDialogDescription>
        {action.kind === "update" && (
          <p className="text-sm" role="status">
            {usage === undefined
              ? "Checking linked resumes…"
              : usage === null
                ? "Linked resume count unavailable."
                : `Linked resumes: ${usage.jobIds.length + usage.frozenJobIds.length} (${usage.frozenJobIds.length} frozen)`}
          </p>
        )}
        <dl className="max-h-64 space-y-2 overflow-auto text-sm">
          {fields.map(([key, value]) => (
            <div key={key}>
              <dt className="font-medium capitalize">{key}</dt>
              {before && (
                <dd>Current: {display(key === "text" ? before.text : before.data?.[key])}</dd>
              )}
              <dd>Proposed: {display(value)}</dd>
            </div>
          ))}
        </dl>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button disabled={busy} onClick={onConfirm}>
            {button}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
