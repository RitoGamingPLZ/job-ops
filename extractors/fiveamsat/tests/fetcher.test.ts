import { describe, expect, it, vi } from "vitest";
import {
  buildFiveamsatSearchUrl,
  fetchFiveamsatSearchPage,
} from "../src/fetcher";

describe("fetchFiveamsatSearchPage", () => {
  it("sends exact headers and returns the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html>",
    });

    await expect(
      fetchFiveamsatSearchPage({ query: "node js", fetchImpl }),
    ).resolves.toBe("<html>");
    expect(fetchImpl).toHaveBeenCalledWith(buildFiveamsatSearchUrl("node js"), {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ar,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; JobOps/1.0)",
      },
    });
  });

  it("omits an empty statusText from the error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, statusText: "" });
    await expect(
      fetchFiveamsatSearchPage({ query: "x", fetchImpl }),
    ).rejects.toThrow(
      `Khamsat search request failed with 500 for ${buildFiveamsatSearchUrl("x")}`,
    );
  });
});
