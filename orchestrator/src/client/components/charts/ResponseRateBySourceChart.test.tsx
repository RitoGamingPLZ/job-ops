import { createJob as createBaseJob, createStageEvent } from "@shared/testing/factories.js";
import type { Job, StageEvent } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import "@client/test/chart-card-mock";
import { ResponseRateBySourceChart } from "./ResponseRateBySourceChart";

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
}));

vi.mock("recharts", async () => ({
  ...(await import("@client/test/recharts-mocks")).rechartsMocks,
  Bar: ({ children }: { children?: React.ReactNode }) => <div data-testid="bar">{children}</div>,
  XAxis: () => <div data-testid="x-axis">XAxis</div>,
}));

type ChartJob = Pick<Job, "id" | "source" | "appliedAt"> & {
  events: StageEvent[];
};

const createJob = (id: string, events: StageEvent[]): ChartJob => {
  const job = createBaseJob({
    id,
    source: "linkedin",
    appliedAt: "2025-01-10T00:00:00Z",
  });
  return { id: job.id, source: job.source, appliedAt: job.appliedAt, events };
};

const stageEvent = (
  applicationId: string,
  toStage: StageEvent["toStage"],
  occurredAt: number,
  overrides: Partial<StageEvent> = {},
): StageEvent =>
  createStageEvent({
    id: `${applicationId}-${toStage}-${occurredAt}`,
    applicationId,
    toStage,
    occurredAt,
    ...overrides,
  });

describe("ResponseRateBySourceChart", () => {
  it("includes behavioural responses in source buckets without counting repeated rounds twice", () => {
    render(
      <ResponseRateBySourceChart
        jobs={[
          createJob("job-1", [
            stageEvent("job-1", "behavioural", 1),
            stageEvent("job-1", "behavioural", 2),
          ]),
          createJob("job-2", [stageEvent("job-2", "applied", 1)]),
        ]}
        error={null}
      />,
    );

    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 applications/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Include small samples" }));
    const data = JSON.parse(screen.getByTestId("bar-chart-data").textContent ?? "[]");
    expect(data).toEqual([expect.objectContaining({ applied: 2, responded: 1, rate: 50 })]);
  });

  it("excludes behavioural responses retracted by moving back to Applied", () => {
    render(
      <ResponseRateBySourceChart
        jobs={[
          createJob("job-1", [
            stageEvent("job-1", "behavioural", 1),
            stageEvent("job-1", "applied", 2, {
              fromStage: "behavioural",
              metadata: { actor: "user", eventType: "status_update" },
            }),
          ]),
        ]}
        error={null}
      />,
    );

    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 applications/)).toBeInTheDocument();
  });

  it("counts an application as responded once it reaches a response stage", () => {
    const jobs = [
      createJob("job-1", [
        stageEvent("job-1", "applied", 1),
        stageEvent("job-1", "recruiter_screen", 2),
      ]),
      createJob("job-2", [stageEvent("job-2", "applied", 1)]),
    ];

    render(<ResponseRateBySourceChart jobs={jobs} error={null} />);

    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 applications/)).toBeInTheDocument();
  });

  it("does not count a response stage retracted by moving back to Applied", () => {
    const jobs = [
      createJob("job-1", [
        stageEvent("job-1", "applied", 1),
        stageEvent("job-1", "recruiter_screen", 2),
        stageEvent("job-1", "applied", 3, {
          fromStage: "recruiter_screen",
          metadata: { actor: "user", eventType: "status_update" },
        }),
      ]),
      createJob("job-2", [stageEvent("job-2", "applied", 1), stageEvent("job-2", "assessment", 2)]),
    ];

    render(<ResponseRateBySourceChart jobs={jobs} error={null} />);

    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 applications/)).toBeInTheDocument();
  });
});
