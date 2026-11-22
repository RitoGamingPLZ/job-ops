import { createStageEvent } from "@shared/testing/factories.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogEventModal } from "./LogEventModal";

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, ...props }: { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <select
      data-testid="select"
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

describe("LogEventModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the rejection reason selector and submits the form", async () => {
    const onLog = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<LogEventModal isOpen onClose={onClose} onLog={onLog} />);

    const stageSelect = screen.getAllByTestId("select")[0];
    fireEvent.change(stageSelect, { target: { value: "rejected" } });

    expect(screen.getByText("Reason")).toBeInTheDocument();

    const reasonSelect = screen.getAllByTestId("select")[1];
    fireEvent.change(reasonSelect, { target: { value: "Visa" } });

    fireEvent.click(screen.getByRole("button", { name: /log event/i }));

    await waitFor(() =>
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "rejected", reasonCode: "Visa" }),
        undefined,
      ),
    );
  });

  it("blocks submit when the title is cleared", async () => {
    const onLog = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<LogEventModal isOpen onClose={onClose} onLog={onLog} />);

    const titleInput = screen.getByPlaceholderText("e.g. Recruiter Screen");
    fireEvent.change(titleInput, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /log event/i }));

    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(onLog).not.toHaveBeenCalled();
  });

  it("keeps the modal scrollable on small screens", () => {
    render(<LogEventModal isOpen onClose={vi.fn()} onLog={vi.fn()} />);

    expect(screen.getByTestId("log-event-modal")).toHaveClass(
      "max-h-[calc(100vh-2rem)]",
      "overflow-y-auto",
    );
  });
});

it("offers simplified stages and hides assessment and onsite", () => {
  render(<LogEventModal isOpen onClose={vi.fn()} onLog={vi.fn()} />);
  expect(screen.getByRole("option", { name: "Behaviour Question" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Reject" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Withdrawn" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Assessment" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Onsite" })).not.toBeInTheDocument();
});

it.each(["assessment", "onsite"] as const)(
  "preserves an edited %s event until the user selects another stage",
  async (toStage) => {
    const onLog = vi.fn().mockResolvedValue(undefined);
    render(
      <LogEventModal
        isOpen
        onClose={vi.fn()}
        onLog={onLog}
        editingEvent={createStageEvent({
          id: "legacy",
          toStage,
          metadata: { eventLabel: "Interview", eventType: "status_update" },
        })}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Add details..."), {
      target: { value: "Updated notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(onLog).toHaveBeenCalledWith(
        expect.objectContaining({ stage: toStage, notes: "Updated notes" }),
        "legacy",
      ),
    );
    fireEvent.change(screen.getAllByTestId("select")[0], {
      target: { value: "technical_interview" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(onLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ stage: "technical_interview" }),
        "legacy",
      ),
    );
  },
);

it("preserves no-stage-change semantics when editing a technical note", async () => {
  const onLog = vi.fn().mockResolvedValue(undefined);
  render(
    <LogEventModal
      isOpen
      onClose={vi.fn()}
      onLog={onLog}
      editingEvent={createStageEvent({
        id: "note",
        toStage: "technical_interview",
        metadata: { eventLabel: "Follow up", eventType: "note" },
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() =>
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ stage: "no_change" }), "note"),
  );
});
