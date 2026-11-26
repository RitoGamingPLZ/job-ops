import * as api from "@client/api";
import { ConfirmDeleteButton } from "@client/pages/settings/components/ConfirmDeleteButton";
import { PermissionToggles } from "@client/pages/settings/components/PermissionToggles";
import {
  DEFAULT_USER_PERMISSIONS,
  USER_PERMISSION_KEYS,
  type UserPermissionKey,
  type UserPermissions,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import type React from "react";
import { Fragment, useState } from "react";
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
import { cn } from "@/lib/utils";

export const workspaceUsersQueryKey = ["workspaces", "users"] as const;

export const UsersPanel: React.FC<{ currentUserId: string | undefined }> = ({ currentUserId }) => {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [createPermissions, setCreatePermissions] = useState<UserPermissions>(() => ({
    ...DEFAULT_USER_PERMISSIONS,
  }));
  const [resetPasswordByUserId, setResetPasswordByUserId] = useState<Record<string, string>>({});
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: workspaceUsersQueryKey,
    queryFn: api.listWorkspaceUsers,
  });

  const createUserMutation = useMutation({
    mutationFn: api.createWorkspaceUser,
    onSuccess: async () => {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setCreatePermissions({ ...DEFAULT_USER_PERMISSIONS });
      setCreateOpen(false);
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

  const deleteUserMutation = useMutation({
    mutationFn: api.deleteWorkspaceUser,
    onSuccess: async (_data, userId) => {
      setExpandedUserId((current) => (current === userId ? null : current));
      await queryClient.invalidateQueries({ queryKey: workspaceUsersQueryKey });
      toast.success("User deleted");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to delete user");
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

  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold">Workspace Users</div>
          <p className="text-sm text-muted-foreground">
            Each user gets a private workspace with isolated jobs and settings.
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Create user
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Creates an account with a private workspace. They can change the temporary password
              after signing in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const resetPassword = resetPasswordByUserId[user.id] ?? "";
              const isSelf = user.id === currentUserId;
              const isExpanded = expandedUserId === user.id;
              const name = user.displayName || user.username;
              return (
                <Fragment key={user.id}>
                  <TableRow>
                    <TableCell className="max-w-[14rem] truncate font-medium">{name}</TableCell>
                    <TableCell className="text-muted-foreground">{user.username}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.isSystemAdmin ? (
                          <Badge variant="secondary">System admin</Badge>
                        ) : null}
                        {user.isDisabled ? (
                          <Badge variant="destructive">Disabled</Badge>
                        ) : user.isSystemAdmin ? null : (
                          <Badge variant="outline">Active</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-expanded={isExpanded}
                          aria-label={`Manage ${name}`}
                          onClick={() => setExpandedUserId(isExpanded ? null : user.id)}
                        >
                          <ChevronRight
                            className={cn("mr-1 h-3.5 w-3.5 transition-transform", {
                              "rotate-90": isExpanded,
                            })}
                          />
                          Manage
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disableUserMutation.isPending || isSelf}
                          onClick={() =>
                            disableUserMutation.mutate({
                              userId: user.id,
                              isDisabled: !user.isDisabled,
                            })
                          }
                        >
                          {user.isDisabled ? "Enable" : "Disable"}
                        </Button>
                        <ConfirmDeleteButton
                          label={`Delete user ${user.username}`}
                          title={`Delete ${name}?`}
                          description="This permanently deletes the account and its private workspace, including all of their jobs, resumes and settings. This cannot be undone. To keep the data but block sign-in, disable the user instead."
                          disabled={deleteUserMutation.isPending || isSelf || user.isSystemAdmin}
                          onConfirm={() => deleteUserMutation.mutate(user.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={4} className="space-y-4 p-3">
                        {user.isSystemAdmin ? null : (
                          <div>
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
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Reset password
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
                              className="h-8 w-48"
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {users.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-3 text-sm text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
