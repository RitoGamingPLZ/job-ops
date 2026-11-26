import * as api from "@client/api";
import {
  DEFAULT_USER_PERMISSIONS,
  type UserInvitation,
  type UserPermissionKey,
  type UserPermissions,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { PermissionToggles } from "./PermissionToggles";

export const invitationsQueryKey = ["workspaces", "invitations"] as const;

const EXPIRY_OPTIONS = [1, 7, 14, 30] as const;

function buildInviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const STATUS_VARIANT: Record<UserInvitation["status"], "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  used: "outline",
  expired: "outline",
  revoked: "destructive",
};

export const InvitationsPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [permissions, setPermissions] = useState<UserPermissions>({ ...DEFAULT_USER_PERMISSIONS });
  const [freshLink, setFreshLink] = useState<{ label: string; url: string } | null>(null);

  const invitationsQuery = useQuery({
    queryKey: invitationsQueryKey,
    queryFn: api.listUserInvitations,
  });

  const createMutation = useMutation({
    mutationFn: api.createUserInvitation,
    onSuccess: async (invitation) => {
      setFreshLink({ label: invitation.label, url: buildInviteUrl(invitation.token) });
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
    },
    onError: (error) => showErrorToast(error, "Failed to create invitation"),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteUserInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
      toast.success("Invitation deleted");
    },
    onError: (error) => showErrorToast(error, "Failed to delete invitation"),
  });

  const handleDialogOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setFreshLink(null);
      setLabel("");
      setExpiresInDays(7);
      setPermissions({ ...DEFAULT_USER_PERMISSIONS });
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invitation link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it manually.");
    }
  };

  const invitations = invitationsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">Invitations</div>
          <p className="text-sm text-muted-foreground">
            Create a one-time link and send it to the person yourself. They pick their own username
            and password, and start with the access you choose here. Nobody can sign up without a
            link.
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Create invitation
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {freshLink ? (
            <>
              <DialogHeader>
                <DialogTitle>Invitation for {freshLink.label}</DialogTitle>
                <DialogDescription>
                  This link is shown only once. Copy it now and send it to them.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Input
                  readOnly
                  value={freshLink.url}
                  className="min-w-0 flex-1"
                  aria-label="Invitation link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyLink(freshLink.url)}
                >
                  Copy
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => handleDialogOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create invitation</DialogTitle>
                <DialogDescription>
                  Generates a one-time sign-up link with the access you choose.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.currentTarget.value)}
                  placeholder="Who is this for? (e.g. Sam, cousin)"
                  aria-label="Invitation label"
                />
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.currentTarget.value))}
                  aria-label="Invitation expiry"
                >
                  {EXPIRY_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      Expires in {days} {days === 1 ? "day" : "days"}
                    </option>
                  ))}
                </select>
                <div className="rounded-md border border-border/60 p-3">
                  <PermissionToggles
                    idPrefix="invite"
                    value={permissions}
                    onChange={(key: UserPermissionKey, enabled) =>
                      setPermissions((current) => ({ ...current, [key]: enabled }))
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={createMutation.isPending || label.trim().length === 0}
                  onClick={() =>
                    createMutation.mutate({ label: label.trim(), permissions, expiresInDays })
                  }
                >
                  Create invitation
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Label</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires / used</TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="max-w-[12rem] truncate font-medium">
                  {invitation.label}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[invitation.status]}>{invitation.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {invitation.usedByUsername ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDate(invitation.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {invitation.status === "pending"
                    ? `Expires ${formatDate(invitation.expiresAt)}`
                    : invitation.usedAt
                      ? `Used ${formatDate(invitation.usedAt)}`
                      : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <ConfirmDeleteButton
                    label={`Delete invitation ${invitation.label}`}
                    title="Delete this invitation?"
                    description={
                      invitation.status === "pending"
                        ? `The link for ${invitation.label} will stop working immediately.`
                        : invitation.status === "used"
                          ? "This only removes the invitation record. The account that was created stays."
                          : "This removes the invitation record."
                    }
                    disabled={deleteMutation.isPending}
                    onConfirm={() => deleteMutation.mutate(invitation.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {invitations.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-3 text-sm text-muted-foreground">
                  No invitations yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
