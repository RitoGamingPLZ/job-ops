import { describe, expect, it, vi } from "vitest";
import { buildWazzufSearchUrl, fetchWazzufSearchPage } from "../src/fetcher";

describe("fetchWazzufSearchPage", () => {
  it("sends exact headers and returns the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html>",
    });

    await expect(fetchWazzufSearchPage({ query: "node js", fetchImpl })).resolves.toBe("<html>");
    expect(fetchImpl).toHaveBeenCalledWith(buildWazzufSearchUrl("node js"), {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en,ar;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; JobOps/1.0)",
      },
    });
  });

  it("omits an empty statusText from the error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "" });
    await expect(fetchWazzufSearchPage({ query: "x", fetchImpl })).rejects.toThrow(
      `WUZZUF search request failed with 500 for ${buildWazzufSearchUrl("x")}`,
    );
  });
});
