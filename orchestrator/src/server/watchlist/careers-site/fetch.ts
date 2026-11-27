import { isWorkerdRuntime } from "../runtime";
import { lookup } from "node:dns/promises";
import { readdir } from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { isPrivateAddress } from "@infra/safe-fetch";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { type LoadedPage, SiteBlockedError } from "./types";

const USER_AGENT = "job-ops-crawler/1.0 (+https://github.com/DaKheera47/job-ops)";
const MAX_BYTES = 5 * 1024 * 1024;
const PAGE_TIMEOUT = 20_000;
const CONTEXT_CLOSE_TIMEOUT = 5_000;
const IDLE_TIMEOUT = 5 * 60_000;
const ROBOTS_TTL = 60 * 60_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function safeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Crawler requires an HTTPS URL without credentials");
  }
  return url;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function publicTarget(url: URL, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Crawler refuses non-public network addresses");
  }
  return addresses[0];
}

interface PublicResponse {
  url: string;
  status: number;
  body: Buffer;
  headers: Record<string, string>;
}

async function fetchBytes(
  url: URL,
  options: { signal: AbortSignal; maxBytes: number; accept?: string },
): Promise<PublicResponse> {
  // workerd does not implement node:https's DNS-pinning lookup option. The
  // caller validates public DNS on every hop; fetch must never follow itself.
  const response = await fetch(url, {
    redirect: "manual",
    signal: options.signal,
    headers: {
      "user-agent": USER_AGENT,
      ...(options.accept ? { accept: options.accept } : {}),
    },
  });
  const reader = response.body?.getReader();
  try {
    const status = response.status;
    const headers = Object.fromEntries(response.headers);
    if (status === 403 || status === 406 || headers["cf-mitigated"] === "challenge") {
      throw new SiteBlockedError(
        url.hostname,
        headers["cf-mitigated"] === "challenge" ? "Cloudflare challenge" : `HTTP ${status}`,
      );
    }
    if (REDIRECTS.has(status)) {
      return { url: url.href, status, headers, body: Buffer.alloc(0) };
    }
    if (Number(headers["content-length"]) > options.maxBytes) {
      throw new Error("Crawler response exceeds byte limit");
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > options.maxBytes) throw new Error("Crawler response exceeds byte limit");
      chunks.push(Buffer.from(value));
    }
    return { url: url.href, status, headers, body: Buffer.concat(chunks) };
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

async function requestBytes(
  value: string,
  options: {
    signal: AbortSignal;
    maxBytes: number;
    accept?: string;
    redirects?: boolean;
  },
): Promise<PublicResponse> {
  let url = safeUrl(value);
  const originHost = url.host;
  for (let redirects = 0; ; redirects++) {
    options.signal.throwIfAborted();
    const target = await publicTarget(url, options.signal);
    // HTTPS forwards these net socket options, although this repo's
    // RequestOptions typing omits autoSelectFamily.
    const connectionOptions = {
      family: target.family,
      autoSelectFamily: false,
    };
    const result = await new Promise<PublicResponse>((resolve, reject) => {
      if (isWorkerdRuntime()) {
        void fetchBytes(url, options).then(resolve, reject);
        return;
      }
      const req = request(
        url,
        {
          method: "GET",
          signal: options.signal,
          // No pooled socket or second DNS resolution: connect to the checked IP.
          agent: false,
          ...connectionOptions,
          lookup: (_hostname, _options, callback) => {
            callback(null, target.address, target.family);
          },
          headers: {
            "user-agent": USER_AGENT,
            ...(options.accept ? { accept: options.accept } : {}),
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (
            status === 403 ||
            status === 406 ||
            response.headers["cf-mitigated"] === "challenge"
          ) {
            response.destroy();
            reject(
              new SiteBlockedError(
                url.hostname,
                response.headers["cf-mitigated"] === "challenge"
                  ? "Cloudflare challenge"
                  : `HTTP ${status}`,
              ),
            );
            return;
          }
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          if (REDIRECTS.has(status)) {
            response.destroy();
            resolve({ url: url.href, status, headers, body: Buffer.alloc(0) });
            return;
          }
          if (Number(headers["content-length"]) > options.maxBytes) {
            response.destroy();
            reject(new Error("Crawler response exceeds byte limit"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > options.maxBytes) {
              response.destroy(new Error("Crawler response exceeds byte limit"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              url: url.href,
              status,
              headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    if (REDIRECTS.has(result.status)) {
      const location = result.headers.location;
      if (!location) throw new Error("Crawler redirect has no location");
      const next = safeUrl(new URL(location, url).href);
      if (next.host !== originHost) throw new Error("Crawler refuses cross-host redirects");
      if (redirects >= 3) throw new Error("Crawler redirect limit exceeded");
      if (options.redirects === false) return result;
      url = next;
      continue;
    }
    if (/just a moment(?:\.{3}|…)?\s*<\/title>/i.test(result.body.toString("utf8"))) {
      throw new SiteBlockedError(url.hostname, "Cloudflare challenge");
    }
    return result;
  }
}

/** HTTPS-only GET to a public host (no private/loopback IPs), same-host redirects only, size-capped. Throws SiteBlockedError on 403/406/challenge pages. */
export async function fetchPublicText(
  url: string,
  options: { signal?: AbortSignal; maxBytes?: number; accept?: string },
): Promise<LoadedPage> {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error("Invalid crawler byte limit");
  const signal = AbortSignal.any([
    AbortSignal.timeout(PAGE_TIMEOUT),
    ...(options.signal ? [options.signal] : []),
  ]);
  const result = await requestBytes(url, { ...options, maxBytes, signal });
  return {
    url: result.url,
    status: result.status,
    html: result.body.toString("utf8"),
  };
}

interface RobotsRule {
  pattern: string;
  allow: boolean;
}
// Explicitly global: only public robots rules, never user settings or credentials.
const robotsCache = new Map<string, { expires: number; rules: Promise<RobotsRule[]> }>();

function parseRobots(text: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let group = { agents: [] as string[], rules: [] as RobotsRule[] };
  let hasDirectives = false;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line
      .split("#", 1)[0]
      .trim()
      .match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (hasDirectives) {
        groups.push(group);
        group = { agents: [], rules: [] };
        hasDirectives = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length && ["allow", "disallow", "crawl-delay"].includes(key)) {
      hasDirectives = true;
      if ((key === "allow" || key === "disallow") && value)
        group.rules.push({ pattern: value, allow: key === "allow" });
    }
  }
  groups.push(group);
  return groups.filter(({ agents }) => agents.includes("*")).flatMap(({ rules }) => rules);
}

function normalizeRobotsPath(value: string): string {
  return value
    .replace(/[\u0080-\u{10ffff}]/gu, (char) => encodeURIComponent(char))
    .replace(/%[\da-f]{2}/gi, (encoded) => {
      const char = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
      return /[a-z\d\-._~]/i.test(char) ? char : encoded.toUpperCase();
    });
}

// Match literal segments in order without a backtracking regular expression.
function matchesRobotsPath(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const segments = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = segments[0];
  if (!path.startsWith(first)) return false;
  if (segments.length === 1) return !anchored || path.length === first.length;
  let offset = first.length;
  const end = anchored ? segments.length - 1 : segments.length;
  for (let i = 1; i < end; i++) {
    if (!segments[i]) continue;
    const found = path.indexOf(segments[i], offset);
    if (found < 0) return false;
    offset = found + segments[i].length;
  }
  if (!anchored) return true;
  const last = segments[segments.length - 1];
  return path.endsWith(last) && offset <= path.length - last.length;
}

/** True when robots.txt allows User-agent * to fetch this URL. Caches robots.txt per host. */
export async function isAllowedByRobots(
  value: string,
  options: { signal?: AbortSignal },
): Promise<boolean> {
  const url = safeUrl(value);
  options.signal?.throwIfAborted();
  const key = url.origin;
  let entry = robotsCache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    // Share in-flight requests and failures; a caller can cancel its wait
    // without cancelling another caller's cached public robots request.
    const rules = fetchPublicText(`${key}/robots.txt`, {
      maxBytes: 512 * 1024,
    }).then((result) => {
      if (
        result.status >= 500 ||
        result.status < 200 ||
        (result.status >= 300 && result.status < 400)
      ) {
        throw new Error("Crawler could not read robots.txt");
      }
      return result.status >= 400 ? [] : parseRobots(result.html);
    });
    // Observe rejection even if every waiter aborts before the request settles.
    void rules.catch(() => {});
    entry = { expires: Date.now() + ROBOTS_TTL, rules };
    // Bound global state even when many arbitrary public hosts are supplied.
    if (robotsCache.size >= 1000) robotsCache.delete(robotsCache.keys().next().value as string);
    robotsCache.set(key, entry);
  }
  const path = normalizeRobotsPath(url.pathname + url.search);
  let length = -1;
  let allowed = true;
  const rules = options.signal ? await withAbort(entry.rules, options.signal) : await entry.rules;
  for (const rule of rules) {
    const pattern = normalizeRobotsPath(rule.pattern);
    const specificity = Buffer.byteLength(pattern.replace(/[*$]/g, ""));
    if (
      matchesRobotsPath(pattern, path) &&
      (specificity > length || (specificity === length && rule.allow))
    ) {
      length = specificity;
      allowed = rule.allow;
    }
  }
  return allowed;
}

let sharedBrowser: Promise<Browser> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let activePages = 0;

function scheduleBrowserClose() {
  if (idleTimer) clearTimeout(idleTimer);
  if (activePages || !sharedBrowser) return;
  idleTimer = setTimeout(() => {
    const browser = sharedBrowser;
    sharedBrowser = undefined;
    void browser?.then((instance) => instance.close()).catch(() => {});
  }, IDLE_TIMEOUT);
  idleTimer.unref();
}

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    const pending = (async () => {
      let executablePath = process.env.CRAWLER_CHROMIUM_PATH;
      if (!executablePath) {
        // Images that install Chromium into a fixed directory point Playwright at it with this variable.
        const root =
          process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() || join(homedir(), ".cache/ms-playwright");
        const entries = await readdir(root);
        const newest = entries
          .filter((name) => /^chromium_headless_shell-\d+$/.test(name))
          .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)))[0];
        if (!newest)
          throw new Error("Crawler Chromium is not installed; set CRAWLER_CHROMIUM_PATH");
        executablePath = join(root, newest, "chrome-headless-shell-linux64/chrome-headless-shell");
      }
      const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: [
          "--host-resolver-rules=MAP * ~NOTFOUND",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
      });
      browser.on("disconnected", () => {
        if (sharedBrowser === pending) sharedBrowser = undefined;
      });
      return browser;
    })().catch((error: unknown) => {
      if (sharedBrowser === pending) sharedBrowser = undefined;
      throw error;
    });
    sharedBrowser = pending;
  }
  return sharedBrowser;
}

// Cleanup must not hold a page result or its original error indefinitely.
async function closeContext(context: BrowserContext): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.close().catch(() => {}),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, CONTEXT_CLOSE_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** Load a page: plain fetch, or rendered with the shared Playwright Chromium when render is true. Applies the same safety checks. */
export async function loadPage(
  value: string,
  options: { render: boolean; waitFor?: string; signal?: AbortSignal },
): Promise<LoadedPage> {
  if (!options.render) return fetchPublicText(value, { signal: options.signal });
  const url = safeUrl(value);
  const signal = AbortSignal.any([
    AbortSignal.timeout(PAGE_TIMEOUT),
    ...(options.signal ? [options.signal] : []),
  ]);
  await publicTarget(url, signal);
  activePages++;
  if (idleTimer) clearTimeout(idleTimer);
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const browser = await withAbort(getBrowser(), signal);
    const pendingContext = browser
      .newContext({
        userAgent: USER_AGENT,
        serviceWorkers: "block",
        acceptDownloads: false,
      })
      .then((created) => {
        // Creation can finish after the abort race has already returned.
        if (signal.aborted) void closeContext(created);
        return created;
      });
    context = await withAbort(pendingContext, signal);
    onAbort = () => {
      void context?.close().catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    signal.throwIfAborted();
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);
    // Every network request goes through the DNS-pinned HTTPS transport. The
    // browser never opens an unchecked socket (including redirects/subresources).
    await context.routeWebSocket("**/*", (socket) => socket.close());
    let navigationCount = 0;
    let routeError: unknown;
    await context.route("**/*", async (route) => {
      const req = route.request();
      try {
        if (req.method() !== "GET" || ["image", "media", "font"].includes(req.resourceType())) {
          await route.abort();
          return;
        }
        if (req.isNavigationRequest() && req.frame() !== page.mainFrame()) {
          await route.abort();
          return;
        }
        const requestedUrl = safeUrl(req.url());
        if (req.isNavigationRequest()) {
          if (requestedUrl.host !== url.host || ++navigationCount > 4)
            throw new Error("Crawler refuses unsafe browser navigation");
        }
        const result = await requestBytes(requestedUrl.href, {
          signal,
          maxBytes: MAX_BYTES,
          redirects: false,
          accept: req.headers().accept,
        });
        const headers = { ...result.headers };
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        delete headers["set-cookie"];
        await route.fulfill({
          status: result.status,
          headers,
          body: result.body,
        });
      } catch (error) {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) routeError = error;
        await route.abort().catch(() => {});
      }
    });
    let response: Awaited<ReturnType<typeof page.goto>>;
    try {
      response = await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT,
      });
      if (options.waitFor) await page.waitForSelector(options.waitFor, { state: "attached" });
    } catch (error) {
      throw routeError ?? (signal.aborted ? signal.reason : error);
    }
    if (routeError) throw routeError;
    const html = await page.content();
    if (Buffer.byteLength(html) > MAX_BYTES) throw new Error("Crawler response exceeds byte limit");
    if (/just a moment(?:\.{3}|…)?\s*<\/title>/i.test(html))
      throw new SiteBlockedError(url.hostname, "Cloudflare challenge");
    const finalUrl = safeUrl(page.url());
    if (finalUrl.host !== url.host) {
      throw new Error("Crawler refuses cross-host browser navigation");
    }
    return { url: finalUrl.href, status: response?.status() ?? 200, html };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    activePages--;
    scheduleBrowserClose();
    if (context) await closeContext(context);
  }
}
