import * as api from "@client/api";
import { useAuthSession } from "@client/hooks/useAuthSession";
import { queryKeys } from "@client/lib/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ForcedPasswordResetGateProps = {
  children: React.ReactNode;
};

export const ForcedPasswordResetGate: React.FC<ForcedPasswordResetGateProps> = ({ children }) => {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBypassedRoute =
    location.pathname === "/sign-in" ||
    location.pathname === "/offline" ||
    location.pathname.startsWith("/sso/callback/") ||
    location.pathname.startsWith("/invite/");
  const hasSession = useAuthSession();

  const meQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: api.getCurrentAuthUser,
    enabled: !isBypassedRoute && hasSession,
    retry: false,
  });

  const changePasswordMutation = useMutation({
    mutationFn: api.changeOwnPassword,
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setErrorMessage(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.currentUser(),
      });
      await meQuery.refetch();
      toast.success("Password updated");
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update password.");
    },
  });

  if (isBypassedRoute || !hasSession || !meQuery.data?.mustChangePassword) {
    return <>{children}</>;
  }

  const user = meQuery.data;
  const hasPassword = user.hasPassword;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (hasPassword && !currentPassword) {
      setErrorMessage("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters.");
      return;
    }
    if (hasPassword && newPassword === currentPassword) {
      setErrorMessage("Choose a new password that differs from your current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("New password and confirmation do not match.");
      return;
    }

    changePasswordMutation.mutate({
      password: newPassword,
      ...(hasPassword ? { currentPassword } : {}),
    });
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(120,119,198,0.08),_transparent_45%),linear-gradient(180deg,_rgba(15,23,42,0.02),_transparent_30%)] px-4 py-16">
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
        <Card className="w-full border-border/60 shadow-xl">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl tracking-tight">Reset your password</CardTitle>
            <CardDescription>
              Set a new password for {user.username} before continuing to JobOps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {hasPassword ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="forced-reset-current-password">
                    Current password
                  </label>
                  <Input
                    id="forced-reset-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                    placeholder="Enter current password"
                    disabled={changePasswordMutation.isPending}
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="forced-reset-new-password">
                  New password
                </label>
                <Input
                  id="forced-reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  placeholder="At least 8 characters"
                  disabled={changePasswordMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="forced-reset-confirm-password">
                  Confirm new password
                </label>
                <Input
                  id="forced-reset-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                  placeholder="Re-enter new password"
                  disabled={changePasswordMutation.isPending}
                />
              </div>
              {errorMessage ? (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              <Button className="w-full" type="submit" disabled={changePasswordMutation.isPending}>
                {changePasswordMutation.isPending ? "Updating password..." : "Update password"}
              </Button>
              <Button
                className="w-full"
                type="button"
                variant="ghost"
                disabled={changePasswordMutation.isPending}
                onClick={() => void api.logout()}
              >
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
