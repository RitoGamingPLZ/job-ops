import * as api from "@client/api";
import { InvitationsPanel } from "@client/pages/settings/components/InvitationsPanel";
import { PermissionToggles } from "@client/pages/settings/components/PermissionToggles";
import {
  DEFAULT_USER_PERMISSIONS,
  USER_PERMISSION_KEYS,
  type UserPermissionKey,
  type UserPermissions,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const workspaceUsersQueryKey = ["workspaces", "users"] as const;

export function UserManagementSection() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [createPermissions, setCreatePermissions] = useState<UserPermissions>(() => ({
    ...DEFAULT_USER_PERMISSIONS,
  }));
  const [resetPasswordByUserId, setResetPasswordByUserId] = useState<Record<string, string>>({});

  const meQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: api.getCurrentAuthUser,
    retry: false,
  });
  const usersQuery = useQuery({
    queryKey: workspaceUsersQueryKey,
    queryFn: api.listWorkspaceUsers,
    enabled: meQuery.data?.isSystemAdmin === true,
  });

  const createUserMutation = useMutation({
    mutationFn: api.createWorkspaceUser,
    onSuccess: async () => {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setCreatePermissions({ ...DEFAULT_USER_PERMISSIONS });
      await queryClient.invalidateQueries({ queryKey: workspaceUsersQueryKey });
      toast.success("User created");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to create user");
    },
  });

  const disableUserMutation = useMutation({
    mutationFn: (input: { userId: string; isDisabled: boolean }) =>
      api.setWorkspaceUserDisabled(input.userId, input.isDisabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceUsersQueryKey });
      toast.success("User updated");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to update user");
    },
  });

  const permissionsMutation = useMutation({
    mutationFn: (input: { userId: string; key: UserPermissionKey; enabled: boolean }) =>
      api.setWorkspaceUserPermissions(input.userId, { [input.key]: input.enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceUsersQueryKey });
    },
    onError: (error) => {
      showErrorToast(error, "Failed to update access");
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (input: { userId: string; password: string }) =>
      api.resetWorkspaceUserPassword(input.userId, input.password),
    onSuccess: async (_data, variables) => {
      setResetPasswordByUserId((current) => ({
        ...current,
        [variables.userId]: "",
      }));
      toast.success("Password reset");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to reset password");
    },
  });

  if (!meQuery.data?.isSystemAdmin) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-semibold">Workspace</div>
        <p className="text-sm text-muted-foreground">
          Signed in as {meQuery.data?.username ?? "a workspace user"}.
        </p>
      </div>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-5">
      <InvitationsPanel />
      <Separator />
      <div className="space-y-1">
        <div className="text-sm font-semibold">Workspace Users</div>
        <p className="text-sm text-muted-foreground">
          Each user gets a private workspace with isolated jobs and settings.
        </p>
      </div>

      <div className="space-y-2">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            placeholder="Name"
          />
          <Input
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            placeholder="Username"
            autoComplete="off"
          />
          <Input
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            placeholder="Temporary password"
            type="password"
            autoComplete="new-password"
          />
          <Button
            type="button"
            onClick={() => {
              const permissionOverrides = Object.fromEntries(
                USER_PERMISSION_KEYS.filter(
                  (key) => createPermissions[key] !== DEFAULT_USER_PERMISSIONS[key],
                ).map((key) => [key, createPermissions[key]]),
              ) as Partial<UserPermissions>;
              createUserMutation.mutate({
                username,
                displayName: displayName || username,
                password,
                ...(Object.keys(permissionOverrides).length > 0
                  ? { permissions: permissionOverrides }
                  : {}),
              });
            }}
            disabled={
              createUserMutation.isPending || username.trim().length === 0 || password.length < 8
            }
          >
            Create
          </Button>
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <PermissionToggles
            idPrefix="create-user"
            value={createPermissions}
            disabled={createUserMutation.isPending}
            onChange={(key, enabled) =>
              setCreatePermissions((current) => ({ ...current, [key]: enabled }))
            }
          />
        </div>
      </div>

      <div className="divide-y divide-border rounded-md border border-border">
        {users.map((user) => {
          const resetPassword = resetPasswordByUserId[user.id] ?? "";
          return (
            <div
              className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
              key={user.id}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {user.displayName || user.username}
                  </span>
                  <Badge variant="outline">{user.username}</Badge>
                  {user.isSystemAdmin ? <Badge variant="secondary">System admin</Badge> : null}
                  {user.isDisabled ? <Badge variant="destructive">Disabled</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{user.workspaceName}</div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={resetPassword}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setResetPasswordByUserId((current) => ({
                      ...current,
                      [user.id]: value,
                    }));
                  }}
                  placeholder="New password"
                  type="password"
                  autoComplete="new-password"
                  className="h-8 w-40"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resetPasswordMutation.isPending || resetPassword.length < 8}
                  onClick={() =>
                    resetPasswordMutation.mutate({
                      userId: user.id,
                      password: resetPassword,
                    })
                  }
                >
                  Reset
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disableUserMutation.isPending || user.id === meQuery.data?.id}
                onClick={() =>
                  disableUserMutation.mutate({
                    userId: user.id,
                    isDisabled: !user.isDisabled,
                  })
                }
              >
                {user.isDisabled ? "Enable" : "Disable"}
              </Button>
              {user.isSystemAdmin ? null : (
                <div className="md:col-span-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Access
                  </div>
                  <PermissionToggles
                    idPrefix={`user-${user.id}`}
                    value={user.permissions}
                    disabled={permissionsMutation.isPending}
                    onChange={(key, enabled) =>
                      permissionsMutation.mutate({ userId: user.id, key, enabled })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
        {users.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No users found.</div>
        ) : null}
      </div>
    </div>
  );
}
