import { afterEach, expect, it, vi } from "vitest";
import { discoverEightfoldFacets } from "./eightfold";

const netflix = "https://explore.jobs.netflix.net/careers";
const microsoft = "https://apply.careers.microsoft.com/careers";
function mockResponse(data: unknown) {
  const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
  vi.stubGlobal("fetch", mock);
  return mock;
}
afterEach(() => vi.unstubAllGlobals());

it("discovers Netflix bare facets and counts without forwarding old filters", async () => {
  const fetch = mockResponse({
    count: 394,
    facets: {
      Teams: { Engineering: 78, Games: 7 },
      "Work Type": { remote: 84, onsite: 310 },
      Region: { ucan: 263 },
      locations: { Remote: 999999 },
      domain: { evil: 99 },
    },
  });
  const result = await discoverEightfoldFacets({
    careersUrl: `${netflix}?Teams=old&query=old&domain=evil`,
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&num=1",
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  expect(result).toEqual({
    unfilteredTotal: 394,
    params: [
      { key: "query", multi: false, freeText: true },
      { key: "location", multi: false, freeText: true },
      {
        key: "Teams",
        multi: true,
        values: [
          { value: "Engineering", count: 78 },
          { value: "Games", count: 7 },
        ],
      },
      {
        key: "Work Type",
        multi: true,
        values: [
          { value: "onsite", count: 310 },
          { value: "remote", count: 84 },
        ],
      },
      { key: "Region", multi: true, values: [{ value: "ucan", count: 263 }] },
    ],
  });
});

it("reads PCSX smart/all filters using option values, deduplicates and caps", async () => {
  const fetch = mockResponse({
    status: 200,
    data: {
      count: 2340,
      filterDef: {
        smartFilters: [
          {
            type: "multi_select",
            filterName: "profession",
            options: [
              { label: "SOFTWARE ENGINEERING", value: "software engineering" },
              { value: "software engineering" },
              { value: null },
              { value: " " },
            ],
          },
        ],
        allFilters: [
          {
            type: "multi_select",
            filterName: "profession",
            options: [{ value: "duplicate definition" }],
          },
          {
            type: "single_select",
            filterName: "seniority",
            options: Array.from({ length: 65 }, (_, i) => ({
              value: `Level ${i}`,
            })),
          },
          {
            type: "multi_select",
            filterName: "bad key",
            options: [{ value: "x" }],
          },
        ],
      },
    },
  });
  const result = await discoverEightfoldFacets({
    careersUrl: `${microsoft}?query=old`,
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&start=0",
  );
  expect(result.unfilteredTotal).toBe(2340);
  expect(result.params[2]).toEqual({
    key: "filter_profession",
    multi: true,
    values: [{ value: "software engineering" }],
  });
  expect(result.params[3].values).toHaveLength(60);
  expect(result.params[3].multi).toBe(false);
  expect(result.params).toHaveLength(4);
});

it("sorts and caps valid Netflix values while skipping malformed entries", async () => {
  mockResponse({
    count: 100,
    facets: {
      Teams: {
        ...Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`Team ${i}`, i])),
        bad: -1,
        invalid: "2",
        ["x".repeat(121)]: 99,
      },
      Region: null,
    },
  });
  const result = await discoverEightfoldFacets({ careersUrl: netflix });
  expect(result.params[2].values).toHaveLength(60);
  expect(result.params[2].values?.[0]).toEqual({ value: "Team 64", count: 64 });
  expect(result.params).toHaveLength(3);
});

it.each([netflix, microsoft])("supports freeText when %s has no facet data", async (careersUrl) => {
  mockResponse(careersUrl === microsoft ? { status: 200, data: { count: 10 } } : { count: 10 });
  expect((await discoverEightfoldFacets({ careersUrl })).params).toEqual([
    { key: "query", multi: false, freeText: true },
    { key: "location", multi: false, freeText: true },
  ]);
});

it.each(["https://evil.test/careers", "https://explore.jobs.netflix.net/api/apply/v2/jobs"])(
  "rejects unsafe URL %s before fetch",
  async (careersUrl) => {
    const fetch = mockResponse({});
    await expect(discoverEightfoldFacets({ careersUrl })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("does not retry a rate limit or expose its body", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("secret", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  await expect(discoverEightfoldFacets({ careersUrl: microsoft })).rejects.toMatchObject({
    status: 502,
    message: "Eightfold facets returned HTTP 429.",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  {},
  { count: -1 },
  { count: "12" },
  { status: 403, data: { count: 1 }, error: "secret" },
])("rejects invalid search data %j", async (data) => {
  mockResponse(data);
  await expect(discoverEightfoldFacets({ careersUrl: microsoft })).rejects.toMatchObject({
    status: 502,
  });
});

it("handles invalid JSON safely", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret")));
  await expect(discoverEightfoldFacets({ careersUrl: netflix })).rejects.toMatchObject({
    message: "Eightfold facets returned invalid JSON.",
  });
});

it("honors cancellation before fetch", async () => {
  const fetch = mockResponse({});
  const controller = new AbortController();
  controller.abort();
  await expect(
    discoverEightfoldFacets({ careersUrl: netflix, signal: controller.signal }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["TimeoutError", "AbortError"])("preserves %s during body reads", async (name) => {
  const error = Object.assign(new Error("interrupted"), { name });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(error) }),
  );
  await expect(discoverEightfoldFacets({ careersUrl: netflix })).rejects.toBe(error);
});
