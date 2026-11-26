import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { readPageContentIfReady } from "../src/challenge.js";

describe("challenge page navigation", () => {
  it("returns null while the page is navigating and changing content", async () => {
    const page = {
      content: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "page.content: Unable to retrieve content because the page is navigating and changing the content.",
          ),
        )
        .mockResolvedValueOnce("<html>Job results</html>"),
    } as unknown as Page;

    await expect(readPageContentIfReady(page)).resolves.toBeNull();
    await expect(readPageContentIfReady(page)).resolves.toBe("<html>Job results</html>");
  });

  it("does not hide unexpected browser failures", async () => {
    const page = {
      content: vi.fn().mockRejectedValue(new Error("Page closed")),
    } as unknown as Page;

    await expect(readPageContentIfReady(page)).rejects.toThrow("Page closed");
  });
});
