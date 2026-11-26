import { Building2 } from "lucide-react";
import { useMemo } from "react";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { FilterPillTrigger } from "./FilterPill";
import type { CompanyFilterPillProps } from "./types";

export const CompanyFilterPill = ({
  companyFilter,
  onCompanyFilterChange,
  companiesWithJobs,
}: CompanyFilterPillProps) => {
  const options = useMemo(
    () =>
      companiesWithJobs.map((company) => ({
        value: company.value,
        label: company.label,
        meta: company.count,
      })),
    [companiesWithJobs],
  );

  return (
    <MultiCombobox
      variant="popover"
      noun="company"
      value={companyFilter}
      options={options}
      onValueChange={onCompanyFilterChange}
      trigger={
        <FilterPillTrigger
          icon={<Building2 />}
          label="Company"
          active={companyFilter.length > 0}
          badge={companyFilter.length}
        />
      }
      popoverTitle="Company"
      clearLabel="All companies"
      searchPlaceholder="Search companies..."
      inputAriaLabel="Search companies"
      listAriaLabel="Companies"
      emptyText="No companies found"
      showSelectedChips
      contentClassName="w-72"
    />
  );
};
