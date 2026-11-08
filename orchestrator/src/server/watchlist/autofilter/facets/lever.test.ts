import { afterEach, expect, it, vi } from "vitest";
import { discoverLeverFacets } from "./lever";

afterEach(() => vi.unstubAllGlobals());
it("discovers counts, deduplicates jobs, and ignores existing URL filters", async () => {
  const job = {
    id: "1",
    categories: {
      team: "Engineering",
      department: "R&D",
      location: "Toronto",
      commitment: "Full-time",
    },
    workplaceType: "remote",
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify([job, job, { ...job, id: "2" }])),
    );
  vi.stubGlobal("fetch", fetch);
  const result = await discoverLeverFacets({
    careersUrl: "https://jobs.lever.co/spotify?team=old",
  });
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.lever.co/v0/postings/spotify?mode=json",
  );
  expect(result.unfilteredTotal).toBe(2);
  expect(result.params).toContainEqual({
    key: "department",
    multi: true,
    values: [{ value: "R&D", count: 2 }],
  });
});
it("uses the EU API and caps each facet at 60 sorted values", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify(
        Array.from({ length: 65 }, (_, i) => ({
          id: `${i}`,
          categories: { team: `Team ${i}` },
        })),
      ),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await discoverLeverFacets({
    careersUrl: "https://jobs.eu.lever.co/test",
  });
  expect(fetch.mock.calls[0][0]).toContain("https://api.eu.lever.co/");
  expect(result.params[0].values).toHaveLength(60);
});
it.each([
  "https://evil.com/test",
  "http://jobs.lever.co/test",
  "https://jobs.lever.co@evil.com/test",
  "https://jobs.lever.co/test/invalid/extra/path",
])("rejects unsafe URL %s before fetching", async (careersUrl) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(discoverLeverFacets({ careersUrl })).rejects.toMatchObject({
    status: 400,
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("does not expose upstream bodies", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("secret", { status: 500 })),
  );
  await expect(
    discoverLeverFacets({ careersUrl: "https://jobs.lever.co/test" }),
  ).rejects.toMatchObject({
    status: 502,
    message: "Lever facets returned HTTP 500.",
  });
});

it.each([
  null,
  42,
  {},
  [],
  "x".repeat(121),
  "   ",
])("skips malformed category/workplace values without losing other facets (%j)", async (badValue) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "1",
            categories: {
              team: "Engineering",
              department: badValue,
              location: badValue,
              commitment: badValue,
            },
            workplaceType: badValue,
          },
          {
            id: "2",
            categories: {
              department: "R&D",
              location: "Toronto",
              commitment: "Full-time",
            },
            workplaceType: "remote",
          },
        ]),
      ),
    ),
  );
  const result = await discoverLeverFacets({
    careersUrl: "https://jobs.lever.co/test",
  });
  expect(result.unfilteredTotal).toBe(2);
  expect(result.params).toEqual([
    { key: "location", multi: true, values: [{ value: "Toronto", count: 1 }] },
    { key: "team", multi: true, values: [{ value: "Engineering", count: 1 }] },
    { key: "department", multi: true, values: [{ value: "R&D", count: 1 }] },
    {
      key: "commitment",
      multi: true,
      values: [{ value: "Full-time", count: 1 }],
    },
    {
      key: "workplaceType",
      multi: true,
      values: [{ value: "remote", count: 1 }],
    },
  ]);
});

it("trims facet values before aggregating counts and enforcing length", async () => {
  const maxValue = "x".repeat(120);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "1",
            categories: { location: " Toronto ", team: ` ${maxValue} ` },
            workplaceType: " remote ",
          },
          {
            id: "2",
            categories: { location: "Toronto" },
            workplaceType: "remote",
          },
        ]),
      ),
    ),
  );
  const result = await discoverLeverFacets({
    careersUrl: "https://jobs.lever.co/test",
  });
  expect(result.params).toEqual([
    { key: "location", multi: true, values: [{ value: "Toronto", count: 2 }] },
    { key: "team", multi: true, values: [{ value: maxValue, count: 1 }] },
    {
      key: "workplaceType",
      multi: true,
      values: [{ value: "remote", count: 2 }],
    },
  ]);
});

it.each([
  "TimeoutError",
  "AbortError",
])("preserves %s while reading a response body", async (name) => {
  const error = new Error("body interrupted");
  error.name = name;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(error) }),
  );
  await expect(
    discoverLeverFacets({ careersUrl: "https://jobs.lever.co/test" }),
  ).rejects.toBe(error);
});
