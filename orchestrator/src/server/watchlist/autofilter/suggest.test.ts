import { getTenantId, runWithRequestContext } from "@infra/request-context";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  fetchJobs: vi.fn(),
  normalize: vi.fn(),
  callJson: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("./facets", () => ({ facetDiscoverers: { lever: mocks.discover } }));
vi.mock("@server/watchlist/adapters", () => ({
  getWatchlistSourceAdapter: () => ({
    fetchJobs: mocks.fetchJobs,
    normalizeCustomSelection: mocks.normalize,
  }),
}));
vi.mock("@server/watchlist/results", () => ({
  withWatchlistSourceTimeout: (fn: (signal: AbortSignal) => unknown) =>
    fn(new AbortController().signal),
}));
vi.mock("@server/repositories/settings", () => ({
  getAllSettings: mocks.settings,
}));
vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: async () => ({ callJson: mocks.callJson }),
  resolveLlmModel: async () => "test",
}));

import { suggestFilters } from "./suggest";

const input = {
  sourceType: "lever",
  careersUrl: "https://jobs.lever.co/test?team=old",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.discover.mockResolvedValue({
    unfilteredTotal: 100,
    params: [
      {
        key: "team",
        multi: false,
        values: [
          { value: "Engineering", count: 40 },
          { value: "Other", count: 10 },
        ],
      },
      {
        key: "location",
        multi: true,
        values: [{ value: "Toronto", count: 5 }],
      },
    ],
  });
  mocks.settings.mockResolvedValue({
    searchTerms: '["software developer"]',
    jobspyCountryIndeed: "Canada",
    workplaceTypes: '["remote"]',
  });
  mocks.normalize.mockImplementation(async (value) => value);
  mocks.fetchJobs.mockResolvedValue({
    total: 5,
    jobs: [{ title: "Engineer" }],
  });
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      params: [{ key: "team", values: ["Engineering"] }],
      rationale: "Engineering roles",
    },
  });
});
it("drops unknown keys/values, deduplicates and honors single selection", async () => {
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      params: [
        { key: "team", values: ["made up", "Engineering", "Other"] },
        { key: "host", values: ["evil.com"] },
      ],
      rationale: "Broad filters",
    },
  });
  const result = await suggestFilters(input);
  expect(result.suggestedUrl).toBe(
    "https://jobs.lever.co/test?team=Engineering",
  );
  expect(result.totals).toEqual({ filtered: 5, unfiltered: 100 });
  expect(result.sampleTitles).toEqual(["Engineer"]);
});
it("retries zero results by dropping the least populated facet, without another LLM call", async () => {
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      params: [
        { key: "team", values: ["Engineering"] },
        { key: "location", values: ["Toronto"] },
      ],
      rationale: "Match",
    },
  });
  mocks.fetchJobs.mockResolvedValueOnce({ total: 0, jobs: [] });
  const result = await suggestFilters(input);
  expect(result.params).toEqual([{ key: "team", values: ["Engineering"] }]);
  expect(mocks.callJson).toHaveBeenCalledTimes(1);
  expect(mocks.fetchJobs).toHaveBeenCalledTimes(2);
});
it.each([0, 100])("rejects non-narrowing total %i", async (total) => {
  mocks.fetchJobs.mockResolvedValue({ total, jobs: [] });
  await expect(suggestFilters(input)).rejects.toMatchObject({
    status: 422,
    details: { totals: { filtered: total, unfiltered: 100 } },
  });
});
it("rejects unsupported types without LLM", async () => {
  await expect(
    suggestFilters({ ...input, sourceType: "meta" }),
  ).rejects.toMatchObject({ status: 422 });
  expect(mocks.callJson).not.toHaveBeenCalled();
});
it.each([
  { params: [], rationale: "None" },
  { params: [{ key: "unknown", values: ["bad"] }], rationale: "None" },
  { params: "bad" },
])("rejects unusable LLM output", async (data) => {
  mocks.callJson.mockResolvedValue({ success: true, data });
  await expect(suggestFilters(input)).rejects.toMatchObject({ status: 422 });
  expect(mocks.fetchJobs).not.toHaveBeenCalled();
});
it.each([
  "https://evil.com/test?team=Engineering",
  "https://jobs.lever.co/test",
  "https://jobs.lever.co/test?team=Other",
])("rejects normalization mismatch %s", async (careersUrl) => {
  mocks.normalize.mockResolvedValue({ label: "Test", careersUrl });
  await expect(suggestFilters(input)).rejects.toMatchObject({ status: 422 });
  expect(mocks.fetchJobs).not.toHaveBeenCalled();
});
it("allows Google-like normalization to add sort_by while preserving picked filters", async () => {
  mocks.normalize.mockImplementation(async (value) => {
    const url = new URL(value.careersUrl);
    url.searchParams.set("sort_by", "date");
    return { ...value, careersUrl: url.href };
  });
  const result = await suggestFilters(input);
  expect(result.suggestedUrl).toBe(
    "https://jobs.lever.co/test?team=Engineering&sort_by=date",
  );
  expect(result.params).toEqual([{ key: "team", values: ["Engineering"] }]);
  expect(mocks.fetchJobs).toHaveBeenCalledWith(
    expect.objectContaining({
      source: expect.objectContaining({ careersUrl: result.suggestedUrl }),
    }),
  );
});
it("reads each tenant's current intent without caching or sending unrelated settings", async () => {
  mocks.settings.mockImplementation(async () => ({
    searchTerms: JSON.stringify([getTenantId()]),
    jobspyCountryIndeed: "Canada",
    apiKey: "private",
  }));
  await runWithRequestContext({ tenantId: "tenant-a" }, () =>
    suggestFilters(input),
  );
  await runWithRequestContext({ tenantId: "tenant-b" }, () =>
    suggestFilters(input),
  );
  const prompts = mocks.callJson.mock.calls.map(([arg]) =>
    JSON.parse(arg.messages[1].content),
  );
  expect(prompts[0].intent.titles).toEqual(["tenant-a"]);
  expect(prompts[1].intent.titles).toEqual(["tenant-b"]);
  expect(JSON.stringify(prompts)).not.toContain("private");
});
it("maps LLM failures without leaking raw errors", async () => {
  mocks.callJson.mockResolvedValue({
    success: false,
    error: "LLM API error: 429 secret body",
  });
  await expect(suggestFilters(input)).rejects.toMatchObject({
    status: 502,
    message: "LLM request failed (HTTP 429)",
  });
});

