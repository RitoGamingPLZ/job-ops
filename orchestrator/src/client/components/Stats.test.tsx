import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stats } from "./Stats";

describe("Stats", () => {
  it("shows the ready count under Targeted and preserves the total", () => {
    render(
      <Stats
        stats={{
          discovered: 3,
          processing: 0,
          ready: 2,
          applied: 1,
          in_progress: 0,
          skipped: 0,
          expired: 0,
        }}
      />,
    );

    const label = screen.getByText("Targeted");
    expect(within(label.parentElement as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("6 total jobs")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});
