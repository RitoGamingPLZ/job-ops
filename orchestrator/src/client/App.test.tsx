import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AppModeContext } from "./components/layout";
import { useDemoInfo } from "./hooks/useDemoInfo";

vi.mock("./hooks/useDemoInfo", () => ({
  useDemoInfo: vi.fn(),
}));

vi.mock("react-transition-group", () => ({
  SwitchTransition: ({ children }: { children: React.ReactNode }) => children,
  CSSTransition: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("./components/ForcedPasswordResetGate", () => ({
  ForcedPasswordResetGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./components/OnboardingGate", () => ({
  OnboardingGate: () => null,
}));

vi.mock("./pages/AdminUsersPage", () => ({
  AdminUsersPage: () => <div>admin-users</div>,
}));

vi.mock("./pages/GmailOauthCallbackPage", () => ({
  GmailOauthCallbackPage: () => null,
}));

vi.mock("./pages/HomePage", () => ({
  HomePage: () => <div>overview</div>,
}));

vi.mock("./pages/InProgressBoardPage", () => ({
  InProgressBoardPage: () => <div>in-progress-board</div>,
}));

vi.mock("./pages/JobPage", () => ({
  JobPage: () => <div>job-detail</div>,
}));

vi.mock("./pages/OnboardingPage", () => ({
  OnboardingPage: () => <div>onboarding</div>,
}));

vi.mock("./pages/OrchestratorPage", () => ({
  OrchestratorPage: () => <div>jobs-page</div>,
}));

vi.mock("./pages/SettingsPage", () => ({
  SettingsPage: () => <div>settings-page</div>,
}));

vi.mock("./pages/ResumeCoworkPage", () => ({
  ResumeCoworkPage: ({ base }: { base?: boolean }) => (
    <div>{base ? "base-resume-editor" : "job-resume-editor"}</div>
  ),
}));

vi.mock("./pages/ResumesPage", () => ({
  ResumesPage: () => <div>resumes-page</div>,
  ResumeLibraryPage: () => <div>candidate-library</div>,
}));

vi.mock("./pages/SignInPage", () => ({
  SignInPage: () => <div>sign-in</div>,
}));

vi.mock("./pages/TrackingInboxPage", () => ({
  TrackingInboxPage: () => <div>tracking-inbox</div>,
}));

vi.mock("./pages/VisaSponsorsPage", () => ({
  VisaSponsorsPage: () => null,
}));

vi.mock("./pages/WatchlistPage", () => ({
  WatchlistPage: () => <div>watchlist-page</div>,
}));

describe("App demo banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows a waitlist link in demo mode", () => {
    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: true,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <App />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Join the waitlist." });
    expect(link).toHaveAttribute(
      "href",
      "https://try.jobops.app?utm_source=demo&utm_medium=banner&utm_campaign=waitlist",
    );
  });

  it("does not render the demo banner waitlist link when demo mode is disabled", () => {
    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: false,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "try.jobops.app" })).toBeNull();
  });

  it("does not fetch demo info while rendering the sign-in page", () => {
    vi.mocked(useDemoInfo).mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("sign-in")).toBeInTheDocument();
    expect(useDemoInfo).toHaveBeenCalledWith({ enabled: false });
  });

  it("lets the user dismiss the waitlist banner and keeps it hidden", () => {
    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: true,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /dismiss demo waitlist banner/i }));

    expect(screen.queryByRole("link", { name: "try.jobops.app" })).toBeNull();
    expect(localStorage.getItem("jobops.demoWaitlistBannerDismissed")).toBe("1");
  });

  it.each(["/design-resume", "/design-resume/experience"])(
    "redirects %s to the base editor",
    (path) => {
      vi.mocked(useDemoInfo).mockReturnValue({
        demoMode: false,
        resetCadenceHours: 6,
        lastResetAt: null,
        nextResetAt: null,
        baselineVersion: null,
        baselineName: null,
      });

      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );

      expect(screen.getByText("base-resume-editor")).toBeInTheDocument();
    },
  );

  it("redirects hosted users away from Tracking Inbox", () => {
    vi.mocked(useDemoInfo).mockReturnValue({
      demoMode: false,
      resetCadenceHours: 6,
      lastResetAt: null,
      nextResetAt: null,
      baselineVersion: null,
      baselineName: null,
    });

    render(
      <AppModeContext.Provider
        value={{
          appMode: "hosted",
          isPending: false,
          isSystemAdmin: false,
          isAdminConsole: false,
          permissions: DEFAULT_USER_PERMISSIONS,
        }}
      >
        <MemoryRouter initialEntries={["/tracking-inbox"]}>
          <App />
        </MemoryRouter>
      </AppModeContext.Provider>,
    );

    expect(screen.getByText("overview")).toBeInTheDocument();
  });
});

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
}

