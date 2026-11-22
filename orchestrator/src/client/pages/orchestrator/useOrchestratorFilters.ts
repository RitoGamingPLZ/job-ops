import type { JobSource } from "@shared/types.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizeCompanies } from "./companyFilter";
import type {
  DateFilterDimension,
  DateFilterPreset,
  EmploymentType,
  JobDateFilter,
  JobSort,
  SalaryFilter,
  SalaryFilterMode,
  ScoreFilter,
  ScoreFilterMode,
} from "./constants";
import {
  DEFAULT_SORT,
  dateFilterDimensionOrder,
  employmentTypeValues,
  postedWithinValues,
} from "./constants";

const allowedSalaryModes: SalaryFilterMode[] = ["at_least", "at_most", "between"];
const allowedScoreModes: ScoreFilterMode[] = ["any", "has", "missing"];
const clampScoreValue = (value: number): number => Math.min(100, Math.max(0, value));
const allowedSortKeys: JobSort["key"][] = [
  "datePosted",
  "discoveredAt",
  "score",
  "salary",
  "title",
  "employer",
];
const allowedSortDirections: JobSort["direction"][] = ["asc", "desc"];
const allowedDateFilterPresets: DateFilterPreset[] = ["7", "14", "30", "90", "custom"];

const isValidDateInput = (value: string | null): value is string =>
  value != null && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDateDimensions = (value: string | null): DateFilterDimension[] => {
  if (!value) return [];

  const seen = new Set<DateFilterDimension>();

  for (const token of value.split(",")) {
    if (!dateFilterDimensionOrder.includes(token as DateFilterDimension)) {
      continue;
    }
    seen.add(token as DateFilterDimension);
  }

  return dateFilterDimensionOrder.filter((dimension) => seen.has(dimension));
};

const parseEmploymentTypes = (value: string | null): EmploymentType[] => {
  if (!value) return [];

  const seen = new Set<EmploymentType>();
  for (const token of value.split(",")) {
    if (employmentTypeValues.includes(token as EmploymentType)) {
      seen.add(token as EmploymentType);
    }
  }

  return employmentTypeValues.filter((type) => seen.has(type));
};

// Only list filters belong in storage; navigation and selected jobs stay in the URL.
const filterStorageKey = "job-ops:jobs-list-filters:v1";
const filterParamNames = [
  "source",
  "company",
  "salaryMode",
  "salaryMin",
  "salaryMax",
  "minSalary",
  "scoreMode",
  "scoreMin",
  "scoreMax",
  "postedWithin",
  "employment",
  "location",
  "sort",
  "date",
  "appliedStart",
  "appliedEnd",
  "appliedRange",
];

const selectFilterParams = (params: URLSearchParams): URLSearchParams => {
  const filters = new URLSearchParams();
  for (const name of filterParamNames) {
    for (const value of params.getAll(name)) filters.append(name, value);
  }
  return filters;
};

