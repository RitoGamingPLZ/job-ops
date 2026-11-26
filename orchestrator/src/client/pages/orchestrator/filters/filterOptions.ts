import type {
  DateFilterPreset,
  FilterTab,
  JobSort,
  SalaryFilterMode,
  ScoreFilterMode,
} from "../constants";

export const salaryModeOptions: Array<{
  value: SalaryFilterMode;
  label: string;
}> = [
  { value: "at_least", label: "at least" },
  { value: "at_most", label: "at most" },
  { value: "between", label: "between" },
];

export const scoreModeOptions: Array<{
  value: ScoreFilterMode;
  label: string;
}> = [
  { value: "any", label: "Any" },
  { value: "has", label: "Has a score" },
  { value: "missing", label: "No score" },
];

export const sortFieldOrder: JobSort["key"][] = [
  "score",
  "datePosted",
  "discoveredAt",
  "salary",
  "title",
  "employer",
];

export const tabDescriptions: Partial<Record<FilterTab, string>> = {
  discovered: "Jobs searched, ready to be tailored",
};

export const datePresetOptions: Array<{
  value: Exclude<DateFilterPreset, "custom">;
  label: string;
}> = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];