it("stops after one empty-result retry and reports both totals", async () => {
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      params: [
        { key: "team", values: ["Engineering"] },
        { key: "location", values: ["Toronto"] },
      ],
      rationale: "Match",
    },
  });
  mocks.fetchJobs.mockResolvedValue({ total: 0, jobs: [] });
  await expect(suggestFilters(input)).rejects.toMatchObject({
    status: 422,
    details: { totals: { filtered: 0, unfiltered: 100 } },
  });
  expect(mocks.fetchJobs).toHaveBeenCalledTimes(2);
  expect(mocks.callJson).toHaveBeenCalledTimes(1);
});

it("allows free text only on declared freeText facets and drops the last such param on retry", async () => {
  mocks.discover.mockResolvedValue({
    unfilteredTotal: 100,
    params: [
      { key: "q", multi: false, freeText: true },
      { key: "location", multi: false, freeText: true },
    ],
  });
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      params: [
        { key: "q", values: ["software engineer"] },
        { key: "location", values: ["Canada"] },
      ],
      rationale: "Match",
    },
  });
  mocks.fetchJobs.mockResolvedValueOnce({ total: 0, jobs: [] });
  const result = await suggestFilters(input);
  expect(result.params).toEqual([{ key: "q", values: ["software engineer"] }]);
});

it("trims LLM picks and discovered values before matching and deduplicating", async () => {
  mocks.discover.mockResolvedValue({
    unfilteredTotal: 100,
    params: [
      {
        key: "location",
        multi: true,
        values: [{ value: " Toronto ", count: 5 }],
      },
      { key: "q", multi: false, freeText: true },
    ],
  });
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      params: [
        {
          key: " location ",
          values: [" Toronto ", "Toronto", "  ", "unknown"],
        },
        { key: "q", values: [" software engineer "] },
      ],
      rationale: "Match",
    },
  });
  const result = await suggestFilters(input);
  expect(result.params).toEqual([
    { key: "location", values: ["Toronto"] },
    { key: "q", values: ["software engineer"] },
  ]);
  expect(result.suggestedUrl).toBe(
    "https://jobs.lever.co/test?location=Toronto&q=software+engineer",
  );
});

it.each([
  ["LLM API key not configured", "LLM API key not configured"],
  [
    "Request timed out: private upstream text",
    "Filter suggestion request timed out or was aborted",
  ],
  [
    "The operation was aborted",
    "Filter suggestion request timed out or was aborted",
  ],
  [
    "TimeoutError: private upstream text",
    "Filter suggestion request timed out or was aborted",
  ],
])("maps LLM unavailability to 503 (%s)", async (error, message) => {
  mocks.callJson.mockResolvedValue({ success: false, error });
  await expect(suggestFilters(input)).rejects.toMatchObject({
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    message,
  });
  expect(mocks.fetchJobs).not.toHaveBeenCalled();
});
