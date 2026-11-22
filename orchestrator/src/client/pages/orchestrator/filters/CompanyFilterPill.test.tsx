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
    const options = await screen.findAllByRole("checkbox");
    expect(options.map((option) => option.closest("label")?.textContent)).toEqual([
      "A & B2",
      "Google2",
      "Google LLC1",
    ]);
    expect(screen.queryByRole("textbox", { name: "Search companies" })).not.toBeInTheDocument();
  });

  it("selects multiple companies, deselects, and clears", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^company/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Google 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Google LLC 1" }));
    expect(screen.getByLabelText("Selected companies")).toHaveTextContent("google|google llc");
    fireEvent.click(screen.getByRole("checkbox", { name: "Google 2" }));
    expect(screen.getByRole("checkbox", { name: "Google 2" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Google LLC 1" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "All companies" }));
    expect(screen.getByLabelText("Selected companies")).toBeEmptyDOMElement();
    expect(
      screen
        .getAllByRole("checkbox")
        .every((option) => option.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });

  it("searches long company lists ignoring case and whitespace", async () => {
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
    const search = await screen.findByRole("textbox", {
      name: "Search companies",
    });
    fireEvent.change(search, { target: { value: " COMPANY  10 " } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Company 10 1" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("No companies found")).toBeInTheDocument();
  });
});
