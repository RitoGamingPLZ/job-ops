import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchStub } from "../testing/fixtures";
import { fetchLogoBranding, shouldHydrateSourceLabel } from "./branding";

afterEach(() => vi.unstubAllGlobals());

describe("watchlist branding helpers", () => {
  it("hydrates source labels only when empty or equal to the careers URL", () => {
    expect(
      shouldHydrateSourceLabel(
        { sourceType: "workday", label: "  ", careersUrl: "https://acme.test/jobs" },
        "workday",
      ),
    ).toBe(true);
    expect(
      shouldHydrateSourceLabel(
        {
          sourceType: "workday",
          label: " https://acme.test/jobs ",
          careersUrl: "https://acme.test/jobs",
        },
        "workday",
      ),
    ).toBe(true);
    expect(
      shouldHydrateSourceLabel(
        { sourceType: "workday", label: "Acme", careersUrl: "https://acme.test/jobs" },
        "workday",
      ),
    ).toBe(false);
    expect(
      shouldHydrateSourceLabel(
        { sourceType: "bamboohr", label: "", careersUrl: "https://acme.test/jobs" },
        "workday",
      ),
    ).toBe(false);
  });

  it("validates HTTP status, byte limits, and MIME sniffing before returning data URLs", async () => {
    createFetchStub(new Response("nope", { status: 404 }));
    await expect(
      fetchLogoBranding({
        providerLabel: "Workday",
        logoUrl: "https://acme.test/logo.png",
        careersUrl: "https://acme.test/careers",
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: "Failed to fetch Workday logo with HTTP 404.",
    });

    createFetchStub(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "50" } }),
    );
    await expect(
      fetchLogoBranding({
        providerLabel: "Workday",
        logoUrl: "https://acme.test/logo.png",
        careersUrl: "https://acme.test/careers",
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ status: 502, message: "Workday company logo exceeded size limit" });

    createFetchStub(
      new Response("<html>not an image</html>", { headers: { "content-type": "text/html" } }),
    );
    await expect(
      fetchLogoBranding({
        providerLabel: "BambooHR",
        logoUrl: "https://acme.test/logo.png",
        careersUrl: "https://acme.test/careers",
      }),
    ).rejects.toMatchObject({ status: 502, message: "BambooHR logo response was not an image." });

    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    createFetchStub(new Response(pngHeader, { headers: { "content-type": "image/png" } }));
    await expect(
      fetchLogoBranding({
        providerLabel: "Workday",
        logoUrl: "https://acme.test/logo.png",
        careersUrl: "https://acme.test/careers",
      }),
    ).resolves.toEqual({
      careersUrl: "https://acme.test/careers",
      logoUrl: "https://acme.test/logo.png",
      mimeType: "image/png",
      imageDataUrl: `data:image/png;base64,${Buffer.from(pngHeader).toString("base64")}`,
    });
  });
});
