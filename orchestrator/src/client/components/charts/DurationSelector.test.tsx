/**
 * DurationSelector Edge Case Tests
 * Tests all duration options and interaction edge cases
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DurationSelector } from "./DurationSelector";

const durations = [7, 14, 30, 90] as const;
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-testid="tabs" data-value={value}>
      {children}
      {durations.map((duration) => (
        <button
          key={duration}
          type="button"
          data-testid={`tab-trigger-${duration}`}
          onClick={() => onValueChange?.(String(duration))}
        >
          {duration}d
        </button>
      ))}
    </div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs-list">{children}</div>
  ),
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <button type="button" data-testid={`tab-${value}`} value={value}>
      {children}
    </button>
  ),
}));

describe("DurationSelector", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it.each(durations)("selects %i days when the value changes", (duration) => {
    const { rerender } = render(<DurationSelector value={7} onChange={onChange} />);
    rerender(<DurationSelector value={duration} onChange={onChange} />);

    expect(screen.getByTestId("tabs")).toHaveAttribute("data-value", String(duration));
  });

  it.each(durations)("passes %i days as a number when selected", (duration) => {
    render(<DurationSelector value={duration === 7 ? 30 : 7} onChange={onChange} />);

    fireEvent.click(screen.getByTestId(`tab-trigger-${duration}`));

    expect(onChange.mock.calls).toEqual([[duration]]);
  });
});
