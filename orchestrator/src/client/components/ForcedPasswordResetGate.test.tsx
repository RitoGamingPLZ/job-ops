import * as api from "@client/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForcedPasswordResetGate } from "./ForcedPasswordResetGate";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@client/api", () => ({
  changeOwnPassword: vi.fn(),
  getCurrentAuthUser: vi.fn(),
  hasAuthenticatedSession: vi.fn(),
  logout: vi.fn(),
}));

const baseUser: api.AuthUser = {
  id: "user-1",
  username: "admin-temp",
  displayName: "Admin Temp",
  isSystemAdmin: true,
  isDisabled: false,
  hasPassword: true,
  mustChangePassword: false,
  workspaceId: "tenant-1",
  workspaceName: "Admin Workspace",
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
};

function renderGate(initialPath = "/overview") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ForcedPasswordResetGate>
          <div>dashboard-content</div>
        </ForcedPasswordResetGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ForcedPasswordResetGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.hasAuthenticatedSession).mockReturnValue(true);
    vi.mocked(api.getCurrentAuthUser).mockResolvedValue(baseUser);
    vi.mocked(api.changeOwnPassword).mockResolvedValue(undefined);
    vi.mocked(api.logout).mockResolvedValue(undefined);
  });

  it("renders dashboard content when mustChangePassword is false", async () => {
    renderGate();

    expect(await screen.findByText("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByText("Reset your password")).not.toBeInTheDocument();
  });

  it("does not block the sign-in route", async () => {
    vi.mocked(api.getCurrentAuthUser).mockResolvedValue({
      ...baseUser,
      mustChangePassword: true,
    });

    renderGate("/sign-in");

    expect(screen.getByText("dashboard-content")).toBeInTheDocument();
    expect(api.getCurrentAuthUser).not.toHaveBeenCalled();
  });

  it("blocks dashboard access until the user sets a new password and refreshes auth state", async () => {
    let mustChange = true;
    vi.mocked(api.getCurrentAuthUser).mockImplementation(async () => ({
      ...baseUser,
      mustChangePassword: mustChange,
    }));
    vi.mocked(api.changeOwnPassword).mockImplementation(async () => {
      mustChange = false;
    });

    renderGate("/overview");

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
    expect(screen.queryByText("dashboard-content")).not.toBeInTheDocument();

    // Validation: mismatch shows error and does not call API
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "temp-pass-123" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-456" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText("New password and confirmation do not match."),
    ).toBeInTheDocument();
    expect(api.changeOwnPassword).not.toHaveBeenCalled();

    // Valid submission clears gate and renders dashboard
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "new-password-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(api.changeOwnPassword).toHaveBeenCalledWith(
        {
          currentPassword: "temp-pass-123",
          password: "new-password-456",
        },
        expect.anything(),
      );
    });

    expect(await screen.findByText("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByText("Reset your password")).not.toBeInTheDocument();
  });
});
