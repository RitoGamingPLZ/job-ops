import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/fetcher", () => ({ fetchFiveamsatSearchPage: vi.fn() }));
vi.mock("../src/parser", () => ({ parseFiveamsatServices: vi.fn() }));

const { fetchFiveamsatSearchPage } = await import("../src/fetcher");
const { parseFiveamsatServices } = await import("../src/parser");
const { runFiveamsat } = await import("../src/run");

const fetchMock = vi.mocked(fetchFiveamsatSearchPage);
const parseMock = vi.mocked(parseFiveamsatServices);

function job(sourceJobId: string | undefined, jobUrl: string) {
  return { source: "fiveamsat", sourceJobId, jobUrl } as never;
}

describe("runFiveamsat loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async ({ query }) => query);
  });

  it("dedupes across terms by sourceJobId ?? jobUrl and reports progress", async () => {
    parseMock.mockImplementation((html: string) =>
      html === "a"
        ? [job("1", "u1"), job("", "u2"), job("", "u3"), job(undefined, "u4")]
        : [job("1", "x"), job(undefined, "u4"), job("2", "u5")],
    );
    const events: unknown[] = [];

    const result = await runFiveamsat({
      searchTerms: ["a", "b"],
      onProgress: (event) => events.push(event),
    });

    expect(result).toEqual({
      success: true,
      jobs: [job("1", "u1"), job("", "u2"), job(undefined, "u4"), job("2", "u5")],
    });
    expect(fetchMock).toHaveBeenCalledWith({
      query: "a",
      fetchImpl: undefined,
    });
    expect(events).toEqual([
      { type: "term_start", termIndex: 1, termTotal: 2, searchTerm: "a" },
      {
        type: "term_complete",
        termIndex: 1,
        termTotal: 2,
        searchTerm: "a",
        jobsFoundTerm: 3,
      },
      { type: "term_start", termIndex: 2, termTotal: 2, searchTerm: "b" },
      {
        type: "term_complete",
        termIndex: 2,
        termTotal: 2,
        searchTerm: "b",
        jobsFoundTerm: 1,
      },
    ]);
  });

  it("uses the default term when none are given", async () => {
    parseMock.mockReturnValue([]);
    await runFiveamsat({ searchTerms: [] });
    expect(fetchMock).toHaveBeenCalledWith({
      query: "software engineer",
      fetchImpl: undefined,
    });
  });

  it("returns jobs collected so far on mid-collection cancellation", async () => {
    parseMock.mockReturnValue([job("1", "u1"), job("2", "u2"), job("3", "u3")]);
    let calls = 0;
    const events: unknown[] = [];

    const result = await runFiveamsat({
      searchTerms: ["a", "b"],
      shouldCancel: () => ++calls > 3,
      onProgress: (event) => events.push(event),
    });

    expect(result).toEqual({
      success: true,
      jobs: [job("1", "u1"), job("2", "u2")],
    });
    expect(calls).toBe(4);
    expect(events).toHaveLength(1);
  });

  it("discards earlier jobs when a later term fails", async () => {
    parseMock.mockReturnValue([job("1", "u1")]);
    fetchMock.mockResolvedValueOnce("a").mockRejectedValueOnce(new Error("boom"));
    expect(await runFiveamsat({ searchTerms: ["a", "b"] })).toEqual({
      success: false,
      jobs: [],
      error: "boom",
    });
  });

  it("uses string errors verbatim and a fallback for other values", async () => {
    fetchMock.mockRejectedValueOnce("plain");
    expect((await runFiveamsat({ searchTerms: ["a"] })).error).toBe("plain");
    fetchMock.mockRejectedValueOnce(42);
    expect((await runFiveamsat({ searchTerms: ["a"] })).error).toBe(
      "Unexpected error while running Khamsat extractor.",
    );
  });

  it("propagates progress callback exceptions as failures", async () => {
    parseMock.mockReturnValue([]);
    const result = await runFiveamsat({
      searchTerms: ["a"],
      onProgress: () => {
        throw new Error("cb");
      },
    });
    expect(result).toEqual({ success: false, jobs: [], error: "cb" });
  });
});
