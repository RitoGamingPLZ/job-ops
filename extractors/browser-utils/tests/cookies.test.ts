import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCookieJar, saveCookies } from "../src/cookies.js";

// loadCookies / saveCookies mostly need a real Playwright BrowserContext, while
// readCookieJar lets us test persistence and scoped storage resolution directly.

function storageDir() {
  const dir = join(tmpdir(), `browser-utils-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCookieJar(dir: string, extractorId: string, overrides: Record<string, unknown> = {}) {
  const jar = {
    extractorId,
    savedAt: new Date().toISOString(),
    cookies: [
      {
        name: "cf_clearance",
        value: "fake",
        domain: ".example.com",
        path: "/",
        // Expires 1 hour from now
        expires: Date.now() / 1000 + 3600,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
    ],
    ...overrides,
  };
  writeFileSync(join(dir, `${extractorId}-cookies.json`), JSON.stringify(jar, null, 2));
}

describe("cookies", () => {
  const originalDataDir = process.env.DATA_DIR;
  const originalCookieDir = process.env.JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR;

  beforeEach(() => {
    delete process.env.JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    if (originalCookieDir === undefined) {
      delete process.env.JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR;
    } else {
      process.env.JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR = originalCookieDir;
    }
  });

  describe("cookie storage directory resolution", () => {
    it("reads cookies from DATA_DIR/cloudflare-cookies when configured", async () => {
      const dataDir = storageDir();
      const cfDir = join(dataDir, "cloudflare-cookies");
      mkdirSync(cfDir, { recursive: true });
      writeCookieJar(cfDir, "data-dir-source");
      process.env.DATA_DIR = dataDir;

      expect((await readCookieJar("data-dir-source")).hasCookies).toBe(true);
    });

    it("prefers JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR over DATA_DIR", async () => {
      const dataDir = storageDir();
      const scopedDir = storageDir();
      writeCookieJar(scopedDir, "scoped-source");
      process.env.DATA_DIR = dataDir;
      process.env.JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR = scopedDir;

      expect((await readCookieJar("scoped-source")).hasCookies).toBe(true);
    });

    it("prefers an explicit storageDir argument over environment variables", async () => {
      const envDir = storageDir();
      const explicitDir = storageDir();
      writeCookieJar(explicitDir, "explicit-source");
      process.env.JOBOPS_CLOUDFLARE_COOKIE_STORAGE_DIR = envDir;

      expect((await readCookieJar("explicit-source", explicitDir)).hasCookies).toBe(true);
      expect((await readCookieJar("explicit-source")).hasCookies).toBe(false);
    });
  });

  describe("readCookieJar", () => {
    it("returns hasCookies false when no file exists", async () => {
      const dir = storageDir();
      const result = await readCookieJar("nonexistent", dir);
      expect(result).toEqual({
        hasCookies: false,
        hasClearanceCookie: false,
        cookieCount: 0,
      });
    });

    it("returns saved userAgent and hasCookies true", async () => {
      const dir = storageDir();
      writeCookieJar(dir, "hiringcafe", {
        userAgent: "Mozilla/5.0 SolverUA",
      });

      const result = await readCookieJar("hiringcafe", dir);
      expect(result.hasCookies).toBe(true);
      expect(result.hasClearanceCookie).toBe(true);
      expect(result.cookieCount).toBe(1);
      expect(result.userAgent).toBe("Mozilla/5.0 SolverUA");
    });

    it("returns hasCookies false when all cookies are expired", async () => {
      const dir = storageDir();
      writeCookieJar(dir, "hiringcafe", {
        cookies: [
          {
            name: "cf_clearance",
            value: "old",
            domain: ".example.com",
            path: "/",
            expires: Date.now() / 1000 - 3600, // expired 1 hour ago
            httpOnly: true,
            secure: true,
            sameSite: "None",
          },
        ],
        userAgent: "Mozilla/5.0 StaleUA",
      });

      const result = await readCookieJar("hiringcafe", dir);
      expect(result.hasCookies).toBe(false);
      expect(result.hasClearanceCookie).toBe(false);
      expect(result.cookieCount).toBe(0);
      // UA is still returned — caller decides whether to use it
      expect(result.userAgent).toBe("Mozilla/5.0 StaleUA");
    });

    it("returns undefined userAgent when jar has no UA field", async () => {
      const dir = storageDir();
      writeCookieJar(dir, "hiringcafe"); // no userAgent override

      const result = await readCookieJar("hiringcafe", dir);
      expect(result.hasCookies).toBe(true);
      expect(result.hasClearanceCookie).toBe(true);
      expect(result.userAgent).toBeUndefined();
    });
  });

  describe("saveCookies", () => {
    function mockContext(cookies: Record<string, string>[], userAgent = "Mozilla/5.0 TestUA") {
      return {
        cookies: async () =>
          cookies.map((c) => ({
            name: c.name,
            value: c.value ?? "v",
            domain: c.domain ?? ".example.com",
            path: "/",
            expires: c.expires ? Number(c.expires) : Date.now() / 1000 + 3600,
            httpOnly: true,
            secure: true,
            sameSite: "None" as const,
          })),
        pages: () => [
          {
            evaluate: async () => userAgent,
          },
        ],
      } as unknown as import("playwright").BrowserContext;
    }

    it("persists userAgent from the browser context", async () => {
      const dir = storageDir();
      const ctx = mockContext([{ name: "cf_clearance" }], "Mozilla/5.0 Camoufox/123");

      await expect(saveCookies(ctx, "test-extractor", dir)).resolves.toBe(1);

      const jar = await readCookieJar("test-extractor", dir);
      expect(jar.hasCookies).toBe(true);
      expect(jar.userAgent).toBe("Mozilla/5.0 Camoufox/123");
    });

    it("writes undefined userAgent when no pages are open", async () => {
      const dir = storageDir();
      const ctx = {
        cookies: async () => [
          {
            name: "cf_clearance",
            value: "v",
            domain: ".example.com",
            path: "/",
            expires: Date.now() / 1000 + 3600,
            httpOnly: true,
            secure: true,
            sameSite: "None" as const,
          },
        ],
        pages: () => [],
      } as unknown as import("playwright").BrowserContext;

      await expect(saveCookies(ctx, "no-pages", dir)).resolves.toBe(1);

      const jar = await readCookieJar("no-pages", dir);
      expect(jar.hasCookies).toBe(true);
      expect(jar.userAgent).toBeUndefined();
    });

    it("does not write jar when no relevant cookies exist", async () => {
      const dir = storageDir();
      const ctx = mockContext([{ name: "irrelevant_cookie" }]);

      await expect(saveCookies(ctx, "empty", dir)).resolves.toBe(0);

      const jar = await readCookieJar("empty", dir);
      expect(jar.hasCookies).toBe(false);
    });
  });
});
