import * as api from "@client/api";
import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersPanel } from "./UsersPanel";

vi.mock("@client/api", () => ({
  createWorkspaceUser: vi.fn(),
  listWorkspaceUsers: vi.fn(),
  deleteWorkspaceUser: vi.fn(),
  setWorkspaceUserPermissions: vi.fn(),
  resetWorkspaceUserPassword: vi.fn(),
  setWorkspaceUserDisabled: vi.fn(),
}));

const UsersHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <UsersPanel currentUserId="admin-user" />
    </QueryClientProvider>
  );
};

const openCreateDialog = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
  return screen.findByRole("dialog");
};

describe("UsersPanel", () => {
  beforeEach(() => {
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
  });

  it("updates a workspace user's reset password without crashing", async () => {
    render(<UsersHarness />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage Member User" }));
    const resetPasswordInput = await screen.findByPlaceholderText("New password");

    fireEvent.change(resetPasswordInput, {
      target: { value: "new-password" },
    });

    expect(resetPasswordInput).toHaveValue("new-password");
  });

  it("deletes a user after confirming", async () => {
    vi.mocked(api.deleteWorkspaceUser).mockResolvedValue(undefined);
    render(<UsersHarness />);

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
    render(<UsersHarness />);

    expect(await screen.findByRole("button", { name: "Delete user admin" })).toBeDisabled();
  });

  it("keeps the create form out of the page until the modal is opened", async () => {
    render(<UsersHarness />);

    expect(await screen.findByText("Member User")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Temporary password")).not.toBeInTheDocument();

    await openCreateDialog();
    expect(screen.getByPlaceholderText("Temporary password")).toBeInTheDocument();
  });

  it("allows a system admin to create a new workspace user from the modal", async () => {
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

    render(<UsersHarness />);
    const dialog = await openCreateDialog();

    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Teammate" } });
    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "teammate" } });
    fireEvent.change(screen.getByPlaceholderText("Temporary password"), {
      target: { value: "temp-pass-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.createWorkspaceUser).toHaveBeenCalledWith(
        {
          username: "teammate",
          displayName: "Teammate",
          password: "temp-pass-1234",
        },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
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

    render(<UsersHarness />);
    const dialog = await openCreateDialog();

    const defaultModelCheckbox = dialog.querySelector("#create-user-defaultModel");
    const watchlistCheckbox = dialog.querySelector("#create-user-watchlist");
    expect(defaultModelCheckbox).toBeInstanceOf(HTMLElement);
    expect(watchlistCheckbox).toBeInstanceOf(HTMLElement);

    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "teammate2" } });
    fireEvent.change(screen.getByPlaceholderText("Temporary password"), {
      target: { value: "temp-pass-1234" },
    });
    fireEvent.click(defaultModelCheckbox as HTMLElement);
    fireEvent.click(watchlistCheckbox as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.createWorkspaceUser).toHaveBeenCalledWith(
        {
          username: "teammate2",
          displayName: "teammate2",
          password: "temp-pass-1234",
          permissions: { watchlist: false, defaultModel: true },
        },
        expect.anything(),
      ),
    );
  });
});
