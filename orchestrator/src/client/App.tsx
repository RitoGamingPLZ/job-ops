/**
 * Main App component.
 */

import { X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { CSSTransition, SwitchTransition } from "react-transition-group";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ForcedPasswordResetGate } from "./components/ForcedPasswordResetGate";
import { AppModeContext, AppSidebar } from "./components/layout";
import { ADMIN_ALLOWED_PATHS } from "./components/navigation";
import { OnboardingGate } from "./components/OnboardingGate";
import { useAnalyticsIdentity } from "./hooks/useAnalyticsIdentity";
import { useDemoInfo } from "./hooks/useDemoInfo";
import { setAuthNavigator } from "./lib/auth-navigation";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { GmailOauthCallbackPage } from "./pages/GmailOauthCallbackPage";
import { HomePage } from "./pages/HomePage";
import { InProgressBoardPage } from "./pages/InProgressBoardPage";
import { JobPage } from "./pages/JobPage";
import { OfflinePage } from "./pages/OfflinePage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OrchestratorPage } from "./pages/OrchestratorPage";
import { ResumeCoworkPage } from "./pages/ResumeCoworkPage";
import { ResumeLibraryPage, ResumesPage } from "./pages/ResumesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { InvitePage } from "./pages/InvitePage";
import { SignInPage } from "./pages/SignInPage";
import { SsoCallbackPage } from "./pages/SsoCallbackPage";
import { TrackingInboxPage } from "./pages/TrackingInboxPage";
import { WatchlistPage } from "./pages/WatchlistPage";

/** Backwards-compatibility redirects: old URL paths -> new URL paths */
const REDIRECTS: Array<{ from: string; to: string }> = [
  { from: "/", to: "/jobs/ready" },
  { from: "/home", to: "/overview" },
  { from: "/ready", to: "/jobs/ready" },
  { from: "/ready/:jobId", to: "/jobs/ready/:jobId" },
  { from: "/discovered", to: "/jobs/discovered" },
  { from: "/discovered/:jobId", to: "/jobs/discovered/:jobId" },
  { from: "/applied", to: "/jobs/applied" },
  { from: "/applied/:jobId", to: "/jobs/applied/:jobId" },
  { from: "/in-progress", to: "/applications/in-progress" },
  { from: "/in-progress/:jobId", to: "/applications/in-progress" },
  { from: "/jobs/in_progress", to: "/applications/in-progress" },
  { from: "/jobs/in_progress/:jobId", to: "/applications/in-progress" },
  { from: "/all", to: "/jobs/all" },
  { from: "/all/:jobId", to: "/jobs/all/:jobId" },
];

/** Full-screen pages that render without the app sidebar. */
const STANDALONE_PATHS = new Set(["/onboarding", "/offline", "/oauth/gmail/callback"]);

const DEMO_WAITLIST_BANNER_DISMISSED_KEY = "jobops.demoWaitlistBannerDismissed";

