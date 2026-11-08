import { afterEach, expect, it, vi } from "vitest";
import { discoverGoogleFacets } from "./google";
import { facetDiscoverers } from "./index";

const careersUrl =
  "https://www.google.com/about/careers/applications/jobs/results/";
const page = (data: unknown) =>
  `<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;

afterEach(() => vi.unstubAllGlobals());

it("fetches the unfiltered board once without paging and returns verified enum values", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(page([[], null, 3185])));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const result = await facetDiscoverers.google?.({
    careersUrl: `${careersUrl}?q=engineer&location=Toronto&target_level=EARLY&degree=BACHELORS&employment_type=FULL_TIME&page=3&sort_by=date#fragment`,
    signal: controller.signal,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(careersUrl);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  expect(result).toEqual({
    unfilteredTotal: 3185,
    params: [
      { key: "q", multi: false, freeText: true },
      { key: "location", multi: true, freeText: true },
      {
        key: "target_level",
        multi: true,
        values: [
          "EARLY",
          "MID",
          "ADVANCED",
          "DIRECTOR_PLUS",
          "INTERN_AND_APPRENTICE",
        ].map((value) => ({ value })),
      },
      {
        key: "employment_type",
        multi: true,
        values: ["FULL_TIME", "PART_TIME", "TEMPORARY", "INTERN"].map(
          (value) => ({ value }),
        ),
      },
      {
        key: "degree",
        multi: true,
        values: [
          "PURSUING_DEGREE",
          "ASSOCIATE",
          "BACHELORS",
          "MASTERS",
          "DOCTORATE",
        ].map((value) => ({ value })),
      },
    ],
  });
  controller.abort();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it.each([
  "https://evil.com/about/careers/applications/jobs/results/",
  "http://www.google.com/about/careers/applications/jobs/results/",
  "https://www.google.com:443/about/careers/applications/jobs/results/",
  "https://user@www.google.com/about/careers/applications/jobs/results/",
  `${careersUrl}123-engineer`,
  "not a URL",
])("rejects unsafe or unsupported URLs before fetching: %s", async (value) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    discoverGoogleFacets({ careersUrl: value }),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  0, 10000,
])("uses the match total rather than the listed job count (%s)", async (total) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(page([null, null, total]))),
  );
  expect((await discoverGoogleFacets({ careersUrl })).unfilteredTotal).toBe(
    total,
  );
});

it.each(
  [[], [[], null, -1], [[], null, 1.5], [[], null, "3"], [[], null, null]].map(
    (data) => ({ data }),
  ),
)("rejects malformed totals (%j)", async ({ data }) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(page(data))));
  await expect(discoverGoogleFacets({ careersUrl })).rejects.toMatchObject({
    status: 502,
  });
});

it.each([
  "<html>secret</html>",
  "<script>AF_initDataCallback({key:'ds:1',data:[secret]});</script>",
])("rejects changed callback structures without exposing payloads", async (html) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));
  await expect(discoverGoogleFacets({ careersUrl })).rejects.toMatchObject({
    status: 502,
    message: expect.not.stringContaining("secret"),
  });
});

it.each([
  429, 500,
])("does not retry HTTP %s or expose response bodies", async (status) => {
  const fetch = vi.fn().mockResolvedValue(new Response("secret", { status }));
  vi.stubGlobal("fetch", fetch);
  await expect(discoverGoogleFacets({ careersUrl })).rejects.toMatchObject({
    status: 502,
    message: `Google facets returned HTTP ${status}.`,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("honors cancellation before fetching", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort();
  await expect(
    discoverGoogleFacets({ careersUrl, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  "AbortError",
  "TimeoutError",
])("preserves %s during body reads", async (name) => {
  const error = new Error("interrupted");
  error.name = name;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, text: vi.fn().mockRejectedValue(error) }),
  );
  await expect(discoverGoogleFacets({ careersUrl })).rejects.toBe(error);
});