it.each(["/library", "/resumes/library"])(
  "opens the Candidate Library at /library from %s",
  (path) => {
    vi.mocked(useDemoInfo).mockReturnValue(null);
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.getByText("candidate-library")).toBeInTheDocument();
    expect(screen.getByLabelText("Current path")).toHaveTextContent(/^\/library$/);
  },
);

describe("system admin console", () => {
  const renderAt = (path: string, ctx: { isAdminConsole: boolean; isSystemAdmin: boolean }) => {
    vi.mocked(useDemoInfo).mockReturnValue(null);
    render(
      <AppModeContext.Provider
        value={{
          appMode: "local",
          isPending: false,
          permissions: DEFAULT_USER_PERMISSIONS,
          ...ctx,
        }}
      >
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </AppModeContext.Provider>,
    );
  };

  it.each(["/overview", "/jobs/ready", "/resumes/base", "/library", "/watchlist"])(
    "redirects the admin from %s to the Users page",
    (path) => {
      renderAt(path, { isAdminConsole: true, isSystemAdmin: true });

      expect(screen.getByText("admin-users")).toBeInTheDocument();
      expect(screen.getByLabelText("Current path")).toHaveTextContent("/users");
    },
  );

  it("shows the admin only Users and Settings navigation", () => {
    renderAt("/users", { isAdminConsole: true, isSystemAdmin: true });

    expect(screen.getAllByRole("link", { name: "Users" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Settings" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Jobs" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Resumes" })).toBeNull();
  });

  it("keeps the Users page away from regular users", () => {
    renderAt("/users", { isAdminConsole: false, isSystemAdmin: false });

    expect(screen.queryByText("admin-users")).toBeNull();
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/overview");
  });
});

describe("per-user feature permissions", () => {
  const renderUserAt = (path: string, overrides: Partial<typeof DEFAULT_USER_PERMISSIONS> = {}) => {
    vi.mocked(useDemoInfo).mockReturnValue(null);
    return render(
      <AppModeContext.Provider
        value={{
          appMode: "local",
          isPending: false,
          isSystemAdmin: false,
          isAdminConsole: false,
          permissions: {
            ...DEFAULT_USER_PERMISSIONS,
            ...overrides,
          },
        }}
      >
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </AppModeContext.Provider>,
    );
  };

  it("shows Jobs, In Progress, Resumes, Candidate Library, and Watchlist by default for regular users", () => {
    renderUserAt("/");

    expect(screen.getByLabelText("Current path")).toHaveTextContent("/jobs/ready");
    expect(screen.getByText("jobs-page")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Jobs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "In Progress" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Resumes" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Candidate Library" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Watchlist" }).length).toBeGreaterThan(0);
  });

  it("hides Jobs and redirects / to /applications/in-progress and /jobs/ready to /overview when jobs is disabled", () => {
    const { unmount } = renderUserAt("/", { jobs: false, inProgress: true });
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/applications/in-progress");
    expect(screen.getByText("in-progress-board")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).toBeNull();
    unmount();

    renderUserAt("/jobs/ready", { jobs: false, inProgress: true });
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/overview");
    expect(screen.getByText("overview")).toBeInTheDocument();
  });

  it("gates Watchlist when watchlist permission is disabled", () => {
    renderUserAt("/watchlist", { watchlist: false });

    expect(screen.queryByRole("link", { name: "Watchlist" })).toBeNull();
    expect(screen.queryByText("watchlist-page")).toBeNull();
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/overview");
  });

  it("gates In Progress and Overview when inProgress and jobs are disabled", () => {
    renderUserAt("/applications/in-progress", { jobs: false, inProgress: false, resumes: true });

    expect(screen.queryByRole("link", { name: "In Progress" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/resumes");
    expect(screen.getByText("resumes-page")).toBeInTheDocument();
  });

  it.each(["/resumes", "/library", "/resumes/base", "/resumes/job-1"])(
    "gates %s when resumes permission is disabled",
    (path) => {
      renderUserAt(path, { resumes: false });

      expect(screen.queryByRole("link", { name: "Resumes" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Candidate Library" })).toBeNull();
      expect(screen.getByLabelText("Current path")).toHaveTextContent("/overview");
    },
  );

  it("falls back to /settings without a redirect loop when every feature permission is disabled", () => {
    renderUserAt("/", {
      jobs: false,
      watchlist: false,
      inProgress: false,
      resumes: false,
      emailTracking: false,
    });

    expect(screen.getByLabelText("Current path")).toHaveTextContent("/settings");
    expect(screen.getByText("settings-page")).toBeInTheDocument();
  });
});
