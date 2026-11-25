import {
  Columns3,
  Eye,
  Files,
  Home,
  Inbox,
  LayoutDashboard,
  Library,
  Settings,
  Users,
} from "lucide-react";

export type NavLink = {
  to: string;
  label: string;
  icon: typeof Home;
  activePaths?: string[];
};

export const NAV_LINKS: NavLink[] = [
  { to: "/overview", label: "Overview", icon: Home },
  {
    to: "/jobs/ready",
    label: "Jobs",
    icon: LayoutDashboard,
    activePaths: ["/jobs/ready", "/jobs/discovered", "/jobs/applied", "/jobs/all"],
  },
  {
    to: "/applications/in-progress",
    label: "In Progress",
    icon: Columns3,
    activePaths: ["/applications/in-progress"],
  },
  {
    to: "/resumes",
    label: "Resumes",
    icon: Files,
    activePaths: ["/resumes"],
  },
  {
    to: "/library",
    label: "Candidate Library",
    icon: Library,
    activePaths: ["/library"],
  },
  { to: "/tracking-inbox", label: "Tracking Inbox", icon: Inbox },
  { to: "/watchlist", label: "Watchlist", icon: Eye },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const isNavActive = (pathname: string, to: string, activePaths?: string[]) => {
  if (pathname === to) return true;
  if (!activePaths) return false;
  return activePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

/** The system admin only manages users and server-wide settings, so job and resume pages are hidden. */
export const ADMIN_NAV_LINKS: NavLink[] = [
  { to: "/users", label: "Users", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Paths a system admin may open; every other app route redirects to the Users page. */
export const ADMIN_ALLOWED_PATHS = ["/users", "/settings", "/oauth/gmail/callback"];
