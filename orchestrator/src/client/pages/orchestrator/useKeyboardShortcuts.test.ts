import * as api from "@client/api";
import { getShortcutsForTab, SHORTCUTS } from "@client/lib/shortcut-map";
import { createJob } from "@shared/testing/factories.js";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const { bindings } = vi.hoisted(() => ({
  bindings: {} as Record<string, () => void>,
}));
vi.mock("@client/api", () => ({ targetJob: vi.fn(), untargetJob: vi.fn() }));
vi.mock("@client/hooks/useHotkeys", () => ({
  useHotkeys: (keys: Record<string, () => void>) =>
    Object.assign(bindings, keys),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup(
  job = createJob({ status: "discovered", readyAt: null }),
  selectedJobIds = new Set<string>(),
) {
  const args = {
    isAnyModalOpen: false,
    isAnyModalOpenExcludingCommandBar: false,
    isAnyModalOpenExcludingHelp: false,
    activeTab: "all" as const,
    activeJobs: [job],
    selectedJobId: job.id,
    selectedJob: job,
    selectedJobSummary: job,
    selectedJobIds,
    isDesktop: true,
    handleSelectJobId: vi.fn(),
    requestScrollToJob: vi.fn(),
    setActiveTab: vi.fn(),
    setIsCommandBarOpen: vi.fn(),
    setIsHelpDialogOpen: vi.fn(),
    clearSelection: vi.fn(),
    toggleSelectJob: vi.fn(),
    targetSelectedJobs: vi.fn().mockResolvedValue(undefined),
    loadJobs: vi.fn().mockResolvedValue(undefined),
  };
  renderHook(() => useKeyboardShortcuts(args));
  return args;
}

describe("Search Jobs shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(bindings)) delete bindings[key];
    vi.mocked(api.targetJob).mockResolvedValue(createJob());
    vi.mocked(api.untargetJob).mockResolvedValue(createJob({ readyAt: null }));
  });

  it("targets and refreshes without starting tailoring", async () => {
    const args = setup();
    await act(async () => bindings.r());
    expect(api.targetJob).toHaveBeenCalledWith(args.selectedJobId);
    expect(args.loadJobs).toHaveBeenCalledOnce();
  });

  it("untargets an existing target", async () => {
    const job = createJob({ status: "ready", readyAt: "2026-11-08" });
    setup(job);
    await act(async () => bindings.r());
    expect(api.untargetJob).toHaveBeenCalledWith(job.id);
  });

  it("uses bulk Target when jobs are selected", () => {
    const args = setup(undefined, new Set(["job-1"]));
    act(() => bindings.r());
    expect(args.targetSelectedJobs).toHaveBeenCalledOnce();
    expect(api.targetJob).not.toHaveBeenCalled();
  });

  it("does not bind or advertise removed actions", () => {
    setup();
    for (const id of ["skip", "markApplied"] as const) {
      expect(bindings[SHORTCUTS[id].key]).toBeUndefined();
      expect(getShortcutsForTab("all")).not.toContain(SHORTCUTS[id]);
    }
    expect(bindings.p).toBeUndefined();
    expect(bindings.d).toBeUndefined();
    expect("viewPdf" in SHORTCUTS).toBe(false);
    expect("downloadPdf" in SHORTCUTS).toBe(false);
    expect(getShortcutsForTab("all")).toContain(SHORTCUTS.moveToReady);
  });

  it("switches between Discovered and All using 1 and 2", () => {
    const args = setup();
    act(() => bindings["1"]());
    expect(args.setActiveTab).toHaveBeenLastCalledWith("discovered");
    act(() => bindings["2"]());
    expect(args.setActiveTab).toHaveBeenLastCalledWith("all");
  });
});
