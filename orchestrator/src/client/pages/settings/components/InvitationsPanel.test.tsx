import * as api from "@client/api";
import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationsPanel } from "./InvitationsPanel";

vi.mock("@client/api", () => ({
  listUserInvitations: vi.fn(),
  createUserInvitation: vi.fn(),
  deleteUserInvitation: vi.fn(),
}));

const InvitationsHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <InvitationsPanel />
    </QueryClientProvider>
  );
};

describe("InvitationsPanel", () => {
  beforeEach(() => {
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
  });

  it("lists invitations without showing the create form", async () => {
    render(<InvitationsHarness />);

    expect(await screen.findByText("Cousin Sam")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invitation label")).not.toBeInTheDocument();
  });

  it("creates an invitation from the modal and shows the link once", async () => {
    vi.mocked(api.createUserInvitation).mockResolvedValue({
      id: "inv-2",
      label: "Alex",
      token: "tok_123",
      permissions: { ...DEFAULT_USER_PERMISSIONS },
      status: "pending",
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-11-25T00:00:00.000Z",
      usedAt: null,
      usedByUsername: null,
    });

    render(<InvitationsHarness />);
    fireEvent.click(await screen.findByRole("button", { name: "Create invitation" }));

    fireEvent.change(await screen.findByLabelText("Invitation label"), {
      target: { value: "Alex" },
    });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (button) => button.textContent === "Create invitation",
      ) as HTMLElement,
    );

    const linkInput = (await screen.findByLabelText("Invitation link")) as HTMLInputElement;
    expect(linkInput.value).toMatch(/\/invite\/tok_123$/);
    expect(api.createUserInvitation).toHaveBeenCalledWith(
      { label: "Alex", permissions: DEFAULT_USER_PERMISSIONS, expiresInDays: 7 },
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByLabelText("Invitation link")).not.toBeInTheDocument());
  });

  it("deletes an invitation after confirming", async () => {
    vi.mocked(api.deleteUserInvitation).mockResolvedValue(undefined);
    render(<InvitationsHarness />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete invitation Cousin Sam" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(api.deleteUserInvitation).toHaveBeenCalledWith("inv-1", expect.anything()),
    );
  });

  it("copies the invite link for a pending invitation from the table", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.mocked(api.listUserInvitations).mockResolvedValue([
      {
        id: "inv-1",
        label: "Cousin Sam",
        token: "tok_abc",
        permissions: { ...DEFAULT_USER_PERMISSIONS },
        status: "pending",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-11-24T00:00:00.000Z",
        usedAt: null,
        usedByUsername: null,
      },
      {
        id: "inv-2",
        label: "Old link",
        token: null,
        permissions: { ...DEFAULT_USER_PERMISSIONS },
        status: "pending",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-11-20T00:00:00.000Z",
        usedAt: null,
        usedByUsername: null,
      },
    ]);
    render(<InvitationsHarness />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy invitation link for Cousin Sam" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/invite\/tok_abc$/)),
    );
    // Invitations without a stored token (created before it was kept) cannot be copied.
    expect(
      screen.queryByRole("button", { name: "Copy invitation link for Old link" }),
    ).not.toBeInTheDocument();
  });
});
