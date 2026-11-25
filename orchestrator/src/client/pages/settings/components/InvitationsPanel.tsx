import * as api from "@client/api";
import {
  DEFAULT_USER_PERMISSIONS,
  type UserInvitation,
  type UserPermissionKey,
  type UserPermissions,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      setLabel("");
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
    },
    onError: (error) => showErrorToast(error, "Failed to create invitation"),
  });

  const revokeMutation = useMutation({
    mutationFn: api.revokeUserInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
      toast.success("Invitation revoked");
    },
    onError: (error) => showErrorToast(error, "Failed to revoke invitation"),
  });

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
      <div className="space-y-1">
        <div className="text-sm font-semibold">Invitations</div>
        <p className="text-sm text-muted-foreground">
          Create a one-time link and send it to the person yourself. They pick their own username
          and password, and start with the access you choose here. Nobody can sign up without a
          link.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <Input
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            placeholder="Who is this for? (e.g. Sam, cousin)"
            aria-label="Invitation label"
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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
          <Button
            type="button"
            disabled={createMutation.isPending || label.trim().length === 0}
            onClick={() =>
              createMutation.mutate({ label: label.trim(), permissions, expiresInDays })
            }
          >
            Create invitation
          </Button>
        </div>
        <PermissionToggles
          idPrefix="invite"
          value={permissions}
          onChange={(key: UserPermissionKey, enabled) =>
            setPermissions((current) => ({ ...current, [key]: enabled }))
          }
        />
      </div>

      {freshLink ? (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="text-sm font-medium">Invitation for {freshLink.label}</div>
          <p className="text-xs text-muted-foreground">
            This link is shown only once. Copy it now and send it to them.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={freshLink.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={() => void copyLink(freshLink.url)}>
              Copy
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFreshLink(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-border rounded-md border border-border">
        {invitations.map((invitation) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 p-3"
            key={invitation.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{invitation.label}</span>
                <Badge variant={STATUS_VARIANT[invitation.status]}>{invitation.status}</Badge>
                {invitation.usedByUsername ? (
                  <Badge variant="outline">{invitation.usedByUsername}</Badge>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {invitation.status === "pending"
                  ? `Expires ${formatDate(invitation.expiresAt)}`
                  : invitation.usedAt
                    ? `Used ${formatDate(invitation.usedAt)}`
                    : `Created ${formatDate(invitation.createdAt)}`}
              </div>
            </div>
            {invitation.status === "pending" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(invitation.id)}
              >
                Revoke
              </Button>
            ) : null}
          </div>
        ))}
        {invitations.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No invitations yet.</div>
        ) : null}
      </div>
    </div>
  );
};
