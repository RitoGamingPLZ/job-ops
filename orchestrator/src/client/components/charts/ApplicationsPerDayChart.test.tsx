/**
 * ApplicationsPerDayChart Edge Case Tests
 * Tests real-world edge cases and data transformation logic
 */

import { render, screen } from "@testing-library/react";
import type React from "react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApplicationsPerDayChart } from "./ApplicationsPerDayChart";

// Mock UI components
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-title">{children}</div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-description">{children}</div>
  ),
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  ChartTooltip: ({ content }: { content: React.ReactNode }) => (
    <div data-testid="chart-tooltip">{content}</div>
  ),
  ChartTooltipContent: ({
    labelFormatter,
  }: {
    labelFormatter: (value: string) => React.ReactNode;
  }) => (
    <div data-testid="chart-tooltip-content">
      {labelFormatter("2025-01-01")}
    </div>
  ),
}));

vi.mock("recharts", () => ({
  BarChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data: Array<{ date: string; applications: number }>;
  }) => (
    <div data-testid="bar-chart" data-chart-data={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Bar: () => <div data-testid="bar">Bar</div>,
  CartesianGrid: () => <div data-testid="cartesian-grid">Grid</div>,
  XAxis: ({ tickFormatter }: { tickFormatter: (value: string) => string }) => (
    <div data-testid="x-axis">{tickFormatter("2025-01-01")}</div>
  ),
}));

vi.mock("lucide-react", () => ({
  TrendingUp: () => <div data-testid="trending-up">TrendingUp</div>,
  TrendingDown: () => <div data-testid="trending-down">TrendingDown</div>,
}));

