import { RotateCcw } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { CompanyFilterPill } from "./CompanyFilterPill";
import { DateFilterPill } from "./DateFilterPill";
import { EmploymentTypeFilterPill } from "./EmploymentTypeFilterPill";
import { LocationFilterInput } from "./LocationFilterInput";
import { PostedWithinFilterPill } from "./PostedWithinFilterPill";
import { SalaryFilterPill } from "./SalaryFilterPill";
import { ScoreFilterPill } from "./ScoreFilterPill";
import { SortFilterPill } from "./SortFilterPill";
import { SourceFilterPill } from "./SourceFilterPill";
import type { OrchestratorFiltersProps } from "./types";
import type { useFilterBarDerivedState } from "./useFilterBarDerivedState";

type OrchestratorFilterBarProps = OrchestratorFiltersProps &
  Pick<
    ReturnType<typeof useFilterBarDerivedState>,
    | "activeFilterCount"
    | "postedWithinLabel"
    | "sortDirectionLabel"
    | "salaryActive"
    | "salarySummary"
    | "scoreActive"
    | "scoreSummary"
  >;

/**
 * Always-visible, Linear-style filter strip: compact filter chips flow
 * left-to-right and wrap, "Reset" appears once any filter is active, and the
 * sort control is pinned to the right edge.
 */
export const OrchestratorFilterBar: React.FC<OrchestratorFilterBarProps> = ({
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
  onResetFilters,
  filteredCount,
  activeFilterCount,
  postedWithinLabel,
  sortDirectionLabel,
  salaryActive,
  salarySummary,
  scoreActive,
  scoreSummary,
}) => (
  <div
    id="orchestrator-filter-bar"
    role="toolbar"
    aria-label="Job filters"
    className="flex flex-wrap items-center gap-1.5"
  >
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

    {activeFilterCount > 0 ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onResetFilters}
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </Button>
    ) : null}

    <div className="ml-auto">
      <SortFilterPill
        activeTab={activeTab}
        sort={sort}
        onSortChange={onSortChange}
        filteredCount={filteredCount}
        sortDirectionLabel={sortDirectionLabel}
      />
    </div>
  </div>
);
