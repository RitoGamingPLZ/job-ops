import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompanyRatingBadges } from "./CompanyRatingBadges";

const base = { source: "editorial", ratedAt: "2026-11-25" };

describe("CompanyRatingBadges", () => {
  it("shows work-life balance and pay ratings out of 10", () => {
    render(<CompanyRatingBadges rating={{ ...base, wlb: 8, salary: 10 }} />);

    expect(screen.getByTitle("Work-life balance: 8 out of 10 (editorial)")).toHaveTextContent(
      "WLB8/10",
    );
    expect(screen.getByTitle("Salary: 10 out of 10 (editorial)")).toHaveTextContent("Pay10/10");
  });

  it("shows one decimal for fractional ratings and skips an unrated dimension", () => {
    render(<CompanyRatingBadges rating={{ ...base, wlb: 7.6, salary: null }} />);

    expect(screen.getByTitle("Work-life balance: 7.6 out of 10 (editorial)")).toHaveTextContent(
      "WLB7.6/10",
    );
    expect(screen.queryByTitle(/Salary/)).not.toBeInTheDocument();
  });

  it("renders nothing for an unrated company", () => {
    const { container, rerender } = render(<CompanyRatingBadges rating={undefined} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<CompanyRatingBadges rating={{ ...base, wlb: null, salary: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
