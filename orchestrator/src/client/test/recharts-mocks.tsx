import type { ReactNode } from "react";

export const rechartsMocks = {
  BarChart: ({ children, data }: { children: ReactNode; data?: unknown }) => (
    <div data-testid="bar-chart">
      {children}
      <div data-testid="bar-chart-data">{JSON.stringify(data)}</div>
    </div>
  ),
  Bar: () => <div data-testid="bar">Bar</div>,
  CartesianGrid: () => <div data-testid="cartesian-grid">Grid</div>,
  Cell: () => <div data-testid="cell">Cell</div>,
  LabelList: () => <div data-testid="label-list">LabelList</div>,
  XAxis: ({ tickFormatter }: { tickFormatter?: (value: string) => string }) => (
    <div data-testid="x-axis">{tickFormatter?.("2025-01-01") ?? "XAxis"}</div>
  ),
  YAxis: () => <div data-testid="y-axis">YAxis</div>,
  Tooltip: () => <div data-testid="tooltip">Tooltip</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
};
