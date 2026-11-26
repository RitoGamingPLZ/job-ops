import { Trash2 } from "lucide-react";
import type React from "react";
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

type ConfirmDeleteButtonProps = {
  /** Accessible name for the trigger, e.g. "Delete user sam". */
  label: string;
  title: string;
  description: React.ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
};

/** Row-level trash button that asks for confirmation before deleting. */
export const ConfirmDeleteButton: React.FC<ConfirmDeleteButtonProps> = ({
  label,
  title,
  description,
  disabled,
  onConfirm,
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={onConfirm}
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
