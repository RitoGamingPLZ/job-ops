import { GREENHOUSE_FILTER_KEYS, parseGreenhouseUrl } from "@career-boards/greenhouse";
import { afterEach, expect, it, vi } from "vitest";
import { discoverGreenhouseFacets } from "./greenhouse";
import { facetDiscoverers } from "./index";

const careersUrl = "https://job-boards.greenhouse.io/airbnb?departments=old";
function mockBoard(departments: unknown = [], jobs: unknown = []) {
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/departments") ? { departments } : { jobs, meta: { total: 999 } },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

it("registers discovery, uses two unfiltered endpoints and skips offices", async () => {
  const fetch = mockBoard(
    [
      { name: "Engineering", jobs: [{ id: 1 }, { id: 2 }] },
      { name: "Empty", jobs: [] },
      { name: "Sales", jobs: [{ id: 3 }] },
    ],
    [
      {
        location: { name: "Toronto, Canada" },
        metadata: [
          { name: "Workplace Type", value: "Remote" },
          { name: "Private", value: "secret" },
        ],
      },
      {
        location: { name: "Toronto, Canada" },
        metadata: [
          { name: "Workplace Type", value: "Remote" },
          { name: "Workplace Type", value: "Remote" },
        ],
      },
      {
        location: { name: "London" },
        metadata: [{ name: "Workplace Type", value: "Hybrid" }],
      },
    ],
  );
  expect(facetDiscoverers.greenhouse).toBe(discoverGreenhouseFacets);
  const result = await discoverGreenhouseFacets({ careersUrl });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "https://boards-api.greenhouse.io/v1/boards/airbnb/departments",
    "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs",
  ]);
  expect(result).toEqual({
    unfilteredTotal: 3,
    params: [
      {
        key: "departments",
        multi: false,
        values: [
          { value: "Engineering", count: 2 },
          { value: "Sales", count: 1 },
        ],
      },
      {
        key: "location",
        multi: false,
        values: [
          { value: "Toronto, Canada", count: 2 },
          { value: "London", count: 1 },
        ],
      },
      {
        key: "workplace",
        multi: false,
        values: [
          { value: "Remote", count: 2 },
          { value: "Hybrid", count: 1 },
        ],
      },
    ],
  });
  for (const param of result.params) {
    expect(GREENHOUSE_FILTER_KEYS).toContain(param.key);
    const url = new URL(careersUrl);
    url.search = "";
    const value = param.values?.[0].value;
    if (!value) throw new Error("Expected a discovered value");
    url.searchParams.set(param.key, value);
    expect(
      new URL(parseGreenhouseUrl(url.href).canonicalCareersUrl).searchParams.get(param.key),
    ).toBe(value);
  }
});

it("caps every discovered key at 60 values, highest counts first", async () => {
  const entries = Array.from({ length: 65 }, (_, i) => `Value ${i}`);
  mockBoard(
    entries.map((name, i) => ({
      name,
      jobs: Array.from({ length: i + 1 }, () => ({})),
    })),
    entries.flatMap((name, i) =>
      Array.from({ length: i + 1 }, () => ({
        location: { name },
        metadata: [{ name: "Workplace Type", value: name }],
      })),
    ),
  );
  const result = await discoverGreenhouseFacets({ careersUrl });
  for (const param of result.params) {
    expect(param.values).toHaveLength(60);
    expect(param.values?.[0]).toEqual({ value: "Value 64", count: 65 });
    expect(param.values?.[59]).toEqual({ value: "Value 5", count: 6 });
  }
});

it("skips unusable values and departments with comma delimiters", async () => {
  mockBoard(
    [
      { name: "A,B", jobs: [{}] },
      { name: 42, jobs: [{}] },
      { name: " Engineering ", jobs: [{}] },
      { name: "x".repeat(121), jobs: [{}] },
    ],
    [
      { location: null, metadata: null },
      {
        location: { name: " " },
        metadata: [{ name: "Workplace Type", value: ["Remote"] }],
      },
      {},
    ],
  );
  expect(await discoverGreenhouseFacets({ careersUrl })).toEqual({
    unfilteredTotal: 3,
    params: [],
  });
});

it.each([
  "bad",
  "http://job-boards.greenhouse.io/airbnb",
  "https://evil.com/airbnb",
  "https://job-boards.greenhouse.io@evil.com/airbnb",
  "https://user@job-boards.greenhouse.io/airbnb",
  "https://job-boards.greenhouse.io:8443/airbnb",
])("rejects invalid URL %s without fetching", async (careersUrl) => {
  const fetch = mockBoard();
  await expect(discoverGreenhouseFacets({ careersUrl })).rejects.toMatchObject({
    status: 400,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  "https://boards.greenhouse.io/airbnb",
  "https://boards.greenhouse.io/embed/job_board?for=airbnb",
  "https://boards.greenhouse.io/embed/job_board",
  "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs",
  "https://boards.eu.greenhouse.io/airbnb",
  "https://job-boards.greenhouse.io/embed/job_board?for=airbnb",
  "https://job-boards.greenhouse.io/airbnb/jobs/123",
  "https://job-boards.greenhouse.io/airbnb/",
  "https://job-boards.greenhouse.io/Airbnb",
  "https://job-boards.greenhouse.io/",
])("rejects non-canonical board URL %s before discovery", async (careersUrl) => {
  const fetch = mockBoard();
  await expect(discoverGreenhouseFacets({ careersUrl })).rejects.toMatchObject({
    status: 422,
    code: "UNPROCESSABLE_ENTITY",
    message: "Use https://job-boards.greenhouse.io/<board> to suggest Greenhouse filters.",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [new Response("secret", { status: 500 }), "Greenhouse facets returned HTTP 500."],
  [new Response("secret"), "Greenhouse facets returned invalid JSON."],
  [
    new Response(JSON.stringify({ secret: "private" })),
    "Greenhouse facets returned invalid board data.",
  ],
])("sanitizes upstream errors %#", async (response, message) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => response.clone()),
  );
  await expect(discoverGreenhouseFacets({ careersUrl })).rejects.toMatchObject({
    status: 502,
    message,
  });
});

it.each(["AbortError", "TimeoutError"])("preserves %s during JSON reading", async (name) => {
  const error = new Error("interrupted");
  error.name = name;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(error) }),
  );
  await expect(discoverGreenhouseFacets({ careersUrl })).rejects.toBe(error);
});

it("honors cancellation and passes a bounded signal to both fetches", async () => {
  const fetch = mockBoard();
  const controller = new AbortController();
  await discoverGreenhouseFacets({ careersUrl, signal: controller.signal });
  const options = (fetch.mock.calls as unknown as [string, RequestInit][]).map(
    ([, options]) => options,
  );
  for (const option of options) {
    expect(option.redirect).toBe("manual");
    expect(option.signal?.aborted).toBe(false);
  }
  controller.abort();
  for (const option of options) expect(option.signal?.aborted).toBe(true);
  fetch.mockClear();
  await expect(
    discoverGreenhouseFacets({ careersUrl, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
