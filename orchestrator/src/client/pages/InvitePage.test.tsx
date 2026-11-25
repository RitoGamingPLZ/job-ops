import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitePage } from "./InvitePage";

vi.mock("@client/api", () => ({
  getInvitationPreview: vi.fn(),
  acceptInvitation: vi.fn(),
}));

import { acceptInvitation, getInvitationPreview } from "@client/api";

function renderInvite(token = "abc123") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/invite/${token}`]}>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/overview" element={<div>overview</div>} />
          <Route path="/sign-in" element={<div>sign in</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("InvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("explains an unusable link and points to sign in", async () => {
    vi.mocked(getInvitationPreview).mockRejectedValue(new Error("invalid"));
    renderInvite();

    expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("creates the account from a valid invitation and lands on the app", async () => {
    vi.mocked(getInvitationPreview).mockResolvedValue({
      label: "Sam",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    vi.mocked(acceptInvitation).mockResolvedValue({
      id: "u1",
      username: "sam",
      displayName: "Sam",
      isSystemAdmin: false,
      isDisabled: false,
      hasPassword: true,
      mustChangePassword: false,
      workspaceId: "w1",
      workspaceName: "Sam",
      permissions: { ...DEFAULT_USER_PERMISSIONS },
      createdAt: "",
      updatedAt: "",
    });
    renderInvite("abc123");

    await screen.findByText(/You were invited as "Sam"/);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "sam" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(acceptInvitation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-enough-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(acceptInvitation).toHaveBeenCalledWith("abc123", {
        username: "sam",
        password: "long-enough-1",
        displayName: "sam",
      }),
    );
    expect(await screen.findByText("overview")).toBeInTheDocument();
  });
});
