import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRemoteCareersSiteRunner } from "../../careers-site/remote";
import { SiteBlockedError } from "../../careers-site/types";
import { discoverCareersSiteFacets } from "./careers-site";

// The Worker bundle stubs out jsdom and Playwright, so facet parsing must go to the container.
vi.mock("../../runtime", () => ({ isWorkerdRuntime: () => true }));
vi.mock("../../careers-site/fetch", () => ({
  isAllowedByRobots: vi.fn(() => {
    throw new Error("must not fetch in the Worker");
  }),
  loadPage: vi.fn(() => {
    throw new Error("must not fetch in the Worker");
  }),
}));

const careersUrl = "https://careers.example.com/positions/";
const facets = {
  unfilteredTotal: 7,
  params: [{ key: "team", multi: false, values: [{ value: "engineering" }] }],
};

describe("careers-site facets in the Cloudflare Worker", () => {
  const remote = { facets: vi.fn(), run: vi.fn(), learn: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    setRemoteCareersSiteRunner(remote);
  });
  afterEach(() => setRemoteCareersSiteRunner(null));

  it("reads facets in the container and counts a filtered listing there too", async () => {
    remote.facets.mockResolvedValueOnce({ kind: "facets", facets });
    const signal = new AbortController().signal;
    const result = await discoverCareersSiteFacets({ careersUrl, signal });
    expect(result).toEqual({ ...facets, countFiltered: expect.any(Function) });
    expect(remote.facets).toHaveBeenLastCalledWith({ careersUrl, filtered: false, signal });

    remote.facets.mockResolvedValueOnce({
      kind: "facets",
      facets: { ...facets, unfilteredTotal: 3 },
    });
    expect(await result.countFiltered?.({ careersUrl: `${careersUrl}?team=engineering` })).toBe(3);
    expect(remote.facets).toHaveBeenLastCalledWith({
      careersUrl: `${careersUrl}?team=engineering`,
      filtered: true,
      signal: undefined,
    });
  });

  it("maps container outcomes onto the errors the local path throws", async () => {
    remote.facets.mockResolvedValueOnce({ kind: "blocked", reason: "robots.txt" });
    await expect(discoverCareersSiteFacets({ careersUrl })).rejects.toBeInstanceOf(
      SiteBlockedError,
    );

    remote.facets.mockResolvedValueOnce({ kind: "unavailable", message: "starting" });
    await expect(discoverCareersSiteFacets({ careersUrl })).rejects.toMatchObject({
      status: 503,
      message: "starting",
    });

    remote.facets.mockResolvedValueOnce({ kind: "failed", message: "HTTP 404" });
    await expect(discoverCareersSiteFacets({ careersUrl })).rejects.toMatchObject({
      status: 502,
      message: "HTTP 404",
    });
  });

  it("degrades to a 503 rather than crashing when no careers-site browser is registered", async () => {
    setRemoteCareersSiteRunner(null);
    await expect(discoverCareersSiteFacets({ careersUrl })).rejects.toMatchObject({ status: 503 });
    setRemoteCareersSiteRunner({ run: vi.fn(), learn: vi.fn() });
    await expect(discoverCareersSiteFacets({ careersUrl })).rejects.toMatchObject({ status: 503 });
  });
});