export const useOrchestratorFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const lastObservedQuery = useRef<string | null>(null);
  const pendingClearQuery = useRef<string | null>(null);

  useEffect(() => {
    const query = searchParams.toString();
    // A child effect can clear filters before this effect observes the old URL.
    // Wait for that navigation before saving or restoring anything.
    if (pendingClearQuery.current !== null) {
      if (query === pendingClearQuery.current) {
        pendingClearQuery.current = null;
        lastObservedQuery.current = query;
      }
      return;
    }
    // Avoid repeated restores in StrictMode and after explicit filter clearing.
    if (lastObservedQuery.current === query) return;
    lastObservedQuery.current = query;

    const nextParams = new URLSearchParams(searchParams);
    // Search is no longer a URL filter; retain the existing legacy cleanup.
    nextParams.delete("q");
    let filters = selectFilterParams(nextParams);
    try {
      if (filters.size === 0) {
        filters = selectFilterParams(
          new URLSearchParams(localStorage.getItem(filterStorageKey) ?? ""),
        );
        for (const [name, value] of filters) nextParams.append(name, value);
      }
      if (filters.size > 0) {
        localStorage.setItem(filterStorageKey, filters.toString());
      }
    } catch {
      // Browser privacy settings and storage quotas must not break filtering.
    }

    if (nextParams.toString() !== query) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const updateFilterParams = useCallback(
    (update: (prev: URLSearchParams) => URLSearchParams) => {
      setSearchParams(
        (prev) => {
          const next = update(new URLSearchParams(prev));
          if (selectFilterParams(next).size === 0) {
            // An explicit clear must not restore the previous saved selection,
            // including when the browser refuses to remove it from storage.
            if (next.toString() !== prev.toString()) {
              pendingClearQuery.current = next.toString();
            }
            lastObservedQuery.current = next.toString();
            try {
              localStorage.removeItem(filterStorageKey);
            } catch {
              // Clearing still works when browser storage is unavailable.
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const sourceFilter = (searchParams.get("source") as JobSource | "all") || "all";
  const setSourceFilter = useCallback(
    (source: JobSource | "all") => {
      updateFilterParams((prev) => {
        if (source !== "all") prev.set("source", source);
        else prev.delete("source");
        return prev;
      });
    },
    [updateFilterParams],
  );

  const companyFilter = useMemo(
    () => normalizeCompanies(searchParams.getAll("company")),
    [searchParams],
  );
  const setCompanyFilter = useCallback(
    (values: string[]) => {
      updateFilterParams((prev) => {
        prev.delete("company");
        for (const value of normalizeCompanies(values)) {
          prev.append("company", value);
        }
        return prev;
      });
    },
    [updateFilterParams],
  );

  const salaryFilter = useMemo((): SalaryFilter => {
    const modeRaw = searchParams.get("salaryMode") ?? "at_least";
    const mode = allowedSalaryModes.includes(modeRaw as SalaryFilterMode)
      ? (modeRaw as SalaryFilterMode)
      : "at_least";

    const minRaw = searchParams.get("salaryMin") ?? searchParams.get("minSalary");
    const minParsed = minRaw == null ? Number.NaN : Number.parseInt(minRaw, 10);
    const min = Number.isFinite(minParsed) && minParsed > 0 ? minParsed : null;

    const maxRaw = searchParams.get("salaryMax");
    const maxParsed = maxRaw == null ? Number.NaN : Number.parseInt(maxRaw, 10);
    const max = Number.isFinite(maxParsed) && maxParsed > 0 ? maxParsed : null;

    return { mode, min, max };
  }, [searchParams]);

  const setSalaryFilter = useCallback(
    (value: SalaryFilter) => {
      updateFilterParams((prev) => {
        if (value.mode === "at_least") prev.delete("salaryMode");
        else prev.set("salaryMode", value.mode);

        if (value.min == null || value.min <= 0) prev.delete("salaryMin");
        else prev.set("salaryMin", String(value.min));

        if (value.max == null || value.max <= 0) prev.delete("salaryMax");
        else prev.set("salaryMax", String(value.max));

        prev.delete("minSalary");
        return prev;
      });
    },
    [updateFilterParams],
  );

  const scoreFilter = useMemo((): ScoreFilter => {
    const modeRaw = searchParams.get("scoreMode") ?? "any";
    const mode = allowedScoreModes.includes(modeRaw as ScoreFilterMode)
      ? (modeRaw as ScoreFilterMode)
      : "any";

    const minRaw = searchParams.get("scoreMin");
    const minParsed = minRaw == null ? Number.NaN : Number.parseInt(minRaw, 10);
    const min = Number.isFinite(minParsed) ? clampScoreValue(minParsed) : null;

    const maxRaw = searchParams.get("scoreMax");
    const maxParsed = maxRaw == null ? Number.NaN : Number.parseInt(maxRaw, 10);
    const max = Number.isFinite(maxParsed) ? clampScoreValue(maxParsed) : null;

    return { mode, min, max };
  }, [searchParams]);

  const setScoreFilter = useCallback(
    (value: ScoreFilter) => {
      updateFilterParams((prev) => {
        if (value.mode === "any") prev.delete("scoreMode");
        else prev.set("scoreMode", value.mode);

        if (value.min == null) prev.delete("scoreMin");
        else prev.set("scoreMin", String(clampScoreValue(value.min)));

        if (value.max == null) prev.delete("scoreMax");
        else prev.set("scoreMax", String(clampScoreValue(value.max)));

        return prev;
      });
    },
    [updateFilterParams],
  );

  const postedWithinDays = useMemo((): number | null => {
    const raw = searchParams.get("postedWithin");
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return postedWithinValues.includes(parsed) ? parsed : null;
  }, [searchParams]);

  const setPostedWithinDays = useCallback(
    (value: number | null) => {
      updateFilterParams((prev) => {
        if (value == null) prev.delete("postedWithin");
        else prev.set("postedWithin", String(value));
        return prev;
      });
    },
    [updateFilterParams],
  );

  const employmentTypes = useMemo(
    (): EmploymentType[] => parseEmploymentTypes(searchParams.get("employment")),
    [searchParams],
  );

  const setEmploymentTypes = useCallback(
    (values: EmploymentType[]) => {
      const normalized = employmentTypeValues.filter((type) => values.includes(type));
      updateFilterParams((prev) => {
        if (normalized.length === 0) prev.delete("employment");
        else prev.set("employment", normalized.join(","));
        return prev;
      });
    },
    [updateFilterParams],
  );

  const location = searchParams.get("location") ?? "";
  const setLocation = useCallback(
    (value: string) => {
      updateFilterParams((prev) => {
        // Keep the raw value (incl. spaces) so multi-word locations like
        // "new york" remain typeable; only drop the param when it is blank.
        if (!value.trim()) prev.delete("location");
        else prev.set("location", value);
        return prev;
      });
    },
    [updateFilterParams],
  );

  const sort = useMemo((): JobSort => {
    const sortValue = searchParams.get("sort");
    if (!sortValue) return DEFAULT_SORT;

    const [key, direction] = sortValue.split("-");
    if (
      !allowedSortKeys.includes(key as JobSort["key"]) ||
      !allowedSortDirections.includes(direction as JobSort["direction"])
    ) {
      return DEFAULT_SORT;
    }

    return {
      key: key as JobSort["key"],
      direction: direction as JobSort["direction"],
    };
  }, [searchParams]);

  const dateFilter = useMemo((): JobDateFilter => {
    const startDateRaw = searchParams.get("appliedStart");
    const endDateRaw = searchParams.get("appliedEnd");
    const startDate = isValidDateInput(startDateRaw) ? startDateRaw : null;
    const endDate = isValidDateInput(endDateRaw) ? endDateRaw : null;

    const presetRaw = searchParams.get("appliedRange");
    const preset = allowedDateFilterPresets.includes(presetRaw as DateFilterPreset)
      ? (presetRaw as DateFilterPreset)
      : null;

    const dimensions = parseDateDimensions(searchParams.get("date"));

    return {
      dimensions,
      startDate,
      endDate,
      preset,
    };
  }, [searchParams]);

  const setSort = useCallback(
    (newSort: JobSort) => {
      updateFilterParams((prev) => {
        if (newSort.key === DEFAULT_SORT.key && newSort.direction === DEFAULT_SORT.direction) {
          prev.delete("sort");
        } else {
          prev.set("sort", `${newSort.key}-${newSort.direction}`);
        }
        return prev;
      });
    },
    [updateFilterParams],
  );

  const setDateFilter = useCallback(
    (value: JobDateFilter) => {
      updateFilterParams((prev) => {
        if (value.dimensions.length === 0) prev.delete("date");
        else prev.set("date", value.dimensions.join(","));

        if (value.startDate == null) prev.delete("appliedStart");
        else prev.set("appliedStart", value.startDate);

        if (value.endDate == null) prev.delete("appliedEnd");
        else prev.set("appliedEnd", value.endDate);

        if (value.preset == null) prev.delete("appliedRange");
        else prev.set("appliedRange", value.preset);

        return prev;
      });
    },
    [updateFilterParams],
  );

  const resetFilters = useCallback(() => {
    try {
      localStorage.removeItem(filterStorageKey);
    } catch {
      // Reset still works when browser storage is unavailable.
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const name of filterParamNames) next.delete(name);
        if (next.toString() !== prev.toString()) {
          pendingClearQuery.current = next.toString();
        }
        lastObservedQuery.current = next.toString();
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return {
    searchParams,
    sourceFilter,
    setSourceFilter,
    companyFilter,
    setCompanyFilter,
    salaryFilter,
    setSalaryFilter,
    scoreFilter,
    setScoreFilter,
    postedWithinDays,
    setPostedWithinDays,
    employmentTypes,
    setEmploymentTypes,
    location,
    setLocation,
    dateFilter,
    setDateFilter,
    sort,
    setSort,
    resetFilters,
  };
};
