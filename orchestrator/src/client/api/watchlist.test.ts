import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchApi } from "./core";
import { suggestWatchlistFilters } from "./watchlist";

vi.mock("./core", () => ({ fetchApi: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("suggestWatchlistFilters", () => {
  it("posts the source to the existing authenticated API helper", async () => {
    const input = {
      sourceType: "lever",
      careersUrl: "https://jobs.lever.co/spotify",
      label: "Spotify",
    };
    const result = {
      suggestedUrl: `${input.careersUrl}?team=Engineering`,
      params: [],
      rationale: "Matches your titles",
      totals: { filtered: 4, unfiltered: 85 },
      sampleTitles: ["Software Engineer"],
    };
    vi.mocked(fetchApi).mockResolvedValue(result);
    await expect(suggestWatchlistFilters(input)).resolves.toEqual(result);
    expect(fetchApi).toHaveBeenCalledWith("/watchlist/suggest-filters", {
      method: "POST",
      body: JSON.stringify(input),
    });
  });
});
