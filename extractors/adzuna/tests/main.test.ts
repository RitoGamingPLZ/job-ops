import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Adzuna CLI location", () => {
  it("passes country context so the city reaches the upstream where parameter", async () => {
    vi.stubEnv("ADZUNA_COUNTRY", "gb");
    vi.stubEnv("ADZUNA_APP_ID", "test-app");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    vi.stubEnv("ADZUNA_LOCATION_QUERY", " Leeds ");
    vi.stubEnv("ADZUNA_SEARCH_TERMS", "developer");
    vi.stubEnv("ADZUNA_OUTPUT_JSON", "/tmp/adzuna-test/jobs.json");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("../src/main");
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v1/api/jobs/gb/search/1");
    expect(url.searchParams.get("where")).toBe("Leeds");
  });
});
