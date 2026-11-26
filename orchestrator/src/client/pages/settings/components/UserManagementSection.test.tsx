import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import * as api from "@client/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserManagementSection } from "./UserManagementSection";

vi.mock("@client/api", () => ({
  changeOwnPassword: vi.fn(),
  createWorkspaceUser: vi.fn(),
  getCurrentAuthUser: vi.fn(),
  getSsoProviders: vi.fn(),
  listSsoIdentities: vi.fn(),
  listWorkspaceUsers: vi.fn(),
  listUserInvitations: vi.fn(async () => []),
  createUserInvitation: vi.fn(),
  deleteUserInvitation: vi.fn(),
  deleteWorkspaceUser: vi.fn(),
  setWorkspaceUserPermissions: vi.fn(),
  resetWorkspaceUserPassword: vi.fn(),
  setWorkspaceUserDisabled: vi.fn(),
  startSsoLink: vi.fn(),
  unlinkSsoIdentity: vi.fn(),
}));

const UserManagementHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <UserManagementSection />
    </QueryClientProvider>
  );
};

describe("UserManagementSection", () => {
  beforeEach(() => {
    vi.mocked(api.getCurrentAuthUser).mockResolvedValue({
      id: "admin-user",
      username: "admin",
      displayName: "Admin User",
      isSystemAdmin: true,
      isDisabled: false,
      hasPassword: true,
      mustChangePassword: false,
      workspaceId: "tenant-admin",
      workspaceName: "Admin Workspace",
      permissions: { ...DEFAULT_USER_PERMISSIONS },
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });
    vi.mocked(api.listWorkspaceUsers).mockResolvedValue([
      {
        id: "workspace-user",
        username: "member",
        displayName: "Member User",
        isSystemAdmin: false,
        isDisabled: false,
        hasPassword: true,
        mustChangePassword: false,
        workspaceId: "tenant-member",
        workspaceName: "Member Workspace",
        permissions: { ...DEFAULT_USER_PERMISSIONS },
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ]);
    vi.mocked(api.getSsoProviders).mockResolvedValue([]);
    vi.mocked(api.listSsoIdentities).mockResolvedValue([]);
  });

  it("updates a workspace user's reset password without crashing", async () => {
    render(<UserManagementHarness />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage Member User" }));
    const resetPasswordInput = await screen.findByPlaceholderText("New password");

    fireEvent.change(resetPasswordInput, {
      target: { value: "new-password" },
    });

    expect(resetPasswordInput).toHaveValue("new-password");
  });

  it("splits users and invitations into tabs", async () => {
    vi.mocked(api.listUserInvitations).mockResolvedValue([
      {
        id: "inv-1",
        label: "Cousin Sam",
        permissions: { ...DEFAULT_USER_PERMISSIONS },
        status: "pending",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-11-24T00:00:00.000Z",
        usedAt: null,
        usedByUsername: null,
      },
    ]);
    render(<UserManagementHarness />);

    expect(await screen.findByText("Member User")).toBeInTheDocument();
    expect(screen.queryByText("Cousin Sam")).not.toBeInTheDocument();

    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Invitations/ }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Cousin Sam")).toBeInTheDocument();
    expect(screen.queryByText("Member User")).not.toBeInTheDocument();
  });

  it("deletes a user after confirming", async () => {
    vi.mocked(api.deleteWorkspaceUser).mockResolvedValue(undefined);
    render(<UserManagementHarness />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete user member" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(api.deleteWorkspaceUser).toHaveBeenCalledWith("workspace-user", expect.anything()),
    );
  });

  it("does not allow deleting your own account", async () => {
    vi.mocked(api.listWorkspaceUsers).mockResolvedValue([
      {
        id: "admin-user",
        username: "admin",
        displayName: "Admin User",
        isSystemAdmin: true,
        isDisabled: false,
        hasPassword: true,
        mustChangePassword: false,
        workspaceId: "tenant-admin",
        workspaceName: "Admin Workspace",
        permissions: { ...DEFAULT_USER_PERMISSIONS },
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ]);
    render(<UserManagementHarness />);

    expect(await screen.findByRole("button", { name: "Delete user admin" })).toBeDisabled();
  });

  it("allows a system admin to create a new workspace user", async () => {
    vi.mocked(api.createWorkspaceUser).mockResolvedValue({
      id: "new-user-id",
      username: "teammate",
      displayName: "Teammate",
      isSystemAdmin: false,
      isDisabled: false,
      hasPassword: true,
      mustChangePassword: false,
      workspaceId: "tenant-teammate",
      workspaceName: "Teammate",
      permissions: { ...DEFAULT_USER_PERMISSIONS },
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
    });

    render(<UserManagementHarness />);

    const nameInput = await screen.findByPlaceholderText("Name");
    const usernameInput = screen.getByPlaceholderText("Username");
    const passwordInput = screen.getByPlaceholderText("Temporary password");
    const createButton = screen.getByRole("button", { name: "Create" });

    fireEvent.change(nameInput, { target: { value: "Teammate" } });
    fireEvent.change(usernameInput, { target: { value: "teammate" } });
    fireEvent.change(passwordInput, { target: { value: "temp-pass-1234" } });
    fireEvent.click(createButton);

    await screen.findByText("Workspace Users");
    expect(api.createWorkspaceUser).toHaveBeenCalledWith(
      {
        username: "teammate",
        displayName: "Teammate",
        password: "temp-pass-1234",
      },
      expect.anything(),
    );
  });

  it("includes permission overrides when changed on user creation", async () => {
    vi.mocked(api.createWorkspaceUser).mockResolvedValue({
      id: "new-user-id",
      username: "teammate2",
      displayName: "Teammate 2",
      isSystemAdmin: false,
      isDisabled: false,
      hasPassword: true,
      mustChangePassword: false,
      workspaceId: "tenant-teammate2",
      workspaceName: "Teammate 2",
      permissions: { ...DEFAULT_USER_PERMISSIONS, defaultModel: true, watchlist: false },
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
    });

    const { container } = render(<UserManagementHarness />);
    const usernameInput = await screen.findByPlaceholderText("Username");
    const passwordInput = screen.getByPlaceholderText("Temporary password");
    const defaultModelCheckbox = container.querySelector("#create-user-defaultModel");
    const watchlistCheckbox = container.querySelector("#create-user-watchlist");
    expect(defaultModelCheckbox).toBeInstanceOf(HTMLElement);
    expect(watchlistCheckbox).toBeInstanceOf(HTMLElement);

    fireEvent.change(usernameInput, { target: { value: "teammate2" } });
    fireEvent.change(passwordInput, { target: { value: "temp-pass-1234" } });
    fireEvent.click(defaultModelCheckbox as HTMLElement);
    fireEvent.click(watchlistCheckbox as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Workspace Users");
    expect(api.createWorkspaceUser).toHaveBeenCalledWith(
      {
        username: "teammate2",
        displayName: "teammate2",
        password: "temp-pass-1234",
        permissions: { watchlist: false, defaultModel: true },
      },
      expect.anything(),
    );
  });
});
