import type React from "react";
import { Tabs } from "@/components/ui/tabs";
import type { FilterTab } from "./constants";
import { OrchestratorFilterSections } from "./filters/OrchestratorFilterSidebar";
import { OrchestratorTabRow } from "./filters/OrchestratorTabRow";
import type { OrchestratorFiltersProps } from "./filters/types";
import { useFilterBarDerivedState } from "./filters/useFilterBarDerivedState";

export type { OrchestratorFiltersProps } from "./filters/types";

export const OrchestratorFilters: React.FC<
  OrchestratorFiltersProps & {
    hidePanel?: boolean;
  }
> = ({
  hidePanel = false,
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

        {!hidePanel && isFiltersOpen ? (
          <OrchestratorFilterSections
            activeTab={activeTab}
            onTabChange={onTabChange}
            counts={counts}
            onOpenCommandBar={onOpenCommandBar}
            companyFilter={companyFilter}
            onCompanyFilterChange={onCompanyFilterChange}
            companiesWithJobs={companiesWithJobs}
            sourceFilter={sourceFilter}
            onSourceFilterChange={onSourceFilterChange}
            salaryFilter={salaryFilter}
            onSalaryFilterChange={onSalaryFilterChange}
            scoreFilter={scoreFilter}
            onScoreFilterChange={onScoreFilterChange}
            postedWithinDays={postedWithinDays}
            onPostedWithinChange={onPostedWithinChange}
            employmentTypes={employmentTypes}
            onEmploymentTypesChange={onEmploymentTypesChange}
            locationFilter={locationFilter}
            onLocationFilterChange={onLocationFilterChange}
            dateFilter={dateFilter}
            onDateFilterChange={onDateFilterChange}
            sourcesWithJobs={sourcesWithJobs}
            sort={sort}
            onSortChange={onSortChange}
            onResetFilters={onResetFilters}
            filteredCount={filteredCount}
            isFiltersOpen={isFiltersOpen}
            onFiltersOpenChange={onFiltersOpenChange}
            postedWithinLabel={postedWithinLabel}
            sortDirectionLabel={sortDirectionLabel}
            salaryActive={salaryActive}
            salarySummary={salarySummary}
            scoreActive={scoreActive}
            scoreSummary={scoreSummary}
          />
        ) : null}
      </div>
    </Tabs>
  );
};
