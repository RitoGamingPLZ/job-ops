import { redirectToSignIn } from "@client/lib/auth-navigation";
import type {
  AuthUser,
  CreatedUserInvitation,
  UserInvitation,
  UserInvitationPreview,
  UserPermissions,
} from "@shared/types";
import type { AuthCredentials } from "./auth-session";
import { clearAuthSession, getCachedAuthHeader, setAuthenticatedSession } from "./auth-session";
import { fetchApi, performLoginWithCredentials, readAuthResponse, toApiError } from "./core";

export type CodexAuthStatusResponse = {
  authenticated: boolean;
  username: string | null;
  validationMessage: string | null;
  flowStatus: string;
  loginInProgress: boolean;
  verificationUrl: string | null;
  userCode: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  flowMessage: string | null;
};

export type { AuthCredentials, AuthUser };

export type AuthBootstrapStatus = {
  setupRequired: boolean;
};

export type CurrentAuthContext = {
  user: AuthUser;
  analyticsDistinctId: string | null;
};

export async function signInWithCredentials(username: string, password: string): Promise<void> {
  return performLoginWithCredentials(username, password);
}

export async function getAuthBootstrapStatus(): Promise<AuthBootstrapStatus> {
  return fetchApi<AuthBootstrapStatus>("/auth/bootstrap-status");
}

type RegistrationInput = {
  username: string;
  password: string;
  displayName?: string;
};

async function registerWithCredentials(
  endpoint: string,
  input: RegistrationInput,
  incompleteMessage: string,
): Promise<AuthUser> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = await readAuthResponse<{
    token: string;
    user: AuthUser;
  }>(res);
  if ("ok" in parsed ? !parsed.ok : !parsed.success) throw toApiError(res, parsed);
  const data = ("data" in parsed ? parsed.data : undefined) as
    | { token?: string; user?: AuthUser }
    | undefined;
  if (!data?.token || !data.user) {
    throw new Error(incompleteMessage);
  }
  setAuthenticatedSession(data.token, data.user);
  return data.user;
}

export async function setupFirstAdmin(input: RegistrationInput): Promise<AuthUser> {
  return registerWithCredentials("/api/auth/setup", input, "Setup response was incomplete");
}

export async function signupWithCredentials(input: RegistrationInput): Promise<AuthUser> {
  return registerWithCredentials("/api/auth/signup", input, "Signup response was incomplete");
}

export async function getCurrentAuthContext(): Promise<CurrentAuthContext> {
  const result = await fetchApi<{
    user: AuthUser;
    analyticsDistinctId?: string | null;
  }>("/auth/me");
  return {
    user: result.user,
    analyticsDistinctId: result.analyticsDistinctId ?? null,
  };
}

export async function getCurrentAuthUser(): Promise<AuthUser> {
  const result = await getCurrentAuthContext();
  return result.user;
}

export {
  recoverAuthHeaderAfterUnauthorized,
  restoreAuthSessionFromLegacyCredentials,
} from "./core";

export async function logout(options: { redirect?: boolean } = {}): Promise<void> {
  const authHeader = getCachedAuthHeader();
  if (authHeader) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: authHeader },
      });
    } catch {
      // Best-effort server-side invalidation.
    }
  }
  clearAuthSession();
  if (options.redirect ?? true) {
    redirectToSignIn();
  }
}

export async function listWorkspaceUsers(): Promise<AuthUser[]> {
  const result = await fetchApi<{ users: AuthUser[] }>("/workspaces/users");
  return result.users;
}

export async function createWorkspaceUser(input: {
  username: string;
  password: string;
  displayName?: string;
  isSystemAdmin?: boolean;
  mustChangePassword?: boolean;
  permissions?: Partial<UserPermissions>;
}): Promise<AuthUser> {
  const result = await fetchApi<{ user: AuthUser }>("/workspaces/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.user;
}

export async function setWorkspaceUserDisabled(
  userId: string,
  isDisabled: boolean,
): Promise<AuthUser> {
  const result = await fetchApi<{ user: AuthUser }>(
    `/workspaces/users/${encodeURIComponent(userId)}/disabled`,
    {
      method: "PATCH",
      body: JSON.stringify({ isDisabled }),
    },
  );
  return result.user;
}

export async function resetWorkspaceUserPassword(userId: string, password: string): Promise<void> {
  await fetchApi<{ userId: string }>(
    `/workspaces/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  );
}

export async function changeOwnPassword(input: {
  password: string;
  currentPassword?: string;
}): Promise<void> {
  await fetchApi<{ userId: string }>("/workspaces/me/password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function setWorkspaceUserPermissions(
  userId: string,
  permissions: Partial<UserPermissions>,
): Promise<AuthUser> {
  const result = await fetchApi<{ user: AuthUser }>(
    `/workspaces/users/${encodeURIComponent(userId)}/permissions`,
    {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    },
  );
  return result.user;
}

export async function listUserInvitations(): Promise<UserInvitation[]> {
  const result = await fetchApi<{ invitations: UserInvitation[] }>("/workspaces/invitations");
  return result.invitations;
}

export async function createUserInvitation(input: {
  label: string;
  permissions?: Partial<UserPermissions>;
  expiresInDays?: number;
}): Promise<CreatedUserInvitation> {
  const result = await fetchApi<{ invitation: CreatedUserInvitation }>("/workspaces/invitations", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.invitation;
}

export async function revokeUserInvitation(invitationId: string): Promise<void> {
  await fetchApi<{ id: string }>(`/workspaces/invitations/${encodeURIComponent(invitationId)}`, {
    method: "DELETE",
  });
}

export async function getInvitationPreview(token: string): Promise<UserInvitationPreview> {
  return fetchApi<UserInvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`);
}

export async function acceptInvitation(token: string, input: RegistrationInput): Promise<AuthUser> {
  return registerWithCredentials(
    `/api/auth/invitations/${encodeURIComponent(token)}/accept`,
    input,
    "Invitation response was incomplete",
  );
}
