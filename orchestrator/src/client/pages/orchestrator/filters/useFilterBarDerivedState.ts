import type { JobSource } from "@shared/types.js";
import { useMemo, useState } from "react";
import type {
  EmploymentType,
  JobDateFilter,
  JobSort,
  SalaryFilter,
  ScoreFilter,
} from "../constants";
import { postedWithinOptions } from "../constants";
import {
  formatSalarySummary,
  formatScoreSummary,
  getDirectionOptions,
  isSalaryFilterActive,
  isScoreFilterActive,
} from "./filterUtils";

interface UseFilterBarDerivedStateArgs {
  sourceFilter: JobSource | "all";
  companyFilter: string[];
  dateFilter: JobDateFilter;
  postedWithinDays: number | null;
  employmentTypes: EmploymentType[];
  locationFilter: string;
  salaryFilter: SalaryFilter;
  scoreFilter: ScoreFilter;
  sort: JobSort;
  isFiltersOpen?: boolean;
  onFiltersOpenChange?: (open: boolean) => void;
}

export const useFilterBarDerivedState = ({
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
}: UseFilterBarDerivedStateArgs) => {
  const [internalFiltersOpen, setInternalFiltersOpen] = useState(false);
  const isFiltersOpen = isFiltersOpenProp ?? internalFiltersOpen;
  const onFiltersOpenChange = onFiltersOpenChangeProp ?? setInternalFiltersOpen;

  const salaryActive = isSalaryFilterActive(salaryFilter);
  const scoreActive = isScoreFilterActive(scoreFilter);

  const activeFilterCount = useMemo(
    () =>
      Number(sourceFilter !== "all") +
      Number(companyFilter.length > 0) +
      Number(dateFilter.dimensions.length > 0) +
      Number(postedWithinDays != null) +
      Number(employmentTypes.length > 0) +
      Number(locationFilter.trim() !== "") +
      Number(salaryActive) +
      Number(scoreActive),
    [
      sourceFilter,
      companyFilter.length,
      dateFilter.dimensions.length,
      postedWithinDays,
      employmentTypes.length,
      locationFilter,
      salaryActive,
      scoreActive,
    ],
  );

  const postedWithinLabel =
    postedWithinOptions.find((option) => option.value === postedWithinDays)
      ?.label ?? null;

  const sortDirectionLabel = getDirectionOptions(sort.key).find(
    (option) => option.value === sort.direction,
  )?.label;

  const salarySummary = formatSalarySummary(salaryFilter);
  const scoreSummary = formatScoreSummary(scoreFilter);

  return {
    isFiltersOpen,
    onFiltersOpenChange,
    salaryActive,
    scoreActive,
    activeFilterCount,
    postedWithinLabel,
    sortDirectionLabel,
    salarySummary,
    scoreSummary,
  };
};
