/**
 * Per-user feature switches an admin controls for invited (non-admin) users.
 * System admins always have every permission.
 */
export const USER_FEATURE_PERMISSION_KEYS = ["jobs", "watchlist", "inProgress", "resumes"] as const;

export const USER_ACCESS_PERMISSION_KEYS = [
  "defaultModel",
  "serverCredentials",
  "emailTracking",
  "webhooks",
  "pipeline",
  "urlImport",
] as const;

export const USER_PERMISSION_KEYS = [
  ...USER_FEATURE_PERMISSION_KEYS,
  ...USER_ACCESS_PERMISSION_KEYS,
] as const;

export type UserPermissionKey = (typeof USER_PERMISSION_KEYS)[number];

export type UserPermissions = Record<UserPermissionKey, boolean>;

/** What a freshly invited user may do until an admin changes it. */
export const DEFAULT_USER_PERMISSIONS: Readonly<UserPermissions> = {
  jobs: true,
  watchlist: true,
  inProgress: true,
  resumes: true,
  defaultModel: false,
  serverCredentials: false,
  emailTracking: false,
  webhooks: false,
  pipeline: true,
  urlImport: true,
};

export const USER_PERMISSION_LABELS: Readonly<
  Record<UserPermissionKey, { label: string; description: string }>
> = {
  jobs: {
    label: "Job posts",
    description: "Browse job posts, open job details, and view the Overview dashboard.",
  },
  watchlist: {
    label: "Watchlist",
    description: "Monitor company career pages and use Watchlist sources.",
  },
  inProgress: {
    label: "In-progress jobs",
    description: "Track active applications on the In Progress board and update interview stages.",
  },
  resumes: {
    label: "Resumes & library",
    description:
      "Edit base and job resumes, preview or generate PDFs, and manage the Candidate Library.",
  },
  defaultModel: {
    label: "Access to default AI model",
    description:
      "Lets this user use the server's default AI model without adding their own API key. Off means they must add their own key before using JobOps.",
  },
  serverCredentials: {
    label: "Use server job-source keys",
    description: "Lets this user run job sources backed by your server's Adzuna credentials.",
  },
  emailTracking: {
    label: "Email tracking inbox",
    description: "Connect a Gmail account and use the tracking inbox.",
  },
  webhooks: {
    label: "Webhooks",
    description: "Configure outgoing webhooks that post job data to a URL they choose.",
  },
  pipeline: {
    label: "Run job searches",
    description:
      "Start the job discovery pipeline. Off makes the workspace read-only for discovery.",
  },
  urlImport: {
    label: "Import jobs from a URL",
    description: "Let the server fetch a job posting page on their behalf.",
  },
};

/** Applies stored overrides (which may be partial or stale) on top of the defaults. */
export function resolveUserPermissions(overrides: unknown): UserPermissions {
  const resolved: UserPermissions = { ...DEFAULT_USER_PERMISSIONS };
  if (overrides && typeof overrides === "object") {
    for (const key of USER_PERMISSION_KEYS) {
      const value = (overrides as Record<string, unknown>)[key];
      if (typeof value === "boolean") resolved[key] = value;
    }
  }
  return resolved;
}

export const ALL_USER_PERMISSIONS_GRANTED: Readonly<UserPermissions> = {
  jobs: true,
  watchlist: true,
  inProgress: true,
  resumes: true,
  defaultModel: true,
  serverCredentials: true,
  emailTracking: true,
  webhooks: true,
  pipeline: true,
  urlImport: true,
};

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  isSystemAdmin: boolean;
  isDisabled: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  workspaceId: string;
  workspaceName: string;
  /** Effective permissions: always all true for system admins. */
  permissions: UserPermissions;
  createdAt: string;
  updatedAt: string;
}

export type UserInvitationStatus = "pending" | "used" | "expired" | "revoked";

export interface UserInvitation {
  id: string;
  label: string;
  permissions: UserPermissions;
  status: UserInvitationStatus;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  usedByUsername: string | null;
  /** Raw invite token, only present while the invitation is pending (admin-only listing). */
  token?: string | null;
}

/** Returned at creation time, with the raw token needed to build the invite link. */
export interface CreatedUserInvitation extends UserInvitation {
  token: string;
}

export interface UserInvitationPreview {
  label: string;
  expiresAt: string;
}
