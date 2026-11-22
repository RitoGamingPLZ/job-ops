import {
  Columns3,
  Eye,
  Files,
  Home,
  Inbox,
  LayoutDashboard,
  Library,
  Settings,
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
