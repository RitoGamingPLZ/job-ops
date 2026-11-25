import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompanyRatingBadges } from "./CompanyRatingBadges";

describe("CompanyRatingBadges", () => {
  it("shows work-life balance and pay ratings", () => {
    render(<CompanyRatingBadges rating={{ wlb: 4, salary: 5 }} />);

    expect(screen.getByTitle("Work-life balance: 4 of 5 (editorial estimate)")).toHaveTextContent(
      "WLB4/5",
    );
    expect(screen.getByTitle("Salary: 5 of 5 (editorial estimate)")).toHaveTextContent("Pay5/5");
  });

  it("renders nothing for an unrated company", () => {
    const { container } = render(<CompanyRatingBadges rating={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
