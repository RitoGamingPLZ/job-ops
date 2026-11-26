/**
 * Shared layout components for consistent page structure.
 */

import { getAppStatus, getCurrentAuthUser, logout } from "@client/api";
import { DEFAULT_USER_PERMISSIONS, type UserPermissions } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LogOut, type LucideIcon, Menu, Moon, Sun, UserRound } from "lucide-react";
import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useVersionCheck } from "../hooks/useVersionCheck";
import { queryKeys } from "../lib/queryKeys";
import { loadRememberedAuthUsers, type RememberedAuthUser } from "../lib/remembered-auth-users";
import { useTheme } from "../lib/theme";
import { useAuthSession } from "../hooks/useAuthSession";
import { ADMIN_NAV_LINKS, canAccessNavLink, isNavActive, NAV_LINKS } from "./navigation";
import { StatusBadgeIndicator } from "./StatusIndicator";
import { Tip } from "./Tip";

export const AppModeContext = React.createContext({
  appMode: "local" as "local" | "hosted",
  isPending: false,
  isSystemAdmin: false,
  // The system admin gets a console with only users and server-wide settings (self-hosted only).
  isAdminConsole: false,
  permissions: { ...DEFAULT_USER_PERMISSIONS } as UserPermissions,
});

export const AppModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const appStatusQuery = useQuery({
    queryKey: queryKeys.app.status(),
    queryFn: getAppStatus,
  });

  // Operator-only features (Tracking Inbox, webhooks) are hidden for other users.
  const hasSession = useAuthSession();
  const currentUserQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: getCurrentAuthUser,
    enabled: hasSession,
    retry: false,
    staleTime: 60_000,
  });

  return (
    <AppModeContext.Provider
      value={{
        appMode: appStatusQuery.data?.appMode ?? "local",
        isPending: appStatusQuery.isPending || (hasSession && currentUserQuery.isPending),
        isSystemAdmin: currentUserQuery.data?.isSystemAdmin === true,
        isAdminConsole:
          currentUserQuery.data?.isSystemAdmin === true &&
          appStatusQuery.data?.appMode !== "hosted",
        permissions: currentUserQuery.data?.permissions ?? DEFAULT_USER_PERMISSIONS,
      }}
    >
      {children}
    </AppModeContext.Provider>
  );
};

const ADMIN_ONLY_PATHS = ["/users", "/invitations"];

const buildSignInPath =(username: string, nextPath: string): string => {
  const params = new URLSearchParams();
  params.set("user", username);
  if (nextPath && nextPath !== "/sign-in" && !nextPath.startsWith("/sign-in?")) {
    params.set("next", nextPath);
  }
  return `/sign-in?${params.toString()}`;
};

// ============================================================================
// App sidebar (persistent on >= lg, inside a Sheet below)
// ============================================================================

const SidebarNav: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
  const location = useLocation();
  const { appMode, permissions, isAdminConsole, isPending } = React.useContext(AppModeContext);
  const navLinks = isAdminConsole
    ? ADMIN_NAV_LINKS
    : isPending
      ? []
      : NAV_LINKS.filter((link) => canAccessNavLink(link, appMode, permissions));

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {navLinks.map(({ to, label, icon: NavIcon, activePaths }) => {
        const active = isNavActive(location.pathname, to, activePaths);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70",
            )}
          >
            <NavIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-sidebar-foreground/70"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
};

