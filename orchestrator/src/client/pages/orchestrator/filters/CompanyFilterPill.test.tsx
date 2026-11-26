import { createJob } from "@shared/testing/factories";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { getCompaniesWithJobs } from "../companyFilter";
import { CompanyFilterPill } from "./CompanyFilterPill";

const companies = getCompaniesWithJobs(
  ["Google", " GOOGLE ", "Google LLC", " A   & B ", "A & B", " "].map((employer) =>
    createJob({ employer }),
  ),
);

const Harness = () => {
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  return (
    <>
      <CompanyFilterPill
        companiesWithJobs={companies}
        companyFilter={companyFilter}
        onCompanyFilterChange={setCompanyFilter}
      />
      <output aria-label="Selected companies">{companyFilter.join("|")}</output>
    </>
  );
};

describe("CompanyFilterPill", () => {
  it("lists normalized employers by count with stable alphabetical ties", async () => {
    expect(companies).toEqual([
      { value: "a & b", label: "A & B", count: 2 },
      { value: "google", label: "Google", count: 2 },
      { value: "google llc", label: "Google LLC", count: 1 },
    ]);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^company/i }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "A & B2",
      "Google2",
      "Google LLC1",
    ]);
    expect(screen.getByRole("combobox", { name: "Search companies" })).toBeInTheDocument();
  });

  it("selects multiple companies, deselects, removes chips, and clears", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^company/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Google 2" }));
    fireEvent.click(screen.getByRole("option", { name: "Google LLC 1" }));
    expect(screen.getByLabelText("Selected companies")).toHaveTextContent("google|google llc");

    expect(screen.getByRole("option", { name: "Google 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("option", { name: "Google 2" }));
    expect(screen.getByRole("option", { name: "Google 2" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("option", { name: "Google LLC 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Chip remove button inside the popover also deselects the company.
    fireEvent.click(screen.getByRole("button", { name: "Remove company Google LLC" }));
    expect(screen.getByLabelText("Selected companies")).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("option", { name: "A & B 2" }));
    expect(screen.getByLabelText("Selected companies")).toHaveTextContent("a & b");

    fireEvent.click(screen.getByRole("button", { name: "All companies" }));
    expect(screen.getByLabelText("Selected companies")).toBeEmptyDOMElement();
    expect(
      screen
        .getAllByRole("option")
        .every((option) => option.getAttribute("aria-selected") === "false"),
    ).toBe(true);
  });

  it("searches company lists ignoring case and whitespace and supports keyboard selection", async () => {
    render(
      <CompanyFilterPill
        companiesWithJobs={getCompaniesWithJobs(
          Array.from({ length: 11 }, (_, i) => createJob({ employer: `Company ${i}` })),
        )}
        companyFilter={[]}
        onCompanyFilterChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^company/i }));
    const search = await screen.findByRole("combobox", {
      name: "Search companies",
    });
    fireEvent.change(search, { target: { value: " COMPANY  10 " } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Company 10 1" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("No companies found")).toBeInTheDocument();
  });

  it("toggles company options with keyboard navigation", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^company/i }));
    const search = await screen.findByRole("combobox", {
      name: "Search companies",
    });

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByLabelText("Selected companies")).toHaveTextContent("google");
  });
});
