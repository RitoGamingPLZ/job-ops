import {
  clearAuthSession,
  getAppStatus,
  getCurrentAuthUser,
  setAuthenticatedSession,
} from "@client/api";
import { queryClient } from "@client/lib/queryClient";
import { queryKeys } from "@client/lib/queryKeys";
import { DEFAULT_USER_PERMISSIONS, type AuthUser } from "@shared/types";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test/app-route-mocks";
import { App } from "./App";
import { AppModeProvider } from "./components/layout";

vi.mock("@client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@client/api")>();
  return {
    ...actual,
    getAppStatus: vi.fn(),
    getCurrentAuthUser: vi.fn(),
  };
});

vi.mock("./hooks/useDemoInfo", () => ({
  useDemoInfo: () => null,
}));

vi.mock("./hooks/useAnalyticsIdentity", () => ({
  useAnalyticsIdentity: () => {},
}));

vi.mock("./pages/ResumeCoworkPage", () => ({
  ResumeCoworkPage: () => <div>resume-editor</div>,
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
}

const ADMIN_USER: AuthUser = {
  id: "admin-1",
  username: "admin",
  displayName: "Admin",
  isSystemAdmin: true,
  isDisabled: false,
  hasPassword: true,
  mustChangePassword: false,
  workspaceId: "ws-admin",
  workspaceName: "Admin Workspace",
  permissions: { ...DEFAULT_USER_PERMISSIONS },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const REGULAR_USER: AuthUser = {
  id: "user-2",
  username: "alice",
  displayName: "Alice",
  isSystemAdmin: false,
  isDisabled: false,
  hasPassword: true,
  mustChangePassword: false,
  workspaceId: "ws-alice",
  workspaceName: "Alice Workspace",
  permissions: { ...DEFAULT_USER_PERMISSIONS },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderWithRealProvider(initialPath = "/users") {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppModeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </AppModeProvider>
    </QueryClientProvider>,
  );
}

describe("AppModeProvider auth session reactivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthSession();
    vi.mocked(getAppStatus).mockResolvedValue({
      appMode: "local",
      authMode: "multi_user",
      capabilities: {
        billing: false,
        hostedEmail: false,
        userEditableLlmSettings: true,
      },
    } as never);
  });

  afterEach(() => {
    clearAuthSession();
  });

  it("drops admin-console lock immediately when switching from admin to a normal user", async () => {
    vi.mocked(getCurrentAuthUser).mockResolvedValue(ADMIN_USER);
    setAuthenticatedSession("admin-token");

    renderWithRealProvider("/users");

    expect(await screen.findByText("admin-users")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).toBeNull();

    vi.mocked(getCurrentAuthUser).mockResolvedValue(REGULAR_USER);
    act(() => {
      clearAuthSession();
      setAuthenticatedSession("user-token");
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Current path")).toHaveTextContent("/overview");
    });
    expect(screen.getByText("overview")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Jobs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Watchlist" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "In Progress" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Resumes" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
  });

  it("activates currentUser query when signing in from an unauthenticated state without reload", async () => {
    vi.mocked(getCurrentAuthUser).mockResolvedValue(REGULAR_USER);

    renderWithRealProvider("/jobs/ready");

    await waitFor(() => {
      expect(getAppStatus).toHaveBeenCalled();
    });
    expect(getCurrentAuthUser).not.toHaveBeenCalled();

    act(() => {
      setAuthenticatedSession("user-token");
    });

    await waitFor(() => {
      expect(getCurrentAuthUser).toHaveBeenCalled();
    });
    expect(await screen.findByText("jobs-page")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Jobs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Watchlist" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "In Progress" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Resumes" }).length).toBeGreaterThan(0);
  });

  it("seeds currentUser cache synchronously on setAuthenticatedSession with user and clears on sign-out", () => {
    act(() => {
      setAuthenticatedSession("user-token", REGULAR_USER);
    });
    expect(queryClient.getQueryData(queryKeys.auth.currentUser())).toEqual(REGULAR_USER);

    act(() => {
      clearAuthSession();
    });
    expect(queryClient.getQueryData(queryKeys.auth.currentUser())).toBeUndefined();
  });
});
