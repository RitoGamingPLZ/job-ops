import type { JobSource } from "@shared/types.js";
import type { CompanyOption } from "../companyFilter";
import type {
  EmploymentType,
  FilterTab,
  JobDateFilter,
  JobSort,
  SalaryFilter,
  ScoreFilter,
} from "../constants";

export interface OrchestratorFiltersProps {
  activeTab: FilterTab;
  onTabChange: (value: FilterTab) => void;
  counts: Record<FilterTab, number>;
  onOpenCommandBar: () => void;
  sourceFilter: JobSource | "all";
  companyFilter: string[];
  onCompanyFilterChange: (values: string[]) => void;
  companiesWithJobs: CompanyOption[];
  onSourceFilterChange: (value: JobSource | "all") => void;
  salaryFilter: SalaryFilter;
  onSalaryFilterChange: (value: SalaryFilter) => void;
  scoreFilter: ScoreFilter;
  onScoreFilterChange: (value: ScoreFilter) => void;
  postedWithinDays: number | null;
  onPostedWithinChange: (value: number | null) => void;
  employmentTypes: EmploymentType[];
  onEmploymentTypesChange: (value: EmploymentType[]) => void;
  locationFilter: string;
  onLocationFilterChange: (value: string) => void;
  dateFilter: JobDateFilter;
  onDateFilterChange: (value: JobDateFilter) => void;
  sourcesWithJobs: JobSource[];
  sort: JobSort;
  onSortChange: (sort: JobSort) => void;
  onResetFilters: () => void;
  filteredCount: number;
}

export type LocationFilterInputProps = Pick<
  OrchestratorFiltersProps,
  "locationFilter" | "onLocationFilterChange"
>;

export type SourceFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "sourceFilter" | "onSourceFilterChange" | "sourcesWithJobs"
>;

export type PostedWithinFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "postedWithinDays" | "onPostedWithinChange"
> & {
  postedWithinLabel: string | null;
};

export type EmploymentTypeFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "employmentTypes" | "onEmploymentTypesChange"
>;

export type DateFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "dateFilter" | "onDateFilterChange"
>;

export type SalaryFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "salaryFilter" | "onSalaryFilterChange"
> & {
  salaryActive: boolean;
  salarySummary: string | null;
};

export type ScoreFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "scoreFilter" | "onScoreFilterChange"
> & {
  scoreActive: boolean;
  scoreSummary: string | null;
};

export type SortFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "activeTab" | "sort" | "onSortChange" | "filteredCount"
> & {
  sortDirectionLabel: string | undefined;
};

export type OrchestratorTabRowProps = Pick<
  OrchestratorFiltersProps,
  "counts" | "onOpenCommandBar"
>;

export type CompanyFilterPillProps = Pick<
  OrchestratorFiltersProps,
  "companyFilter" | "onCompanyFilterChange" | "companiesWithJobs"
>;
