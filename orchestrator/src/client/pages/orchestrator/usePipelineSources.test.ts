import { makeAuthToken } from "@client/test/auth-token";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { PIPELINE_SOURCES_STORAGE_KEY } from "./constants";
import { getPipelineSourcesStorageKey, usePipelineSources } from "./usePipelineSources";

describe("usePipelineSources", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("pre-selects core default sources for new users while leaving opt-in sources unchecked", () => {
    const enabledSources = [
      "indeed",
      "linkedin",
      "hiringcafe",
      "adzuna",
      "jobindex",
      "freehire",
    ] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["linkedin", "indeed", "freehire"]);
  });

  it("filters stored sources to enabled sources", () => {
    localStorage.setItem(PIPELINE_SOURCES_STORAGE_KEY, JSON.stringify(["freehire", "adzuna"]));

    const enabledSources = ["freehire"] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["freehire"]);
  });

  it("falls back to core defaults matching enabled sources, then first enabled source", () => {
    localStorage.setItem(PIPELINE_SOURCES_STORAGE_KEY, JSON.stringify(["adzuna"]));

    const enabledWithCore = ["hiringcafe", "linkedin"] as const;
    const { result: withCore } = renderHook(() => usePipelineSources(enabledWithCore));
    expect(withCore.current.pipelineSources).toEqual(["linkedin"]);

    localStorage.clear();
    const enabledWithoutCore = ["hiringcafe", "jobindex"] as const;
    const { result: withoutCore } = renderHook(() => usePipelineSources(enabledWithoutCore));
    expect(withoutCore.current.pipelineSources).toEqual(["hiringcafe"]);
  });

  it("ignores toggles for disabled sources", () => {
    localStorage.setItem(PIPELINE_SOURCES_STORAGE_KEY, JSON.stringify(["freehire"]));

    const enabledSources = ["freehire"] as const;

    const { result } = renderHook(() => usePipelineSources(enabledSources));

    act(() => {
      result.current.toggleSource("adzuna", true);
    });

    expect(result.current.pipelineSources).toEqual(["freehire"]);
  });

  it("loads and saves sources using workspace-scoped storage keys", () => {
    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-one"));
    localStorage.setItem(getPipelineSourcesStorageKey(), JSON.stringify(["adzuna"]));

    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-two"));
    localStorage.setItem(getPipelineSourcesStorageKey(), JSON.stringify(["linkedin"]));

    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-one"));
    const enabledSources = ["adzuna", "linkedin"] as const;
    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(getPipelineSourcesStorageKey()).toBe(
      `${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-one`,
    );
    expect(result.current.pipelineSources).toEqual(["adzuna"]);

    act(() => {
      result.current.toggleSource("linkedin", true);
    });

    expect(
      JSON.parse(
        localStorage.getItem(`${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-one`) ?? "[]",
      ),
    ).toEqual(["adzuna", "linkedin"]);
    expect(
      JSON.parse(
        localStorage.getItem(`${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-two`) ?? "[]",
      ),
    ).toEqual(["linkedin"]);
  });

  it("migrates legacy stored sources into the workspace-scoped key", () => {
    sessionStorage.setItem("jobops.authToken", makeAuthToken("tenant-one"));
    localStorage.setItem(PIPELINE_SOURCES_STORAGE_KEY, JSON.stringify(["adzuna"]));

    const enabledSources = ["adzuna", "linkedin"] as const;
    const { result } = renderHook(() => usePipelineSources(enabledSources));

    expect(result.current.pipelineSources).toEqual(["adzuna"]);
    expect(localStorage.getItem(`${PIPELINE_SOURCES_STORAGE_KEY}:workspace:tenant-one`)).toBe(
      localStorage.getItem(PIPELINE_SOURCES_STORAGE_KEY),
    );
  });
});
