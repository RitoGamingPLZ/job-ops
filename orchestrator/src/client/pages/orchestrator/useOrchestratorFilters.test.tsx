import { act, render, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode, useEffect } from "react";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SORT } from "./constants";
import { useOrchestratorFilters } from "./useOrchestratorFilters";

const createWrapper = (initialEntry: string) => {
  let latestLocation = "";
  let latestNavigationType = "";

  const LocationWatcher = () => {
    const location = useLocation();
    latestNavigationType = useNavigationType();
    latestLocation = location.pathname + location.search;
    return null;
  };

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationWatcher />
        {children}
      </MemoryRouter>
    </StrictMode>
  );
  Wrapper.displayName = "RouterWrapper";
  return {
    Wrapper,
    getLocation: () => latestLocation,
    getNavigationType: () => latestNavigationType,
  };
};

const storageKey = "job-ops:jobs-list-filters:v1";

describe("useOrchestratorFilters", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("saves filter changes without navigation or unrelated params", () => {
    const { Wrapper } = createWrapper("/ready?tab=ready&jobId=123&keep=yes");
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });
    act(() => result.current.setSourceFilter("linkedin"));
    act(() => result.current.setCompanyFilter(["Acme, Inc.", "Google"]));
    act(() => result.current.setLocation("new york"));
    act(() =>
      result.current.setSalaryFilter({
        mode: "between",
        min: 50000,
        max: 90000,
      }),
    );
    act(() => result.current.setScoreFilter({ mode: "has", min: 50, max: 90 }));
    act(() => result.current.setSponsorFilter("confirmed"));
    act(() => result.current.setPostedWithinDays(7));
    act(() => result.current.setEmploymentTypes(["full_time"]));
    act(() => result.current.setSort({ key: "title", direction: "asc" }));
    act(() =>
      result.current.setDateFilter({
        dimensions: ["ready"],
        startDate: "2026-04-01",
        endDate: null,
        preset: "custom",
      }),
    );
    const saved = new URLSearchParams(localStorage.getItem(storageKey) ?? "");
    expect(saved.getAll("company")).toEqual(["acme, inc.", "google"]);
    expect(Object.fromEntries(saved)).toMatchObject({
      source: "linkedin",
      location: "new york",
      salaryMode: "between",
      salaryMin: "50000",
      salaryMax: "90000",
      scoreMode: "has",
      scoreMin: "50",
      scoreMax: "90",
      sponsor: "confirmed",
      postedWithin: "7",
      employment: "full_time",
      sort: "title-asc",
      date: "ready",
      appliedStart: "2026-04-01",
      appliedRange: "custom",
    });
    expect(saved.has("tab")).toBe(false);
    expect(saved.has("jobId")).toBe(false);
    expect(saved.has("keep")).toBe(false);
  });

  it("restores saved filters with replace and preserves current navigation", () => {
    localStorage.setItem(
      storageKey,
      "source=linkedin&company=acme&company=google&location=new+york&tab=closed&jobId=old&q=legacy",
    );
    const { Wrapper, getLocation, getNavigationType } = createWrapper(
      "/ready?tab=ready&jobId=current&keep=yes&q=old",
    );
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });
    expect(result.current.sourceFilter).toBe("linkedin");
    expect(result.current.companyFilter).toEqual(["acme", "google"]);
    expect(result.current.location).toBe("new york");
    expect(getNavigationType()).toBe("REPLACE");
    const params = new URLSearchParams(getLocation().split("?")[1]);
    expect(params.get("tab")).toBe("ready");
    expect(params.get("jobId")).toBe("current");
    expect(params.get("keep")).toBe("yes");
    expect(params.has("q")).toBe(false);
    act(() => result.current.resetFilters());
    expect(getLocation()).toBe("/ready?tab=ready&jobId=current&keep=yes");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("lets URL filters win without merging and removes storage when the last filter is cleared", () => {
    localStorage.setItem(storageKey, "source=linkedin&company=saved");
    const { Wrapper } = createWrapper("/all?location=london");
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });
    expect(result.current.location).toBe("london");
    expect(result.current.sourceFilter).toBe("all");
    expect(result.current.companyFilter).toEqual([]);
    expect(localStorage.getItem(storageKey)).toBe("location=london");
    act(() => result.current.setLocation(""));
    expect(result.current.location).toBe("");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("restores saved filters when the sidebar navigates to a bare jobs URL", () => {
    const { Wrapper, getLocation, getNavigationType } = createWrapper(
      "/jobs/all?source=linkedin&company=acme",
    );
    const { result } = renderHook(
      () => ({ filters: useOrchestratorFilters(), navigate: useNavigate() }),
      { wrapper: Wrapper },
    );
    act(() => result.current.navigate("/jobs/ready"));
    expect(result.current.filters.sourceFilter).toBe("linkedin");
    expect(result.current.filters.companyFilter).toEqual(["acme"]);
    expect(getLocation()).toBe("/jobs/ready?source=linkedin&company=acme");
    expect(getNavigationType()).toBe("REPLACE");
    expect(localStorage.getItem(storageKey)).toBe(
      "source=linkedin&company=acme",
    );

    act(() => result.current.filters.setCompanyFilter([]));
    expect(localStorage.getItem(storageKey)).toBe("source=linkedin");
    act(() => result.current.filters.setSourceFilter("all"));
    expect(getLocation()).toBe("/jobs/ready");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps a last-filter clear from a child effect ahead of saving the old URL", () => {
    const { Wrapper, getLocation } = createWrapper("/jobs/all?source=linkedin");
    const ClearUnavailableSource = ({ clear }: { clear: () => void }) => {
      useEffect(() => clear(), [clear]);
      return null;
    };
    const Parent = () => {
      const filters = useOrchestratorFilters();
      return filters.sourceFilter !== "all" ? (
        <ClearUnavailableSource clear={() => filters.setSourceFilter("all")} />
      ) : null;
    };
    render(<Parent />, { wrapper: Wrapper });
    expect(getLocation()).toBe("/jobs/all");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("does not restore stale filters when removing the last filter fails in storage", () => {
    const { Wrapper, getLocation } = createWrapper("/jobs/all?location=london");
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    act(() => result.current.setLocation(""));
    expect(result.current.location).toBe("");
    expect(getLocation()).toBe("/jobs/all");
  });

  it.each([
    "getItem",
    "setItem",
    "removeItem",
  ] as const)("keeps filters usable when storage %s throws", (method) => {
    vi.spyOn(localStorage, method).mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const { Wrapper, getLocation } = createWrapper("/all?keep=yes");
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });
    act(() => result.current.setSourceFilter("linkedin"));
    expect(result.current.sourceFilter).toBe("linkedin");
    act(() => result.current.resetFilters());
    expect(result.current.sourceFilter).toBe("all");
    expect(getLocation()).toBe("/all?keep=yes");
  });

  it("round-trips multiple company params without splitting punctuation and resets with source", () => {
    const { Wrapper, getLocation } = createWrapper(
      "/all?company=+GOOGLE+&company=google&company=Google+LLC&source=linkedin&keep=yes",
    );
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });
    expect(result.current.companyFilter).toEqual(["google", "google llc"]);
    expect(result.current.sourceFilter).toBe("linkedin");
    act(() =>
      result.current.setCompanyFilter([
        "Acme, Inc.",
        " A & B ",
        "acme, inc.",
        "  ",
      ]),
    );
    const params = new URLSearchParams(getLocation().split("?")[1]);
    expect(params.getAll("company")).toEqual(["acme, inc.", "a & b"]);
    expect(params.get("source")).toBe("linkedin");
    expect(result.current.companyFilter).toEqual(["acme, inc.", "a & b"]);
    const restored = createWrapper(getLocation());
    const { result: restoredResult } = renderHook(
      () => useOrchestratorFilters(),
      { wrapper: restored.Wrapper },
    );
    expect(restoredResult.current.companyFilter).toEqual(
      result.current.companyFilter,
    );
    act(() => result.current.setCompanyFilter([]));
    expect(getLocation()).not.toContain("company=");
    act(() => result.current.setCompanyFilter(["Google"]));
    act(() => result.current.resetFilters());
    expect(result.current.companyFilter).toEqual([]);
    expect(result.current.sourceFilter).toBe("all");
    expect(getLocation()).toBe("/all?keep=yes");
  });

  it("parses a valid sort query param", () => {
    const { Wrapper } = createWrapper("/ready?sort=datePosted-asc");
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });

    expect(result.current.sort).toEqual({
      key: "datePosted",
      direction: "asc",
    });
  });

  it("falls back to default sort for invalid sort query params", () => {
    const cases = [
      "/ready?sort=title",
      "/ready?sort=invalid-asc",
      "/ready?sort=title-sideways",
    ];

    for (const entry of cases) {
      const { Wrapper } = createWrapper(entry);
      const { result } = renderHook(() => useOrchestratorFilters(), {
        wrapper: Wrapper,
      });
      expect(result.current.sort).toEqual(DEFAULT_SORT);
    }
  });

  it("parses date filter params", () => {
    const { Wrapper } = createWrapper(
      "/all?date=ready,applied&appliedRange=30&appliedStart=2026-03-10&appliedEnd=2026-04-08",
    );
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });

    expect(result.current.dateFilter).toEqual({
      dimensions: ["ready", "applied"],
      startDate: "2026-03-10",
      endDate: "2026-04-08",
      preset: "30",
    });
  });

  it("round-trips date filter params and resets them", () => {
    const { Wrapper, getLocation } = createWrapper("/all");
    const { result } = renderHook(() => useOrchestratorFilters(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.setDateFilter({
        dimensions: ["ready", "closed"],
        startDate: "2026-04-01",
        endDate: "2026-04-08",
        preset: "custom",
      });
    });

    expect(getLocation()).toContain("date=ready%2Cclosed");
    expect(getLocation()).toContain("appliedStart=2026-04-01");
    expect(getLocation()).toContain("appliedEnd=2026-04-08");
    expect(getLocation()).toContain("appliedRange=custom");

    act(() => {
      result.current.resetFilters();
    });

    expect(getLocation()).toBe("/all");
  });
});
