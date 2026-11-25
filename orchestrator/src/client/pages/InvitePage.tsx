import { acceptInvitation, getInvitationPreview } from "@client/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { queryKeys } from "../lib/queryKeys";
import { rememberAuthUser } from "../lib/remembered-auth-users";

export function InvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ["auth", "invitation", token],
    queryFn: () => getInvitationPreview(token),
    retry: false,
    enabled: token.length > 0,
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setErrorMessage("Choose a username and a password.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);
    try {
      const user = await acceptInvitation(token, {
        username: normalizedUsername,
        password,
        displayName: displayName.trim() || normalizedUsername,
      });
      rememberAuthUser({ username: user.username, displayName: user.displayName });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.currentUser() });
      navigate("/overview", { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to accept the invitation");
      setIsBusy(false);
    }
  };

  const invalid = previewQuery.isError;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(120,119,198,0.08),_transparent_45%),linear-gradient(180deg,_rgba(15,23,42,0.02),_transparent_30%)] px-4 py-16">
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
        <Card className="w-full border-border/60 shadow-xl">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl tracking-tight">
              {invalid ? "Invitation unavailable" : "Join JobOps"}
            </CardTitle>
            <CardDescription>
              {invalid
                ? "This invitation link is invalid, already used, or has expired. Ask the person who invited you for a new one."
                : previewQuery.data
                  ? `You were invited as "${previewQuery.data.label}". Choose how you will sign in.`
                  : "Checking your invitation..."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invalid ? (
              <Button asChild variant="outline" className="w-full">
                <Link to="/sign-in">Go to sign in</Link>
              </Button>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="invite-display-name">
                    Name
                  </label>
                  <Input
                    id="invite-display-name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.currentTarget.value)}
                    placeholder="Your name"
                    disabled={isBusy || !previewQuery.data}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="invite-username">
                    Username
                  </label>
                  <Input
                    id="invite-username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.currentTarget.value)}
                    placeholder="Choose a username"
                    disabled={isBusy || !previewQuery.data}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="invite-password">
                    Password
                  </label>
                  <Input
                    id="invite-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    placeholder="At least 8 characters"
                    disabled={isBusy || !previewQuery.data}
                  />
                </div>
                {errorMessage ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage}
                  </p>
                ) : null}
                <Button className="w-full" type="submit" disabled={isBusy || !previewQuery.data}>
                  {isBusy ? "Creating account..." : "Create account"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
