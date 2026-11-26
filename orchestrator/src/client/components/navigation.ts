import type { UserPermissionKey, UserPermissions } from "@shared/types";
import {
  CalendarClock,
  Columns3,
  Eye,
  Files,
  Home,
  Inbox,
  LayoutDashboard,
  Library,
  MailPlus,
  Settings,
  Users,
} from "lucide-react";

export type NavLink = {
  to: string;
  label: string;
  icon: typeof Home;
  activePaths?: string[];
  requiredAnyPermissions?: readonly UserPermissionKey[];
  localOnly?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  {
    to: "/overview",
    label: "Overview",
    icon: Home,
    requiredAnyPermissions: ["jobs", "inProgress"],
  },
  {
    to: "/jobs/ready",
    label: "Jobs",
    icon: LayoutDashboard,
    activePaths: ["/jobs/ready", "/jobs/discovered", "/jobs/applied", "/jobs/all"],
    requiredAnyPermissions: ["jobs"],
  },
  {
    to: "/daily-search",
    label: "Daily search",
    icon: CalendarClock,
    requiredAnyPermissions: ["jobs"],
  },
  {
    to: "/applications/in-progress",
    label: "In Progress",
    icon: Columns3,
    activePaths: ["/applications/in-progress"],
    requiredAnyPermissions: ["inProgress"],
  },
  {
    to: "/resumes",
    label: "Resumes",
    icon: Files,
    activePaths: ["/resumes"],
    requiredAnyPermissions: ["resumes"],
  },
  {
    to: "/library",
    label: "Candidate Library",
    icon: Library,
    activePaths: ["/library"],
    requiredAnyPermissions: ["resumes"],
  },
  {
    to: "/tracking-inbox",
    label: "Tracking Inbox",
    icon: Inbox,
    requiredAnyPermissions: ["emailTracking"],
    localOnly: true,
  },
  {
    to: "/watchlist",
    label: "Watchlist",
    icon: Eye,
    requiredAnyPermissions: ["watchlist"],
  },
  { to: "/settings", label: "Settings", icon: Settings },
];

const DEFAULT_ROUTE_PRIORITY = [
  "/jobs/ready",
  "/applications/in-progress",
  "/resumes",
  "/library",
  "/watchlist",
  "/overview",
  "/tracking-inbox",
  "/settings",
] as const;

const FALLBACK_ROUTE_PRIORITY = [
  "/overview",
  "/jobs/ready",
  "/applications/in-progress",
  "/resumes",
  "/library",
  "/watchlist",
  "/tracking-inbox",
  "/settings",
] as const;

export function canAccessFeature(
  appMode: string,
  permissions: UserPermissions,
  requiredAnyPermissions?: readonly UserPermissionKey[],
  localOnly?: boolean,
): boolean {
  if (localOnly && appMode === "hosted") {
    return false;
  }
  if (appMode === "hosted" || !requiredAnyPermissions?.length) {
    return true;
  }
  return requiredAnyPermissions.some((key) => permissions[key]);
}

export function canAccessNavLink(
  link: Pick<NavLink, "requiredAnyPermissions" | "localOnly">,
  appMode: string,
  permissions: UserPermissions,
): boolean {
  return canAccessFeature(appMode, permissions, link.requiredAnyPermissions, link.localOnly);
}

function resolveFirstAccessiblePath(
  priority: readonly string[],
  appMode: string,
  permissions: UserPermissions,
): string {
  for (const path of priority) {
    const navLink = NAV_LINKS.find((link) => link.to === path);
    if (!navLink || canAccessNavLink(navLink, appMode, permissions)) {
      return path;
    }
  }
  return "/settings";
}

export function getDefaultUserPath(appMode: string, permissions: UserPermissions): string {
  return resolveFirstAccessiblePath(DEFAULT_ROUTE_PRIORITY, appMode, permissions);
}

export function getFallbackUserPath(appMode: string, permissions: UserPermissions): string {
  return resolveFirstAccessiblePath(FALLBACK_ROUTE_PRIORITY, appMode, permissions);
}

export const isNavActive = (pathname: string, to: string, activePaths?: string[]) => {
  if (pathname === to) return true;
  if (!activePaths) return false;
  return activePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

/** The system admin only manages users and server-wide settings, so job and resume pages are hidden. */
export const ADMIN_NAV_LINKS: NavLink[] = [
  { to: "/users", label: "Users", icon: Users },
  { to: "/invitations", label: "Invitations", icon: MailPlus },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Paths a system admin may open; every other app route redirects to the Users page. */
export const ADMIN_ALLOWED_PATHS = ["/users", "/invitations", "/settings", "/oauth/gmail/callback"];
