import { Banknote } from "lucide-react";
import type React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SalaryFilterMode } from "../constants";
import { FilterPill } from "./FilterPill";
import { salaryModeOptions } from "./filterOptions";
import { NumericFilterInput } from "./NumericFilterInput";
import type { SalaryFilterPillProps } from "./types";

const positiveOrNull = (value: number): number | null => (value > 0 ? value : null);

export const SalaryFilterPill: React.FC<SalaryFilterPillProps> = ({
  salaryFilter,
  onSalaryFilterChange,
  salaryActive,
  salarySummary,
}) => {
  const showSalaryMin = salaryFilter.mode === "at_least" || salaryFilter.mode === "between";
  const showSalaryMax = salaryFilter.mode === "at_most" || salaryFilter.mode === "between";

  return (
    <FilterPill icon={<Banknote />} label="Salary" active={salaryActive} summary={salarySummary}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Salary is</span>
          <Select
            value={salaryFilter.mode}
            onValueChange={(value) => {
              const nextMode = value as SalaryFilterMode;
              if (nextMode === "at_least") {
                onSalaryFilterChange({
                  mode: nextMode,
                  min: salaryFilter.min,
                  max: null,
                });
                return;
              }
              if (nextMode === "at_most") {
                onSalaryFilterChange({
                  mode: nextMode,
                  min: null,
                  max: salaryFilter.max,
                });
                return;
              }
              onSalaryFilterChange({
                mode: nextMode,
                min: salaryFilter.min,
                max: salaryFilter.max,
              });
            }}
          >
            <SelectTrigger
              id="salary-mode"
              aria-label="Salary range specifier"
              className="h-8 w-[140px] text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {salaryModeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {showSalaryMin && (
            <NumericFilterInput
              id="salary-min-filter"
              label="Minimum"
              value={salaryFilter.min}
              onChange={(min) => onSalaryFilterChange({ ...salaryFilter, min })}
              normalize={positiveOrNull}
              placeholder="e.g. 60000"
            />
          )}
          {showSalaryMax && (
            <NumericFilterInput
              id="salary-max-filter"
              label="Maximum"
              value={salaryFilter.max}
              onChange={(max) => onSalaryFilterChange({ ...salaryFilter, max })}
              normalize={positiveOrNull}
              placeholder="e.g. 100000"
            />
          )}
        </div>
      </div>
    </FilterPill>
  );
};
