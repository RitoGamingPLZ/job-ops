import {
  __resetAnalyticsTestState,
  bucketQueryLength,
  getAnalyticsRequestHeaders,
  identifyAnalyticsUser,
  trackEvent,
  trackProductEvent,
} from "./analytics";

describe("analytics", () => {
  const track = vi.fn();
  const identify = vi.fn();
  const op = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00Z"));
    track.mockReset();
    identify.mockReset();
    op.mockReset();
    __resetAnalyticsTestState();
    window.localStorage.clear();
    window.sessionStorage.clear();
    (globalThis as any).__APP_VERSION__ = "abc1234-dev";
    Object.defineProperty(window, "umami", {
      configurable: true,
      value: { track, identify },
    });
    Object.defineProperty(window, "op", {
      configurable: true,
      value: op,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes identical product events within the dedupe window", () => {
    trackProductEvent("jobs_search_composer_opened", { mode: "automatic" });
    trackProductEvent("jobs_search_composer_opened", { mode: "automatic" });

    expect(track).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3_001);
    trackProductEvent("jobs_search_composer_opened", { mode: "automatic" });

    expect(track).toHaveBeenCalledTimes(2);
  });

  it("attaches stable analytics metadata to every event", () => {
    trackEvent("star_repo_click", { location: "demo_mode_banner" });
    trackProductEvent("jobs_search_composer_opened", { mode: "manual" });

    expect(track).toHaveBeenCalledTimes(2);

    const firstPayload = track.mock.calls[0][1] as Record<string, unknown>;
    const secondPayload = track.mock.calls[1][1] as Record<string, unknown>;
    const storedId = window.localStorage.getItem("jobops.analytics.user_id.v1");

    expect(typeof firstPayload.analytics_user_id).toBe("string");
    expect(firstPayload.analytics_user_id).toBeTruthy();
    expect(secondPayload.analytics_user_id).toBe(firstPayload.analytics_user_id);
    expect(storedId).toBe(firstPayload.analytics_user_id);
    expect(firstPayload.app_version).toBe("abc1234-dev");
    expect(secondPayload.app_version).toBe("abc1234-dev");

    expect(op).toHaveBeenNthCalledWith(1, "track", "star_repo_click", firstPayload);
    expect(op).toHaveBeenNthCalledWith(2, "track", "jobs_search_composer_opened", secondPayload);
  });

  it("drops disallowed keys and non-primitive payload values", () => {
    trackProductEvent("jobs_pipeline_run_started", {
      mode: "automatic",
      source_count: 2,
      top_n: 10,
      min_suitability_score: 50,
      country: "uk",
      has_city_locations: true,
      search_terms_count: 3,
      query: "software engineer",
      destination_url: "https://example.com",
      extra: { nested: true },
    } as any);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("jobs_pipeline_run_started", {
      mode: "automatic",
      source_count: 2,
      top_n: 10,
      min_suitability_score: 50,
      country: "uk",
      has_city_locations: true,
      search_terms_count: 3,
      analytics_user_id: expect.any(String),
      app_version: "abc1234-dev",
    });
  });

  it.each([
    [{}, {}],
    [{ tOkEn: "private", nested: {}, list: [], absent: undefined }, {}],
    [
      { label: "hello", count: 0, enabled: false, empty: null },
      { label: "hello", count: 0, enabled: false, empty: null },
    ],
    [{ QueryText: "private", statusCODE: 1, safe: "retained" }, { safe: "retained" }],
    [
      { count: Number.NaN, high: Number.POSITIVE_INFINITY },
      { count: Number.NaN, high: Number.POSITIVE_INFINITY },
    ],
  ])("preserves primitive sanitization for %j", (input, expected) => {
    trackProductEvent("jobs_pipeline_run_started", input as any);
    expect(track).toHaveBeenCalledWith("jobs_pipeline_run_started", {
      ...expected,
      analytics_user_id: expect.any(String),
      app_version: "abc1234-dev",
    });
  });

  it("buckets query lengths without sending raw query text", () => {
    expect(bucketQueryLength("")).toBe("0");
    expect(bucketQueryLength("abc")).toBe("1_3");
    expect(bucketQueryLength("hello world")).toBe("11_30");
  });

  it("provides a stable analytics session header for API requests", () => {
    const firstHeaders = getAnalyticsRequestHeaders();
    const secondHeaders = getAnalyticsRequestHeaders();

    expect(firstHeaders["x-jobops-analytics-session-id"]).toBeTruthy();
    expect(secondHeaders).toEqual(firstHeaders);
    expect(window.sessionStorage.getItem("jobops.analytics.session_id.v1")).toBe(
      firstHeaders["x-jobops-analytics-session-id"],
    );
  });

  it("identifies authenticated users with Umami distinct IDs", () => {
    identifyAnalyticsUser("user-123");
    identifyAnalyticsUser("user-123");

    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith("user-123");
    expect(op).toHaveBeenCalledWith("identify", { profileId: "user-123" });
    expect(window.localStorage.getItem("jobops.analytics.user_id.v1")).toBe("user-123");
  });

  it("uses identified distinct IDs in event metadata", () => {
    identifyAnalyticsUser("user-123");

    trackEvent("star_repo_click", { location: "demo_mode_banner" });

    expect(track).toHaveBeenCalledWith("star_repo_click", {
      location: "demo_mode_banner",
      analytics_user_id: "user-123",
      app_version: "abc1234-dev",
    });
  });

  it("truncates distinct IDs to Umami's 50-character limit", () => {
    const longDistinctId = "a".repeat(64);

    identifyAnalyticsUser(longDistinctId);

    expect(identify).toHaveBeenCalledWith("a".repeat(50));
    expect(op).toHaveBeenCalledWith("identify", {
      profileId: "a".repeat(50),
    });
  });
});
