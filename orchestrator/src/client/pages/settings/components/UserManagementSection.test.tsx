import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import * as api from "@client/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
  revokeUserInvitation: vi.fn(),
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

    const resetPasswordInput = await screen.findByPlaceholderText("New password");

    fireEvent.change(resetPasswordInput, {
      target: { value: "new-password" },
    });

    expect(resetPasswordInput).toHaveValue("new-password");
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

  it("includes defaultModel permission when checked on user creation", async () => {
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
      permissions: { ...DEFAULT_USER_PERMISSIONS, defaultModel: true },
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
    });

    const { container } = render(<UserManagementHarness />);
    const usernameInput = await screen.findByPlaceholderText("Username");
    const passwordInput = screen.getByPlaceholderText("Temporary password");
    const defaultModelCheckbox = container.querySelector("#create-user-default-model");
    expect(defaultModelCheckbox).toBeInstanceOf(HTMLElement);

    fireEvent.change(usernameInput, { target: { value: "teammate2" } });
    fireEvent.change(passwordInput, { target: { value: "temp-pass-1234" } });
    fireEvent.click(defaultModelCheckbox as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("Workspace Users");
    expect(api.createWorkspaceUser).toHaveBeenCalledWith(
      {
        username: "teammate2",
        displayName: "teammate2",
        password: "temp-pass-1234",
        permissions: { defaultModel: true },
      },
      expect.anything(),
    );
  });
});
