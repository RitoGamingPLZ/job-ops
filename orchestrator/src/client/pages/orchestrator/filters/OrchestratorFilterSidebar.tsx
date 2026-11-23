import { RightSidebar } from "@client/components/layout";
import type React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CompanyFilterPill } from "./CompanyFilterPill";
import { DateFilterPill } from "./DateFilterPill";
import { EmploymentTypeFilterPill } from "./EmploymentTypeFilterPill";
import { LocationFilterInput } from "./LocationFilterInput";
import { OrchestratorFilterBar } from "./OrchestratorFilterBar";
import { PostedWithinFilterPill } from "./PostedWithinFilterPill";
import { SalaryFilterPill } from "./SalaryFilterPill";
import { ScoreFilterPill } from "./ScoreFilterPill";
import { SortFilterPill } from "./SortFilterPill";
import { SourceFilterPill } from "./SourceFilterPill";
import type { OrchestratorFiltersProps } from "./types";
import { useFilterBarDerivedState } from "./useFilterBarDerivedState";

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

export const OrchestratorFilterSidebar: React.FC<
  OrchestratorFiltersProps & { isDesktop: boolean }
> = (props) => {
  const {
    isDesktop,
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
  } = props;

  const {
    isFiltersOpen,
    onFiltersOpenChange,
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

  const sections = (
    <OrchestratorFilterSections
      {...props}
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

  if (isDesktop) {
    if (!isFiltersOpen) return null;
    return (
      <RightSidebar title="Filters" className="rounded-lg border border-r border-border">
        {sections}
      </RightSidebar>
    );
  }

  return (
    <Sheet open={isFiltersOpen} onOpenChange={onFiltersOpenChange}>
      <SheetContent side="right" className="w-80 overflow-y-auto p-4">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="mt-4">{sections}</div>
      </SheetContent>
    </Sheet>
  );
};