export const App: React.FC = () => {
  useAnalyticsIdentity();
  const location = useLocation();
  const navigate = useNavigate();
  const nodeRef = useRef<HTMLDivElement>(null);
  const isAuthRoute =
    location.pathname === "/sign-in" ||
    location.pathname.startsWith("/sso/callback/") ||
    location.pathname.startsWith("/invite/");
  const demoInfo = useDemoInfo({ enabled: !isAuthRoute });
  const showDemoBanners = !isAuthRoute && demoInfo?.demoMode;
  const showSidebar = !isAuthRoute && !STANDALONE_PATHS.has(location.pathname);
  // The system admin only manages users and server settings: job and resume pages send them to Users.
  const { isAdminConsole } = React.useContext(AppModeContext);
  const adminMustRedirect =
    isAdminConsole &&
    !isAuthRoute &&
    !STANDALONE_PATHS.has(location.pathname) &&
    !ADMIN_ALLOWED_PATHS.some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );
  const [demoWaitlistBannerDismissed, setDemoWaitlistBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(DEMO_WAITLIST_BANNER_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Determine a stable key for transitions to avoid unnecessary unmounts when switching sub-tabs
  const pageKey = React.useMemo(() => {
    const firstSegment = location.pathname.split("/")[1] || "jobs";
    if (firstSegment === "jobs") {
      return "orchestrator";
    }
    return firstSegment;
  }, [location.pathname]);

  useEffect(() => {
    setAuthNavigator((nextPath) => {
      const search = new URLSearchParams();
      if (nextPath && nextPath !== "/sign-in" && !nextPath.startsWith("/sign-in?")) {
        search.set("next", nextPath);
      }
      navigate(`/sign-in${search.toString() ? `?${search.toString()}` : ""}`, {
        replace: true,
      });
    });

    return () => {
      setAuthNavigator(null);
    };
  }, [navigate]);

  return (
    <>
      <ForcedPasswordResetGate>
        <OnboardingGate />
        <div className="flex min-h-dvh">
          {showSidebar && <AppSidebar />}
          <div className="min-w-0 flex-1">
            {showDemoBanners && (
              <div className="sticky top-0 z-50 w-full border-b border-warning/40 bg-warning/15 px-4 py-2 text-xs text-warning backdrop-blur">
                <div className="mx-auto flex items-center justify-center gap-3">
                  <p className="flex-1 text-center">
                    <span className="font-medium">
                      Demo mode: integrations are simulated and data resets every{" "}
                      {demoInfo.resetCadenceHours} hours.
                    </span>
                    {!demoWaitlistBannerDismissed && (
                      <>
                        {" "}
                        This is a read-only demo. Want JobOps without the Docker setup?{" "}
                        <a
                          className="font-semibold underline underline-offset-2 hover:text-warning/80"
                          href="https://try.jobops.app?utm_source=demo&utm_medium=banner&utm_campaign=waitlist"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Join the waitlist.
                        </a>
                      </>
                    )}
                  </p>
                  {!demoWaitlistBannerDismissed && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 rounded-full text-warning hover:bg-warning/20 hover:text-warning"
                      onClick={() => {
                        setDemoWaitlistBannerDismissed(true);
                        try {
                          localStorage.setItem(DEMO_WAITLIST_BANNER_DISMISSED_KEY, "1");
                        } catch {
                          // Ignore storage errors in restricted browser contexts.
                        }
                      }}
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Dismiss demo waitlist banner</span>
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div>
              <SwitchTransition mode="out-in">
                <CSSTransition
                  key={pageKey}
                  nodeRef={nodeRef}
                  timeout={100}
                  classNames="page"
                  unmountOnExit
                >
                  <div ref={nodeRef}>
                    {adminMustRedirect ? (
                      <Navigate to="/users" replace />
                    ) : (
                      <Routes location={location}>
                        {/* Backwards-compatibility redirects */}
                        {REDIRECTS.map(({ from, to }) => (
                          <Route key={from} path={from} element={<Navigate to={to} replace />} />
                        ))}

                        {/* Application routes */}
                        <Route path="/overview" element={<HomePage />} />
                        <Route path="/oauth/gmail/callback" element={<GmailOauthCallbackPage />} />
                        <Route path="/job/:id" element={<JobPage />} />
                        <Route path="/job/:id/:view" element={<JobPage />} />
                        <Route path="/applications/in-progress" element={<InProgressBoardPage />} />
                        <Route path="/resumes" element={<ResumesPage />} />
                        <Route path="/library" element={<ResumeLibraryPage />} />
                        <Route
                          path="/resumes/library"
                          element={<Navigate to="/library" replace />}
                        />
                        <Route path="/resumes/base" element={<ResumeCoworkPage base />} />
                        <Route path="/resumes/:jobId" element={<ResumeCoworkPage />} />
                        <Route
                          path="/design-resume"
                          element={<Navigate to="/resumes/base" replace />}
                        />
                        <Route
                          path="/design-resume/:section"
                          element={<Navigate to="/resumes/base" replace />}
                        />
                        <Route path="/onboarding" element={<OnboardingPage />} />
                        <Route path="/offline" element={<OfflinePage />} />
                        <Route path="/sign-in" element={<SignInPage />} />
                        <Route path="/invite/:token" element={<InvitePage />} />
                        <Route path="/sso/callback/:provider" element={<SsoCallbackPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/users" element={<AdminUsersRoute />} />
                        <Route path="/tracking-inbox" element={<TrackingInboxRoute />} />
                        <Route path="/watchlist" element={<WatchlistPage />} />
                        <Route path="/jobs/:tab" element={<OrchestratorPage />} />
                        <Route path="/jobs/:tab/:jobId" element={<OrchestratorPage />} />
                      </Routes>
                    )}
                  </div>
                </CSSTransition>
              </SwitchTransition>
            </div>
          </div>
        </div>
      </ForcedPasswordResetGate>

      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
};

function AdminUsersRoute() {
  const { isAdminConsole, isPending } = React.useContext(AppModeContext);

  if (isPending) return null;
  if (!isAdminConsole) return <Navigate to="/overview" replace />;
  return <AdminUsersPage />;
}

function TrackingInboxRoute() {
  const { appMode, isPending, permissions } = React.useContext(AppModeContext);

  if (isPending) return null;
  if (appMode === "hosted" || !permissions.emailTracking) {
    return <Navigate to="/overview" replace />;
  }
  return <TrackingInboxPage />;
}
