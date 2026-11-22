import type { StageEvent } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobTimeline } from "./Timeline";

const baseEvent: StageEvent = {
  id: "event-1",
  applicationId: "app-1",
  fromStage: null,
  toStage: "applied",
  title: "Applied",
  groupId: null,
  occurredAt: 1735689600,
  metadata: {
    eventLabel: "Applied",
  },
  outcome: null,
};

const makeEvent = (overrides: Partial<StageEvent> = {}): StageEvent => ({
  ...baseEvent,
  ...overrides,
  metadata: overrides.metadata ?? baseEvent.metadata,
});

const expectTextBefore = (leftText: string, rightText: string) => {
  const left = screen.getByText(leftText);
  const right = screen.getByText(rightText);

  expect(left.compareDocumentPosition(right)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
};

describe("JobTimeline", () => {
  it("renders a read-only Discovered entry when discoveredAt exists without stage events", () => {
    render(<JobTimeline events={[]} discoveredAt="2024-12-31T09:30:00.000Z" />);

    expect(screen.getByText("Discovered")).toBeInTheDocument();
    expect(
      screen.getByText("Job Ops discovered this job and added it to your pipeline."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No stage events yet.")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Edit event")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete event")).not.toBeInTheDocument();
  });

  it("sorts the Discovered entry chronologically with stage events", () => {
    const appliedEvent = makeEvent({
      id: "event-applied",
      title: "Applied",
      occurredAt: 1735689600,
    });
    const interviewEvent = makeEvent({
      id: "event-interview",
      title: "Interview",
      toStage: "technical_interview",
      occurredAt: 1735862400,
    });

    render(
      <JobTimeline
        events={[interviewEvent, appliedEvent]}
        discoveredAt="2025-01-02T00:00:00.000Z"
      />,
    );

    expectTextBefore("Applied", "Discovered");
    expectTextBefore("Discovered", "Interview · Round 1");
  });

  it("keeps the empty state when discoveredAt is missing or invalid", () => {
    const { rerender } = render(<JobTimeline events={[]} />);

    expect(screen.getByText("No stage events yet.")).toBeInTheDocument();
    expect(screen.queryByText("Discovered")).not.toBeInTheDocument();

    rerender(<JobTimeline events={[]} discoveredAt="not a date" />);

    expect(screen.getByText("No stage events yet.")).toBeInTheDocument();
    expect(screen.queryByText("Discovered")).not.toBeInTheDocument();
  });

  it("renders edit and delete controls when callbacks are provided", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<JobTimeline events={[baseEvent]} onEdit={onEdit} onDelete={onDelete} />);

    const editButton = screen.getByTitle("Edit event");
    const deleteButton = screen.getByTitle("Delete event");

    fireEvent.click(editButton);
    fireEvent.click(deleteButton);

    expect(onEdit).toHaveBeenCalledWith(baseEvent);
    expect(onDelete).toHaveBeenCalledWith("event-1");
  });

  it("does not add edit or delete controls for the Discovered entry", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <JobTimeline
        events={[baseEvent]}
        discoveredAt="2024-12-31T09:30:00.000Z"
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByText("Discovered")).toBeInTheDocument();
    expect(screen.getAllByTitle("Edit event")).toHaveLength(1);
    expect(screen.getAllByTitle("Delete event")).toHaveLength(1);
  });

  it("omits edit and delete controls when callbacks are missing", () => {
    render(<JobTimeline events={[baseEvent]} />);

    expect(screen.queryByTitle("Edit event")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete event")).not.toBeInTheDocument();
  });
});

it("labels chronological technical rounds, behavioural events and withdrawn rejections", () => {
  render(
    <JobTimeline
      events={[
        makeEvent({
          id: "second",
          title: "",
          toStage: "technical_interview",
          occurredAt: 2,
        }),
        makeEvent({
          id: "first",
          title: "",
          toStage: "technical_interview",
          occurredAt: 1,
        }),
        makeEvent({
          id: "behaviour",
          title: "",
          toStage: "behavioural",
          occurredAt: 3,
        }),
        makeEvent({
          id: "withdrawn",
          title: "",
          toStage: "closed",
          outcome: "withdrawn",
          occurredAt: 4,
        }),
      ]}
    />,
  );
  expectTextBefore("Technical Interview · Round 1", "Technical Interview · Round 2");
  expect(screen.getByText("Behaviour Question")).toBeInTheDocument();
  expect(screen.getByText("Reject · withdrawn")).toBeInTheDocument();
});

it("counts legacy rounds and leaves note-only events unnumbered", () => {
  render(
    <JobTimeline
      events={[
        makeEvent({
          id: "legacy",
          title: "",
          toStage: "assessment",
          occurredAt: 1,
        }),
        makeEvent({
          id: "note",
          title: "Follow up",
          toStage: "technical_interview",
          occurredAt: 2,
          metadata: { eventType: "note" },
        }),
        makeEvent({
          id: "round-2",
          title: "",
          toStage: "onsite",
          occurredAt: 3,
        }),
        makeEvent({
          id: "round-3",
          title: "",
          toStage: "technical_interview",
          occurredAt: 4,
        }),
      ]}
    />,
  );
  expect(screen.getByText("Technical Interview · Round 1")).toBeInTheDocument();
  expect(screen.getByText("Follow up")).toBeInTheDocument();
  expect(screen.getByText("Technical Interview · Round 2")).toBeInTheDocument();
  expect(screen.getByText("Technical Interview · Round 3")).toBeInTheDocument();
});
