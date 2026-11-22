import type React from "react";
import { Tabs } from "@/components/ui/tabs";
import type { FilterTab } from "./constants";
import { CompanyFilterPill } from "./filters/CompanyFilterPill";
import { DateFilterPill } from "./filters/DateFilterPill";
import { EmploymentTypeFilterPill } from "./filters/EmploymentTypeFilterPill";
import { LocationFilterInput } from "./filters/LocationFilterInput";
import { OrchestratorFilterBar } from "./filters/OrchestratorFilterBar";
import { OrchestratorTabRow } from "./filters/OrchestratorTabRow";
import { PostedWithinFilterPill } from "./filters/PostedWithinFilterPill";
import { SalaryFilterPill } from "./filters/SalaryFilterPill";
import { ScoreFilterPill } from "./filters/ScoreFilterPill";
import { SortFilterPill } from "./filters/SortFilterPill";
import { SourceFilterPill } from "./filters/SourceFilterPill";
import type { OrchestratorFiltersProps } from "./filters/types";
import { useFilterBarDerivedState } from "./filters/useFilterBarDerivedState";

export type { OrchestratorFiltersProps } from "./filters/types";

export const OrchestratorFilters: React.FC<OrchestratorFiltersProps> = ({
  activeTab,
  onTabChange,
  counts,
  onOpenCommandBar,
  companyFilter,
  onCompanyFilterChange,
  companiesWithJobs,
  sourceFilter,
  onSourceFilterChange,
  salaryFilter,
  onSalaryFilterChange,
  scoreFilter,
  onScoreFilterChange,
  postedWithinDays,
  onPostedWithinChange,
  employmentTypes,
  onEmploymentTypesChange,
  locationFilter,
  onLocationFilterChange,
  dateFilter,
  onDateFilterChange,
  sourcesWithJobs,
  sort,
  onSortChange,
  onResetFilters,
  filteredCount,
  isFiltersOpen: isFiltersOpenProp,
  onFiltersOpenChange: onFiltersOpenChangeProp,
}) => {
  const {
    isFiltersOpen,
    onFiltersOpenChange,
    activeFilterCount,
    postedWithinLabel,
    sortDirectionLabel,
    salaryActive,
    salarySummary,
    scoreActive,
    scoreSummary,
  } = useFilterBarDerivedState({
    sourceFilter,
    companyFilter,
    dateFilter,
    postedWithinDays,
    employmentTypes,
    locationFilter,
    salaryFilter,
    scoreFilter,
    sort,
    isFiltersOpen: isFiltersOpenProp,
    onFiltersOpenChange: onFiltersOpenChangeProp,
  });

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as FilterTab)}>
      <div className="space-y-3">
        <OrchestratorTabRow
          counts={counts}
          onOpenCommandBar={onOpenCommandBar}
          isFiltersOpen={isFiltersOpen}
          onFiltersOpenChange={onFiltersOpenChange}
          activeFilterCount={activeFilterCount}
          onResetFilters={onResetFilters}
        />

        {isFiltersOpen ? (
          <OrchestratorFilterBar>
            <LocationFilterInput
              locationFilter={locationFilter}
              onLocationFilterChange={onLocationFilterChange}
            />

            <SourceFilterPill
              sourceFilter={sourceFilter}
              onSourceFilterChange={onSourceFilterChange}
              sourcesWithJobs={sourcesWithJobs}
            />

            <CompanyFilterPill
              companyFilter={companyFilter}
              onCompanyFilterChange={onCompanyFilterChange}
              companiesWithJobs={companiesWithJobs}
            />

            <PostedWithinFilterPill
              postedWithinDays={postedWithinDays}
              onPostedWithinChange={onPostedWithinChange}
              postedWithinLabel={postedWithinLabel}
            />

            <EmploymentTypeFilterPill
              employmentTypes={employmentTypes}
              onEmploymentTypesChange={onEmploymentTypesChange}
            />

            <DateFilterPill dateFilter={dateFilter} onDateFilterChange={onDateFilterChange} />

            <SalaryFilterPill
              salaryFilter={salaryFilter}
              onSalaryFilterChange={onSalaryFilterChange}
              salaryActive={salaryActive}
              salarySummary={salarySummary}
            />

            <ScoreFilterPill
              scoreFilter={scoreFilter}
              onScoreFilterChange={onScoreFilterChange}
              scoreActive={scoreActive}
              scoreSummary={scoreSummary}
            />

            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />

            <SortFilterPill
              activeTab={activeTab}
              sort={sort}
              onSortChange={onSortChange}
              filteredCount={filteredCount}
              sortDirectionLabel={sortDirectionLabel}
            />
          </OrchestratorFilterBar>
        ) : null}
      </div>
    </Tabs>
  );
};
