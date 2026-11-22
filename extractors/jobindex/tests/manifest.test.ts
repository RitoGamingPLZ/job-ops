import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/run", () => ({
  runJobindex: vi.fn(),
}));

describe("jobindex manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards Denmark automatic-run settings to the runner", async () => {
    const { manifest } = await import("../src/manifest");
    const { runJobindex } = await import("../src/run");
    const runJobindexMock = vi.mocked(runJobindex);
    runJobindexMock.mockResolvedValue({
      success: true,
      jobs: [],
    });

    await manifest.run({
      source: "jobindex",
      selectedSources: ["jobindex"],
      settings: {
        jobindexMaxJobsPerTerm: "70",
      },
      searchTerms: ["software engineer"],
      selectedCountry: "denmark",
    });

    expect(runJobindexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxJobsPerTerm: 70,
        selectedCountry: "denmark",
      }),
    );
  });

  it("does not call the runner outside Denmark", async () => {
    const { manifest } = await import("../src/manifest");
    const { runJobindex } = await import("../src/run");

    const result = await manifest.run({
      source: "jobindex",
      selectedSources: ["jobindex"],
      settings: {},
      searchTerms: ["software engineer"],
      selectedCountry: "germany",
    });

    expect(result).toEqual({ success: true, jobs: [] });
    expect(runJobindex).not.toHaveBeenCalled();
  });
  it("maps term and page progress events", async () => {
    const { manifest } = await import("../src/manifest");
    const { runJobindex } = await import("../src/run");
    const output: unknown[] = [];
    const base = { termIndex: 2, termTotal: 3, searchTerm: "engineer" };
    vi.mocked(runJobindex).mockImplementation(async (options) => {
      options?.onProgress?.({ ...base, type: "term_start" } as never);
      options?.onProgress?.({
        ...base,
        type: "page_complete",
        page: 4,
      } as never);
      options?.onProgress?.({
        ...base,
        type: "term_complete",
        jobsFoundTerm: 7,
      } as never);
      return { success: true, jobs: [] };
    });

    await manifest.run({
      source: "jobindex",
      selectedSources: ["jobindex"],
      settings: {},
      searchTerms: ["engineer"],
      selectedCountry: "denmark",
      onProgress: (event) => output.push(event),
    });

    expect(output).toStrictEqual([
      {
        phase: "list",
        termsProcessed: 1,
        termsTotal: 3,
        currentUrl: "engineer",
        detail: "Jobindex: term 2/3 (engineer)",
      },
      {
        phase: "list",
        termsProcessed: 1,
        termsTotal: 3,
        listPagesProcessed: 4,
        listPagesTotal: undefined,
        currentUrl: "engineer",
        detail: "Jobindex: page 4/? for engineer",
      },
      {
        phase: "list",
        termsProcessed: 2,
        termsTotal: 3,
        currentUrl: "engineer",
        jobPagesEnqueued: 7,
        jobPagesProcessed: 7,
        detail: "Jobindex: completed 2/3 (engineer) with 7 jobs",
      },
    ]);
  });
});
