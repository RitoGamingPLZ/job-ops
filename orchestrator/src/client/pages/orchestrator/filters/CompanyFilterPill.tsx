import { Building2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { normalizeCompany } from "../companyFilter";
import { FilterPill } from "./FilterPill";
import type { CompanyFilterPillProps } from "./types";

export const CompanyFilterPill = ({
  companyFilter,
  onCompanyFilterChange,
  companiesWithJobs,
}: CompanyFilterPillProps) => {
  const [search, setSearch] = useState("");
  const id = useId();
  const visibleCompanies = companiesWithJobs.filter((company) =>
    company.value.includes(normalizeCompany(search)),
  );

  return (
    <FilterPill
      icon={<Building2 />}
      label="Company"
      active={companyFilter.length > 0}
      badge={companyFilter.length}
      contentClassName="w-72"
    >
      <Button
        type="button"
        size="sm"
        variant={companyFilter.length === 0 ? "default" : "outline"}
        onClick={() => onCompanyFilterChange([])}
      >
        All companies
      </Button>
      {companiesWithJobs.length > 10 ? (
        <Input
          aria-label="Search companies"
          placeholder="Search companies..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {visibleCompanies.map((company) => {
          const inputId = `${id}-${encodeURIComponent(company.value)}`;
          const checked = companyFilter.includes(company.value);
          return (
            <label
              key={company.value}
              htmlFor={inputId}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                id={inputId}
                checked={checked}
                onCheckedChange={(next) =>
                  onCompanyFilterChange(
                    next === true
                      ? [...companyFilter, company.value]
                      : companyFilter.filter((value) => value !== company.value),
                  )
                }
              />
              <span className="min-w-0 break-words">{company.label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{company.count}</span>
            </label>
          );
        })}
        {visibleCompanies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No companies found</p>
        ) : null}
      </div>
    </FilterPill>
  );
};