const SidebarContent: React.FC<{ onNavigate?: () => void; showVersionFooter?: boolean }> = ({
  onNavigate,
  showVersionFooter = true,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { version, updateAvailable } = useVersionCheck();
  const [rememberedUsers, setRememberedUsers] = useState<RememberedAuthUser[]>(() =>
    loadRememberedAuthUsers(),
  );

  const handleRememberedUserClick = async (username: string) => {
    onNavigate?.();
    await logout({ redirect: false });
    const nextPath =
      ADMIN_ONLY_PATHS.some(
        (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
      )
        ? "/"
        : location.pathname;
    navigate(buildSignInPath(username, nextPath), { replace: true });
  };

  const handleSignOut = async () => {
    onNavigate?.();
    await logout();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        <img src="/favicon.png" alt="" className="h-5 w-5 rounded-md" />
        <span className="text-sm font-semibold tracking-tight">job-ops</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav onNavigate={onNavigate} />
      </div>
      <div className="shrink-0 space-y-1 border-t border-sidebar-border px-2 py-2">
        <div className="flex items-center gap-1">
          <DropdownMenu
            onOpenChange={(open) => open && setRememberedUsers(loadRememberedAuthUsers())}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 min-w-0 flex-1 justify-start gap-2 px-2 text-[13px] text-sidebar-foreground/70"
              >
                <UserRound className="h-4 w-4" />
                <span>Account</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Remembered</DropdownMenuLabel>
              {rememberedUsers.length > 0 ? (
                rememberedUsers.map((user) => (
                  <DropdownMenuItem
                    key={user.username}
                    onSelect={() => void handleRememberedUserClick(user.username)}
                    className="flex min-w-0 items-start gap-2"
                  >
                    <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {user.displayName ?? user.username}
                      </span>
                      {user.displayName ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {user.username}
                        </span>
                      ) : null}
                    </span>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>
                  Sign in once to remember a username here.
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleSignOut()} className="gap-2">
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle />
        </div>
        {showVersionFooter && (
          <div className="flex items-center justify-between gap-2 px-2 pt-1 text-xs text-muted-foreground">
            <a
              href="https://github.com/DaKheera47/job-ops/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-2 transition-colors hover:text-foreground"
            >
              <span className="truncate">Version {version}</span>
              {updateAvailable && (
                <Tip asChild content={<p>Update available</p>}>
                  <span className="h-2 w-2 shrink-0 cursor-pointer rounded-full bg-success" />
                </Tip>
              )}
            </a>
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1 transition-colors hover:text-foreground"
            >
              Docs
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

/** Persistent left sidebar; hidden below lg (PageHeader opens the same content in a Sheet). */
export const AppSidebar: React.FC = () => (
  <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-sidebar-border lg:block">
    <SidebarContent />
  </aside>
);

// ============================================================================
// Page Header (slim 44px top bar inside the content area)
// ============================================================================

interface PageHeaderProps {
  icon: LucideIcon | React.FC<{ className?: string }>;
  title: string;
  subtitle: string;
  badge?: string;
  statusIndicator?: React.ReactNode;
  actions?: React.ReactNode;
  showVersionFooter?: boolean;
  navOpen?: boolean;
  onNavOpenChange?: (open: boolean) => void;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  icon: Icon,
  title,
  subtitle,
  badge,
  statusIndicator,
  actions,
  showVersionFooter = true,
  navOpen: controlledNavOpen,
  onNavOpenChange,
}) => {
  const [internalNavOpen, setInternalNavOpen] = useState(false);
  const navOpen = controlledNavOpen ?? internalNavOpen;
  const setNavOpen = onNavOpenChange ?? setInternalNavOpen;

  return (
    <header className="sticky top-0 z-40 flex h-11 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-w-0 items-center gap-2">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-ml-2 h-7 w-7 lg:hidden">
              <Menu className="h-4 w-4" />
              <span className="sr-only">Open navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-60 bg-sidebar p-0 sm:max-w-60">
            <SheetHeader className="sr-only">
              <SheetTitle>job-ops</SheetTitle>
            </SheetHeader>
            <SidebarContent
              onNavigate={() => setNavOpen(false)}
              showVersionFooter={showVersionFooter}
            />
          </SheetContent>
        </Sheet>

        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="truncate text-sm font-medium tracking-tight">{title}</div>
        <div className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</div>
        {badge && (
          <Badge variant="outline" className="uppercase tracking-wide">
            {badge}
          </Badge>
        )}
        {statusIndicator}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
    </header>
  );
};

export const StatusIndicator = StatusBadgeIndicator;

// ============================================================================
// List Panel (left side of split)
// ============================================================================

interface ListPanelProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const ListPanel: React.FC<ListPanelProps> = ({ children, header, footer, className }) => (
  <div className={cn("flex min-w-0 flex-col rounded-lg border bg-card", className)}>
    {header && <div className="border-b px-3 py-2">{header}</div>}
    <div className="flex-1 divide-y divide-border overflow-y-auto">{children}</div>
    {footer && <div className="border-t px-3 py-2">{footer}</div>}
  </div>
);

// ============================================================================
// List Item (clickable row in list)
// ============================================================================

interface ListItemProps {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export const ListItem: React.FC<ListItemProps> = ({ selected, onClick, children, className }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors",
      selected ? "bg-accent" : "hover:bg-accent/50",
      className,
    )}
    aria-pressed={selected}
  >
    {children}
  </button>
);

// ============================================================================
// Empty State
// ============================================================================

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
    {Icon && <Icon className="mb-2 h-8 w-8 text-muted-foreground/50" />}
    <div className="text-sm font-medium">{title}</div>
    {description && <p className="max-w-md text-[13px] text-muted-foreground">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

// ============================================================================
// Page Main Content Wrapper
// ============================================================================

interface PageMainProps {
  children: React.ReactNode;
  className?: string;
}

export const PageMain: React.FC<PageMainProps> = ({ children, className }) => (
  <main className={cn("mx-auto w-full max-w-screen-2xl space-y-4 px-4 py-4 pb-12", className)}>
    {children}
  </main>
);

// ============================================================================
// Right sidebar + property rows (Linear-style detail/filters panel)
// ============================================================================

interface RightSidebarProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Fixed-width right panel. Renders nothing under lg; callers provide a Sheet fallback there. */
export const RightSidebar: React.FC<RightSidebarProps> = ({ title, children, className }) => {
  const isDesktop = useMediaQuery("(min-width: 1024px)", "false");
  // No matchMedia (jsdom): assume desktop so tests can see the content.
  const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
  if (hasMatchMedia && !isDesktop) return null;

  return (
    <aside
      className={cn(
        "sticky top-11 h-[calc(100dvh-2.75rem)] w-72 shrink-0 self-start overflow-y-auto border-l bg-sidebar",
        className,
      )}
    >
      {title ? (
        <div className="flex h-10 items-center border-b px-4 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </aside>
  );
};

interface PropertyRowProps {
  label: React.ReactNode;
  children: React.ReactNode;
}

export const PropertyRow: React.FC<PropertyRowProps> = ({ label, children }) => (
  <div className="flex min-h-7 items-start gap-2 py-1 text-[13px]">
    <div className="w-24 shrink-0 pt-px text-muted-foreground">{label}</div>
    <div className="min-w-0 flex-1 break-words text-foreground">{children}</div>
  </div>
);
