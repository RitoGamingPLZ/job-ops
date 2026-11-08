import type { WatchlistSelectedSource } from "@shared/types";
import { afterEach, expect, it, vi } from "vitest";
import { greenhouseWatchlistAdapter as adapter } from "./greenhouse";

const base = "https://job-boards.greenhouse.io/airbnb";
const source: WatchlistSelectedSource = {
  id: "selected-gh",
  catalogSourceId: null,
  label: "Airbnb",
  sourceType: "greenhouse",
  careersUrl: base,
  cxsJobsUrl: null,
  isCustom: true,
  sortOrder: 0,
  createdAt: "2026-11-08",
  updatedAt: "2026-11-08",
};
afterEach(() => vi.unstubAllGlobals());
function row(
  id: number,
  department = "Software Engineering",
  workplace = "Remote",
) {
  return {
    id,
    title: `Engineer ${id}`,
    first_published: new Date(1700000000000 + id).toISOString(),
    location: { name: "London, UK" },
    departments: [{ name: department }],
    offices: [{ name: "London" }],
    metadata: [{ name: "Workplace Type", value: workplace }],
  };
}
it("keeps normalized filters in source identity and validates filtered custom URLs", async () => {
  const url = `${base}?workplace=Remote&departments=Technical%20Program%20Management,Software%20Engineering&unknown=drop`;
  const mock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ name: "Airbnb" })));
  vi.stubGlobal("fetch", mock);
  const normalized = await adapter.normalizeCustomSelection({
    careersUrl: url,
    label: null,
  });
  const parsed = adapter.parseCatalogSources([
    { label: "Airbnb", greenhouseUrl: url },
  ])[0];
  expect(normalized.careersUrl).toBe(parsed.careersUrl);
  expect(parsed.id).toBe(
    `greenhouse:airbnb${new URL(parsed.careersUrl).search}`,
  );
  expect(parsed.careersUrl).not.toContain("unknown");
  expect(
    adapter.parseCatalogSources([{ label: "Airbnb", greenhouseUrl: base }])[0]
      .id,
  ).toBe("greenhouse:airbnb");
  expect(
    adapter.hydrateSelectedSource({ ...source, careersUrl: url }).careersUrl,
  ).toBe(parsed.careersUrl);
  expect(mock).toHaveBeenCalledTimes(1);
});
it("filters exact departments and workplace before sorting/capping to retain all 51 matches", async () => {
  const rows = [
    ...Array.from({ length: 70 }, (_, i) =>
      row(100 + i, "Engineering & Technology"),
    ),
    ...Array.from({ length: 49 }, (_, i) => row(i)),
    row(49, "Technical Program Management"),
    row(50, "Technical Program Management"),
    row(200, "Software Engineering", "Hybrid"),
  ];
  const mock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ jobs: rows, meta: { total: rows.length } }),
      ),
    );
  vi.stubGlobal("fetch", mock);
  const result = await adapter.fetchJobs({
    source: {
      ...source,
      careersUrl: `${base}?departments=Software%20Engineering,Technical%20Program%20Management&workplace=Remote`,
    },
  });
  expect(result).toMatchObject({ total: 51, fetched: 51 });
  expect(result.jobs[0].sourceJobId).toBe("50");
  expect(result.jobs[50].sourceJobId).toBe("0");
  expect(mock.mock.calls[0][0]).toBe(
    "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=true",
  );
});
it.each([
  "",
  "?workplace=Remote",
])("caps both unfiltered and filtered lists at 60: %s", async (query) => {
  const mock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ jobs: Array.from({ length: 110 }, (_, i) => row(i)) }),
      ),
    );
  vi.stubGlobal("fetch", mock);
  const result = await adapter.fetchJobs({
    source: { ...source, careersUrl: base + query },
  });
  expect(result).toMatchObject({ total: 110, fetched: 60 });
  expect(result.jobs[0].sourceJobId).toBe("109");
  expect(result.jobs[59].sourceJobId).toBe("50");
  expect(mock.mock.calls[0][0]).not.toContain("content=true");
});
it("ANDs office and case-insensitive location filters and excludes missing metadata", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            row(1),
            { ...row(2), offices: [] },
            { ...row(3), location: { name: "New York" } },
            { ...row(4), metadata: [] },
          ],
        }),
      ),
    ),
  );
  const result = await adapter.fetchJobs({
    source: {
      ...source,
      careersUrl: `${base}?offices=London,Paris&location=lOnDoN&workplace=Remote`,
    },
  });
  expect(result.jobs.map((job) => job.sourceJobId)).toEqual(["1"]);
});
