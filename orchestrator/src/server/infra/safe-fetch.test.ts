import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) =>
    host === "internal.example.com"
      ? [{ address: "10.0.0.5", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
  ),
}));

import {
  assertPublicHttpUrl,
  fetchPublicText,
  isPrivateAddress,
  postJsonToPublicUrl,
  UnsafeUrlError,
} from "./safe-fetch";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-http schemes, credentials and private targets", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("https://user:pw@example.com")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    await expect(assertPublicHttpUrl("http://localhost:3001")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    await expect(assertPublicHttpUrl("https://internal.example.com/x")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it("accepts public hosts", async () => {
    await expect(assertPublicHttpUrl("https://jobs.example.com/a")).resolves.toBeInstanceOf(URL);
  });
});

describe("fetchPublicText", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("refuses redirects into private networks", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    await expect(fetchPublicText("https://jobs.example.com/a")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("follows public redirects and returns the body", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/final" } }))
      .mockResolvedValueOnce(new Response("hello", { status: 200 }));
    const result = await fetchPublicText("https://jobs.example.com/a");
    expect(result.text).toBe("hello");
    expect(result.finalUrl).toBe("https://jobs.example.com/final");
  });

  it("caps response size", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("x".repeat(100), { status: 200 }),
    );
    await expect(
      fetchPublicText("https://jobs.example.com/a", { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("postJsonToPublicUrl", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("blocks private webhook targets unless the operator opts in", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok"));
    await expect(postJsonToPublicUrl("http://10.0.0.8/hook", {}, {})).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    await expect(
      postJsonToPublicUrl("http://10.0.0.8/hook", {}, {}, { allowPrivateNetwork: true }),
    ).resolves.toBeInstanceOf(Response);
  });
});
