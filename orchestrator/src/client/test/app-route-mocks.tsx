import type React from "react";
import { vi } from "vitest";

vi.mock("react-transition-group", () => ({
  SwitchTransition: ({ children }: { children: React.ReactNode }) => children,
  CSSTransition: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("../components/ForcedPasswordResetGate", () => ({
  ForcedPasswordResetGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../components/OnboardingGate", () => ({
  OnboardingGate: () => null,
}));

vi.mock("../pages/AdminInvitationsPage", () => ({
  AdminInvitationsPage: () => <div>admin-invitations</div>,
}));

vi.mock("../pages/AdminUsersPage", () => ({
  AdminUsersPage: () => <div>admin-users</div>,
}));

vi.mock("../pages/GmailOauthCallbackPage", () => ({
  GmailOauthCallbackPage: () => null,
}));

vi.mock("../pages/HomePage", () => ({
  HomePage: () => <div>overview</div>,
}));

vi.mock("../pages/InProgressBoardPage", () => ({
  InProgressBoardPage: () => <div>in-progress-board</div>,
}));

vi.mock("../pages/JobPage", () => ({
  JobPage: () => <div>job-detail</div>,
}));

vi.mock("../pages/OnboardingPage", () => ({
  OnboardingPage: () => <div>onboarding</div>,
}));

vi.mock("../pages/OrchestratorPage", () => ({
  OrchestratorPage: () => <div>jobs-page</div>,
}));

vi.mock("../pages/SettingsPage", () => ({
  SettingsPage: () => <div>settings-page</div>,
}));

vi.mock("../pages/ResumesPage", () => ({
  ResumesPage: () => <div>resumes-page</div>,
  ResumeLibraryPage: () => <div>candidate-library</div>,
}));

vi.mock("../pages/SignInPage", () => ({
  SignInPage: () => <div>sign-in</div>,
}));

vi.mock("../pages/TrackingInboxPage", () => ({
  TrackingInboxPage: () => <div>tracking-inbox</div>,
}));

vi.mock("../pages/WatchlistPage", () => ({
  WatchlistPage: () => <div>watchlist-page</div>,
}));