describe("ApplicationsPerDayChart - Edge Cases", () => {
  // The chart groups by local calendar day. Serialize local fixtures as the
  // timestamp strings supplied by the API, without assuming a UTC offset.
  const localDate = (day: number) => new Date(2025, 0, day).toISOString();
  const mockDate = new Date(2025, 0, 15, 12);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Local calendar date labels", () => {
    const previousTimezone = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = "America/Toronto";
    });

    afterAll(() => {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    });

    it("labels ticks and tooltips with the bucket's own local calendar date", () => {
      render(
        <ApplicationsPerDayChart
          appliedAt={[]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByTestId("x-axis")).toHaveTextContent(/^1 Jan$/);
      expect(screen.getByTestId("chart-tooltip-content")).toHaveTextContent(
        /^1 Jan 2025$/,
      );
    });
  });

  describe("Empty and Null Data", () => {
    it("handles empty appliedAt array - shows zero total and average", () => {
      render(
        <ApplicationsPerDayChart
          appliedAt={[]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText("0.0")).toBeInTheDocument();
      expect(screen.getByText(/Last 7 days · 0 total/)).toBeInTheDocument();
    });

    it("handles appliedAt with all null values - filters out nulls correctly", () => {
      render(
        <ApplicationsPerDayChart
          appliedAt={[null, null, null]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText("0.0")).toBeInTheDocument();
      expect(screen.getByText(/Last 7 days · 0 total/)).toBeInTheDocument();
    });

    it("handles mixed null and valid dates - counts only valid dates", () => {
      const today = mockDate.toISOString();
      render(
        <ApplicationsPerDayChart
          appliedAt={[null, today, null, today, today]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 3 total/)).toBeInTheDocument();
    });
  });

  describe("Invalid Date Handling", () => {
    it("filters out invalid date strings", () => {
      const today = mockDate.toISOString();
      render(
        <ApplicationsPerDayChart
          appliedAt={["invalid-date", today, "", "not-a-date", today]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 2 total/)).toBeInTheDocument();
    });

    it("handles malformed ISO dates gracefully", () => {
      const today = mockDate.toISOString();
      render(
        <ApplicationsPerDayChart
          appliedAt={["2025-13-45", today, "2025-01-00", today]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 2 total/)).toBeInTheDocument();
    });
  });

  describe("Date Range Filtering", () => {
    it("filters out dates before the start of range", () => {
      const today = mockDate.toISOString();
      const oldDate = localDate(1); // Before 7-day window
      render(
        <ApplicationsPerDayChart
          appliedAt={[oldDate, today, today]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 2 total/)).toBeInTheDocument();
    });

    it("filters out dates after the end of range (future dates)", () => {
      const today = mockDate.toISOString();
      const futureDate = localDate(20); // After today
      render(
        <ApplicationsPerDayChart
          appliedAt={[today, futureDate, today]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 2 total/)).toBeInTheDocument();
    });

    it("includes local day boundaries and buckets timestamps around midnight", () => {
      const start = new Date(2025, 0, 9);
      const end = new Date(2025, 0, 15, 23, 59, 59, 999);
      render(
        <ApplicationsPerDayChart
          appliedAt={[
            new Date(start.getTime() - 1).toISOString(),
            start.toISOString(),
            new Date(2025, 0, 10, 23, 59, 59, 999).toISOString(),
            localDate(11),
            end.toISOString(),
            new Date(end.getTime() + 1).toISOString(),
          ]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 4 total/)).toBeInTheDocument();
      expect(
        JSON.parse(
          screen.getByTestId("bar-chart").getAttribute("data-chart-data") ??
            "[]",
        ),
      ).toEqual([
        { date: "2025-01-09", applications: 1 },
        { date: "2025-01-10", applications: 1 },
        { date: "2025-01-11", applications: 1 },
        { date: "2025-01-12", applications: 0 },
        { date: "2025-01-13", applications: 0 },
        { date: "2025-01-14", applications: 0 },
        { date: "2025-01-15", applications: 1 },
      ]);
    });

    it("handles single day range (daysToShow=1)", () => {
      const today = mockDate.toISOString();
      const yesterday = localDate(14);
      render(
        <ApplicationsPerDayChart
          appliedAt={[today, yesterday, today]}
          isLoading={false}
          error={null}
          daysToShow={1}
        />,
      );

      expect(screen.getByText(/Last 1 days · 2 total/)).toBeInTheDocument();
    });
  });

  describe("Trend Calculation Edge Cases", () => {
    it("shows neutral trend when first half average is 0 and second half is also 0", () => {
      // All zeros - no trend indicator should show
      render(
        <ApplicationsPerDayChart
          appliedAt={[]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.queryByTestId("trending-up")).not.toBeInTheDocument();
      expect(screen.queryByTestId("trending-down")).not.toBeInTheDocument();
    });

    it("shows up trend when first half is 0 but second half has activity", () => {
      const dates = [
        localDate(15), // Today (second half)
        localDate(15),
        localDate(15),
      ];
      render(
        <ApplicationsPerDayChart
          appliedAt={dates}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByTestId("trending-up")).toBeInTheDocument();
    });

    it("calculates trend percentage correctly for positive trend", () => {
      // First half: 1 app over 3 days; second half: 3 apps over 4 days.
      const dates = [
        localDate(9), // First half
        localDate(15), // Second half
        localDate(15),
        localDate(15),
      ];
      render(
        <ApplicationsPerDayChart
          appliedAt={dates}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByTestId("trending-up")).toBeInTheDocument();
    });

    it("shows down trend for significant negative trend", () => {
      // First half: high activity, Second half: low activity
      const dates = [
        localDate(9), // First half - 3 apps
        localDate(9),
        localDate(9),
        localDate(15), // Second half - 1 app
      ];
      render(
        <ApplicationsPerDayChart
          appliedAt={dates}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByTestId("trending-down")).toBeInTheDocument();
    });
  });

  describe("Loading and Error States", () => {
    it("shows loading state description", () => {
      render(
        <ApplicationsPerDayChart
          appliedAt={[]}
          isLoading={true}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText("Loading applied jobs...")).toBeInTheDocument();
    });

    it("displays error message when error prop is set", () => {
      render(
        <ApplicationsPerDayChart
          appliedAt={[]}
          isLoading={false}
          error="Failed to load application data"
          daysToShow={7}
        />,
      );

      expect(
        screen.getByText("Failed to load application data"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("chart-container")).not.toBeInTheDocument();
    });

    it("renders chart when no error", () => {
      render(
        <ApplicationsPerDayChart
          appliedAt={[]}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByTestId("chart-container")).toBeInTheDocument();
    });
  });

  describe("Large Data Stress Tests", () => {
    it("handles large number of applications efficiently", () => {
      const today = mockDate.toISOString();
      const largeData = Array(1000).fill(today);

      render(
        <ApplicationsPerDayChart
          appliedAt={largeData}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 1,000 total/)).toBeInTheDocument();
      expect(screen.getByText("142.9")).toBeInTheDocument(); // 1000/7
    });

    it("handles applications spread across different days in range", () => {
      const dates = [
        localDate(9),
        localDate(10),
        localDate(10),
        localDate(11),
        localDate(11),
        localDate(11),
        localDate(15),
      ];
      render(
        <ApplicationsPerDayChart
          appliedAt={dates}
          isLoading={false}
          error={null}
          daysToShow={7}
        />,
      );

      expect(screen.getByText(/Last 7 days · 7 total/)).toBeInTheDocument();
      expect(screen.getByText("1.0")).toBeInTheDocument(); // 7/7
    });
  });
});
