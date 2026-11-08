import { beforeEach, expect, it, vi } from "vitest";
import { isAllowedByRobots, loadPage } from "../../careers-site/fetch";
import { discoverCareersSiteFacets } from "./careers-site";

vi.mock("../../careers-site/fetch", () => ({
  isAllowedByRobots: vi.fn(),
  loadPage: vi.fn(),
}));
const url = "https://careers.example.com/positions/";
function page(html: string) {
  vi.mocked(loadPage).mockResolvedValue({ url, status: 200, html });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isAllowedByRobots).mockResolvedValue(true);
});
it("strips filters, respects robots, and uses static loading with cancellation", async () => {
  page(
    '<select name="team" multiple><option value="">All</option><option value="engineering">Engineering</option></select>',
  );
  const signal = new AbortController().signal;
  expect(
    await discoverCareersSiteFacets({
      careersUrl: `${url}?team=old#hash`,
      signal,
    }),
  ).toEqual({
    countFiltered: expect.any(Function),
    unfilteredTotal: 0,
    params: [{ key: "team", multi: true, values: [{ value: "engineering" }] }],
  });
  expect(isAllowedByRobots).toHaveBeenCalledWith(url, { signal });
  expect(loadPage).toHaveBeenCalledWith(url, { render: false, signal });
});
it("discovers only same-path query facets and approximates total with deduplicated job links", async () => {
  page(`<a href="?_departments=engineering&_paged=2&utm_source=mail&gclid=x">Engineering</a>
    <a href="?_workplace_type=remote&offset=20&per_page=10&fbclid=y">Remote</a>
    <a href="https://evil.com/positions/?secret=x">Other host</a>
    <a href="/other?secret=y">Other path</a>
    <a href="/positions/123?gh_jid=123">Job</a><a href="/positions/123#apply">Same job</a>
    <a href="/positions/456/">Second job</a><a href="/about">About</a>`);
  expect(await discoverCareersSiteFacets({ careersUrl: url })).toEqual({
    countFiltered: expect.any(Function),
    unfilteredTotal: 2,
    params: [
      { key: "_departments", multi: false, values: [{ value: "engineering" }] },
      { key: "_workplace_type", multi: false, values: [{ value: "remote" }] },
    ],
  });
});
it("parses bounded FacetWP HTML choices and exact total without executing scripts", async () => {
  const data = {
    prefix: "_",
    preload_data: {
      settings: { pager: { total_rows: 205 } },
      facets: {
        departments:
          '<select multiple><option value="">All</option><option value="engineering" data-counter="54">Engineering</option><option value="legal" data-counter="4">Legal</option></select>',
        workplace_type:
          '<div data-value="remote" data-counter="30">Remote</div>',
        paged: '<select><option value="2">2</option></select>',
      },
    },
  };
  page(
    `<script>window.shouldNotRun = true; FWP_JSON = ${JSON.stringify(data)};</script>`,
  );
  expect(await discoverCareersSiteFacets({ careersUrl: url })).toEqual({
    countFiltered: expect.any(Function),
    unfilteredTotal: 205,
    params: [
      {
        key: "_departments",
        multi: false,
        values: [
          { value: "engineering", count: 54 },
          { value: "legal", count: 4 },
        ],
      },
      {
        key: "_workplace_type",
        multi: false,
        values: [{ value: "remote", count: 30 }],
      },
    ],
  });
});
it("caps and sorts choices, ignores disabled, empty and overlong values", async () => {
  page(
    `<select name="team"><option value="disabled" disabled>Disabled</option><option value="${"x".repeat(121)}">Long</option>${Array.from({ length: 65 }, (_, i) => `<option value="v${i}" data-counter="${i}">Value</option>`).join("")}</select>`,
  );
  const result = await discoverCareersSiteFacets({ careersUrl: url });
  expect(result.params[0].values).toHaveLength(60);
  expect(result.params[0].values?.[0]).toEqual({ value: "v64", count: 64 });
});
it.each([
  "FWP_JSON = {bad}",
  `FWP_JSON = {"padding":"${"x".repeat(100_000)}","preload_data":{"settings":{"pager":{"total_rows":99}}}}`,
  'FWP_JSON = {"prefix":"_","preload_data":{"settings":{"pager":{"total_rows":-1}}}}',
])("falls back on malformed, over-budget or invalid totals", async (script) => {
  page(
    `<a href="/positions/1">Job</a><select name="team"><option value="ok">OK</option></select><script>${script}</script>`,
  );
  const result = await discoverCareersSiteFacets({ careersUrl: url });
  expect(result.unfilteredTotal).toBe(1);
  expect(result.params[0].key).toBe("team");
});
it("does not load robots-disallowed pages", async () => {
  vi.mocked(isAllowedByRobots).mockResolvedValue(false);
  await expect(
    discoverCareersSiteFacets({ careersUrl: url }),
  ).rejects.toMatchObject({ name: "SiteBlockedError" });
  expect(loadPage).not.toHaveBeenCalled();
});
it.each([
  "invalid",
  "http://careers.example.com/",
  "https://user:pass@careers.example.com/",
])("rejects invalid input %s before network", async (careersUrl) => {
  await expect(discoverCareersSiteFacets({ careersUrl })).rejects.toMatchObject(
    { status: 400 },
  );
  expect(isAllowedByRobots).not.toHaveBeenCalled();
});
it("preserves cancellation and safe upstream failures", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    discoverCareersSiteFacets({ careersUrl: url, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(isAllowedByRobots).not.toHaveBeenCalled();
  vi.mocked(loadPage).mockResolvedValue({
    url,
    status: 500,
    html: "private upstream body",
  });
  await expect(
    discoverCareersSiteFacets({ careersUrl: url }),
  ).rejects.toMatchObject({
    status: 502,
    message: "Careers facets returned HTTP 500.",
  });
});
it("has no cross-call or cross-site facet state", async () => {
  page('<select name="private"><option value="first">First</option></select>');
  await discoverCareersSiteFacets({ careersUrl: url });
  vi.mocked(loadPage).mockResolvedValue({
    url: "https://other.example.com/jobs/",
    status: 200,
    html: "",
  });
  expect(
    await discoverCareersSiteFacets({
      careersUrl: "https://other.example.com/jobs/",
    }),
  ).toEqual({
    countFiltered: expect.any(Function),
    unfilteredTotal: 0,
    params: [],
  });
});

it("bounds the prompt to 12 keys with at most 60 values each", async () => {
  page(
    Array.from(
      { length: 20 },
      (_, key) =>
        `<select name="key${key}">${Array.from(
          { length: 80 },
          (_, value) => `<option value="v${value}">Value</option>`,
        ).join("")}</select>`,
    ).join(""),
  );
  const result = await discoverCareersSiteFacets({ careersUrl: url });
  expect(result.params).toHaveLength(12);
  expect(result.params.every((param) => param.values?.length === 60)).toBe(
    true,
  );
});
it.each([
  true,
  false,
])("counts the built filtered listing using the same method (FacetWP=%s)", async (facetwp) => {
  const html = (count: number) =>
    facetwp
      ? `<script>FWP_JSON = ${JSON.stringify({ preload_data: { settings: { pager: { total_rows: count } } } })};</script>`
      : Array.from(
          { length: count },
          (_, i) => `<a href="/positions/${i}">Job</a>`,
        ).join("");
  page(html(100));
  const facets = await discoverCareersSiteFacets({ careersUrl: url });
  page(html(25));
  const signal = new AbortController().signal;
  expect(
    await facets.countFiltered?.({
      careersUrl: `${url}?team=engineering`,
      signal,
    }),
  ).toBe(25);
  expect(facets.unfilteredTotal).toBe(100);
  expect(isAllowedByRobots).toHaveBeenLastCalledWith(
    `${url}?team=engineering`,
    { signal },
  );
  expect(loadPage).toHaveBeenLastCalledWith(`${url}?team=engineering`, {
    render: false,
    signal,
  });
});
