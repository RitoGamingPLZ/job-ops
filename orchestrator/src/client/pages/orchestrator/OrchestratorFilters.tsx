import { RightSidebar } from "@client/components/layout";
import type React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

export const OrchestratorFilterSections: React.FC<
  OrchestratorFiltersProps &
    Pick<
      ReturnType<typeof useFilterBarDerivedState>,
      | "postedWithinLabel"
      | "sortDirectionLabel"
      | "salaryActive"
      | "salarySummary"
      | "scoreActive"
      | "scoreSummary"
    >
> = ({
  activeTab,
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
  filteredCount,
  postedWithinLabel,
  sortDirectionLabel,
  salaryActive,
  salarySummary,
  scoreActive,
  scoreSummary,
}) => (
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

    <div className="my-1 h-px w-full bg-border" aria-hidden="true" />

    <SortFilterPill
      activeTab={activeTab}
      sort={sort}
      onSortChange={onSortChange}
      filteredCount={filteredCount}
      sortDirectionLabel={sortDirectionLabel}
    />
  </OrchestratorFilterBar>
);

export const OrchestratorFilters: React.FC<
  OrchestratorFiltersProps & {
    children?: React.ReactNode;
    isDesktop?: boolean;
  }
> = ({
  children,
  isDesktop = true,
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

  const filterSections = (
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
  );

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

        {children ? (
          <>
            <div className="flex min-w-0 items-start gap-4">
              {children}
              {isFiltersOpen && isDesktop ? (
                <RightSidebar title="Filters" className="rounded-lg border border-r border-border">
                  {filterSections}
                </RightSidebar>
              ) : null}
            </div>
            {!isDesktop ? (
              <Sheet open={isFiltersOpen} onOpenChange={onFiltersOpenChange}>
                <SheetContent side="right" className="w-80 overflow-y-auto p-4">
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                  </SheetHeader>
                  <div className="mt-4">{filterSections}</div>
                </SheetContent>
              </Sheet>
            ) : null}
          </>
        ) : isFiltersOpen ? (
          filterSections
        ) : null}
      </div>
    </Tabs>
  );
};
