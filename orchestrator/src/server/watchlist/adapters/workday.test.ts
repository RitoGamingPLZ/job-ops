import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workdayWatchlistAdapter as adapter } from "./workday";

const source: WatchlistSelectedSource = {
  id: "workday-test",
  catalogSourceId: null,
  label: "Acme",
  sourceType: "workday",
  careersUrl: "https://acme.wd5.myworkdayjobs.com/en-US/Careers",
  cxsJobsUrl: null,
  isCustom: true,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
};
afterEach(() => vi.unstubAllGlobals());
describe("workday watchlist cap", () => {
  it("paginates three CXS pages to return 60 jobs", async () => {
    const offsets: number[] = [];
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, options) => {
        const { offset, limit } = JSON.parse(options.body);
        offsets.push(offset);
        expect(limit).toBe(20);
        expect(options.signal).toBe(controller.signal);
        return new Response(
          JSON.stringify({
            total: 100,
            jobPostings: Array.from({ length: limit }, (_, i) => ({
              title: `Engineer ${offset + i}`,
              externalPath: `/job/London/Engineer_R${offset + i}`,
              locationsText: "London",
              postedOn: "Today",
            })),
          }),
        );
      }),
    );
    const result = await adapter.fetchJobs({
      source,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ total: 100, fetched: 60 });
    expect(result.jobs).toHaveLength(60);
    expect(offsets).toEqual([0, 20, 40]);
    expect(result.jobs.at(-1)?.title).toBe("Engineer 59");
  });
});
