// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  launch: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:fs/promises", () => ({ readdir: mocks.readdir }));
vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));

type Reply = {
  status?: number;
  body?: string;
  chunks?: string[];
  headers?: Record<string, string>;
};
let replies: Reply[];
let network: { url: URL; options: any }[];
let routeHandler: (route: any) => Promise<void>;
let browserRequests: {
  url: string;
  navigation?: boolean;
  method?: string;
  type?: string;
  frame?: string;
}[];
let context: any;
let browser: any;
let page: any;
let fulfill: ReturnType<typeof vi.fn>;
let abort: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  replies = [];
  network = [];
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.readdir.mockResolvedValue([
    "chromium_headless_shell-9",
    "chromium_headless_shell-151",
    "chromium-999",
  ]);
  mocks.request.mockImplementation((url: URL, options: any, callback: any) => {
    network.push({ url, options });
    const req = new EventEmitter() as any;
    req.end = () =>
      queueMicrotask(() => {
        const reply = replies.shift();
        if (!reply) {
          req.emit("error", new Error("Unexpected network request"));
          return;
        }
        const response = new PassThrough() as any;
        response.statusCode = reply.status ?? 200;
        response.headers = reply.headers ?? {};
        callback(response);
        for (const chunk of reply.chunks ?? [reply.body ?? ""])
          response.write(Buffer.from(chunk));
        response.end();
      });
    return req;
  });
  browserRequests = [];
  fulfill = vi.fn().mockResolvedValue(undefined);
  abort = vi.fn().mockResolvedValue(undefined);
  page = {
    setDefaultTimeout: vi.fn(),
    mainFrame: vi.fn(() => "main"),
    goto: vi.fn(async () => {
      for (const req of browserRequests) {
        const request = {
          url: () => req.url,
          method: () => req.method ?? "GET",
          resourceType: () => req.type ?? "document",
          headers: () => ({}),
          isNavigationRequest: () => req.navigation ?? true,
          frame: () => req.frame ?? "main",
        };
        await routeHandler({ request: () => request, fulfill, abort });
      }
      return { status: () => 200 };
    }),
    waitForSelector: vi.fn(),
    content: vi.fn(async () => "<html>Rendered jobs</html>"),
    url: vi.fn(() => "https://careers.example/jobs"),
  };
  context = {
    close: vi.fn(async () => {}),
    newPage: vi.fn(async () => page),
    route: vi.fn(async (_pattern, handler) => {
      routeHandler = handler;
    }),
    routeWebSocket: vi.fn(),
  };
  browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
    on: vi.fn(),
  };
  mocks.launch.mockResolvedValue(browser);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function api() {
  return import("./fetch");
}

describe("fetchPublicText", () => {
  it("pins the validated DNS address and returns text with the final URL", async () => {
    replies.push({ body: "jobs" });
    const { fetchPublicText } = await api();
    expect(
      await fetchPublicText("https://careers.example/jobs", {
        accept: "text/html",
      }),
    ).toEqual({
      url: "https://careers.example/jobs",
      status: 200,
      html: "jobs",
    });
    expect(mocks.lookup).toHaveBeenCalledWith("careers.example", {
      all: true,
      verbatim: true,
    });
    const callback = vi.fn();
    network[0].options.lookup("careers.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(network[0].options.agent).toBe(false);
    expect(network[0].options.autoSelectFamily).toBe(false);
    expect(network[0].options.family).toBe(4);
    expect(network[0].options.headers).toEqual({
      accept: "text/html",
      "user-agent":
        "job-ops-crawler/1.0 (+https://github.com/DaKheera47/job-ops)",
    });
  });
  it.each([
    "http://careers.example/",
    "https://user:pass@careers.example/",
  ])("rejects unsafe URL %s", async (url) => {
    await expect((await api()).fetchPublicText(url, {})).rejects.toThrow(
      "HTTPS",
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "127.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fdff::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:ac10:1",
    "2002:a00:1::",
    "64:ff9b::a00:1",
    "2001:db8::1",
  ])("rejects DNS resolving to non-public %s", async (address) => {
    mocks.lookup.mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {}),
    ).rejects.toThrow("non-public");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects mixed public/private DNS answers and literal IPs", async () => {
    const { fetchPublicText } = await api();
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "::1", family: 6 },
    ]);
    await expect(
      fetchPublicText("https://careers.example/", {}),
    ).rejects.toThrow("non-public");
    await expect(
      fetchPublicText("https://[::ffff:192.168.0.1]/", {}),
    ).rejects.toThrow("non-public");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each([
    "2606:4700:4700::1111",
    "172.32.0.1",
    "192.169.0.1",
  ])("allows public %s", async (address) => {
    mocks.lookup.mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    replies.push({ body: "ok" });
    expect(
      (await (await api()).fetchPublicText("https://careers.example/", {}))
        .html,
    ).toBe("ok");
  });
  it("follows at most three same-host HTTPS redirects and rechecks DNS", async () => {
    replies.push(
      { status: 302, headers: { location: "/one" } },
      { status: 301, headers: { location: "/two" } },
      { status: 307, headers: { location: "/three" } },
      { body: "jobs" },
    );
    const { fetchPublicText } = await api();
    expect((await fetchPublicText("https://careers.example/", {})).url).toBe(
      "https://careers.example/three",
    );
    expect(mocks.lookup).toHaveBeenCalledTimes(4);
    replies.push(
      ...Array.from({ length: 4 }, () => ({
        status: 302,
        headers: { location: "/loop" },
      })),
    );
    await expect(
      fetchPublicText("https://careers.example/", {}),
    ).rejects.toThrow("redirect limit");
  });
  it.each([
    "https://evil.example/jobs",
    "http://careers.example/jobs",
    "https://careers.example:444/jobs",
  ])("rejects redirect to %s", async (location) => {
    replies.push({ status: 302, headers: { location } });
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {}),
    ).rejects.toThrow();
    expect(network).toHaveLength(1);
  });
  it("rejects a rebinding answer on a redirect", async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    replies.push({ status: 302, headers: { location: "/jobs" } });
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {}),
    ).rejects.toThrow("non-public");
    expect(network).toHaveLength(1);
  });
  it.each([
    { headers: { "content-length": "99" } },
    { chunks: ["123", "456"] },
  ])("caps declared and streamed sizes", async (reply) => {
    replies.push(reply);
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {
        maxBytes: 5,
      }),
    ).rejects.toThrow("byte limit");
  });
  it.each([
    403, 406,
  ])("marks HTTP %s blocked without exposing the body", async (status) => {
    replies.push({ status, body: "secret body" });
    const { SiteBlockedError } = await import("./types");
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {}),
    ).rejects.toBeInstanceOf(SiteBlockedError);
  });
  it("marks Cloudflare challenge HTML blocked", async () => {
    replies.push({ body: "<title>Just a moment...</title>" });
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {}),
    ).rejects.toThrow("Cloudflare challenge");
  });
  it("recognizes the Cloudflare challenge header without a challenge title", async () => {
    replies.push({
      headers: { "cf-mitigated": "challenge" },
      body: "challenge",
    });
    const { SiteBlockedError } = await import("./types");
    await expect(
      (await api()).fetchPublicText("https://careers.example/", {}),
    ).rejects.toBeInstanceOf(SiteBlockedError);
  });
  it("enforces the 20-second deadline even during DNS lookup", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    // AbortSignal.timeout uses a native timer; use a controlled signal to prove
    // that the complete operation, including DNS, receives the deadline.
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const pending = (await api()).fetchPublicText(
      "https://careers.example/",
      {},
    );
    deadline.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    expect(timeout).toHaveBeenCalledWith(20_000);
    timeout.mockRestore();
    expect(network).toHaveLength(0);
  });
  it("stops before networking on abort and aborts a stalled DNS lookup", async () => {
    const { fetchPublicText } = await api();
    const first = AbortSignal.abort(new Error("cancelled"));
    await expect(
      fetchPublicText("https://careers.example/", { signal: first }),
    ).rejects.toThrow("cancelled");
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = fetchPublicText("https://careers.example/", {
      signal: controller.signal,
    });
    controller.abort(new Error("cancel DNS"));
    await expect(pending).rejects.toThrow("cancel DNS");
    expect(network).toHaveLength(0);
  });
});

describe("isAllowedByRobots", () => {
  it("uses only wildcard groups, merges them, and resolves longest rules with allow winning ties", async () => {
    replies.push({
      body: "User-agent: OtherBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/jobs\nDisallow: /same\nAllow: /same\n\nUser-agent: *\nDisallow: /*?secret=*$\nDisallow:\n",
    });
    const { isAllowedByRobots: allowed } = await api();
    expect(await allowed("https://careers.example/jobs", {})).toBe(true);
    expect(await allowed("https://careers.example/private/a", {})).toBe(false);
    expect(await allowed("https://careers.example/private/jobs/one", {})).toBe(
      true,
    );
    expect(await allowed("https://careers.example/same", {})).toBe(true);
    expect(await allowed("https://careers.example/jobs?secret=yes", {})).toBe(
      false,
    );
    expect(network).toHaveLength(1);
    expect(network[0].url.href).toBe("https://careers.example/robots.txt");
  });
  it("matches adversarial wildcard rules quickly without backtracking", async () => {
    replies.push({ body: "User-agent: *\nDisallow: /*a*a*a*a*a*a*a*b" });
    const { isAllowedByRobots: allowed } = await api();
    const start = performance.now();
    expect(
      await allowed(`https://careers.example/${"a".repeat(100)}`, {}),
    ).toBe(true);
    expect(performance.now() - start).toBeLessThan(500);
  });
  it("honors end anchors, repeated wildcards, and literal metacharacters", async () => {
    replies.push({
      body: "User-agent: *\nDisallow: /jobs***a$\nDisallow: /literal.x$\nDisallow: /exact$",
    });
    const { isAllowedByRobots: allowed } = await api();
    for (const path of ["/jobsaa", "/jobsa", "/literal.x", "/exact"])
      expect(await allowed(`https://careers.example${path}`, {})).toBe(false);
    for (const path of ["/jobsab", "/literalax", "/exact/more"])
      expect(await allowed(`https://careers.example${path}`, {})).toBe(true);
  });
  it("ignores Sitemap and unknown fields when grouping user agents", async () => {
    replies.push({
      body: "User-agent: *\nSitemap: https://careers.example/map.xml\nUnknown: ignored\nUser-agent: OtherBot\nDisallow: /",
    });
    expect(
      await (await api()).isAllowedByRobots("https://careers.example/jobs", {}),
    ).toBe(false);
  });
  it("shares in-flight robots requests and caches failures until expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    replies.push({ status: 503 }, { body: "" });
    const { isAllowedByRobots: allowed } = await api();
    const results = await Promise.allSettled([
      allowed("https://careers.example/jobs", {}),
      allowed("https://careers.example/other", {}),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(network).toHaveLength(1);
    await expect(allowed("https://careers.example/jobs", {})).rejects.toThrow(
      "robots.txt",
    );
    expect(network).toHaveLength(1);
    vi.setSystemTime(Date.now() + 3_600_001);
    expect(await allowed("https://careers.example/jobs", {})).toBe(true);
    expect(network).toHaveLength(2);
  });
  it("normalizes encoded unreserved and Unicode characters without decoding reserved slashes", async () => {
    replies.push({
      body: "User-agent: *\nDisallow: /~jobs\nDisallow: /café\nDisallow: /a%2fb\n",
    });
    const { isAllowedByRobots: allowed } = await api();
    expect(await allowed("https://careers.example/%7ejobs", {})).toBe(false);
    expect(await allowed("https://careers.example/caf%C3%A9", {})).toBe(false);
    expect(await allowed("https://careers.example/a%2Fb", {})).toBe(false);
    expect(await allowed("https://careers.example/a/b", {})).toBe(true);
  });
  it("expires public rules in one hour and isolates host caches", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    replies.push(
      { body: "User-agent: *\nDisallow: /" },
      { body: "" },
      { body: "" },
    );
    const { isAllowedByRobots: allowed } = await api();
    const first = allowed("https://one.example/jobs", {});
    await vi.runAllTicks();
    expect(await first).toBe(false);
    expect(await allowed("https://one.example/jobs", {})).toBe(false);
    expect(await allowed("https://two.example/jobs", {})).toBe(true);
    vi.setSystemTime(Date.now() + 3_600_001);
    expect(await allowed("https://one.example/jobs", {})).toBe(true);
    expect(network).toHaveLength(3);
  });
  it("allows missing robots but fails closed on unavailable or blocked robots", async () => {
    replies.push({ status: 404 }, { status: 503 }, { status: 403 });
    const { isAllowedByRobots: allowed } = await api();
    expect(await allowed("https://missing.example/jobs", {})).toBe(true);
    await expect(allowed("https://down.example/jobs", {})).rejects.toThrow(
      "robots.txt",
    );
    await expect(allowed("https://blocked.example/jobs", {})).rejects.toThrow(
      "blocks automated access",
    );
  });
});

describe("loadPage", () => {
  it("delegates unrendered pages to the safe transport", async () => {
    replies.push({ body: "plain jobs" });
    expect(
      (
        await (
          await api()
        ).loadPage("https://careers.example/jobs", { render: false })
      ).html,
    ).toBe("plain jobs");
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("shares Chromium, selects the newest shell, closes isolated contexts and idle-closes the browser", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { loadPage } = await api();
    expect(
      await loadPage("https://careers.example/jobs", {
        render: true,
        waitFor: ".job",
      }),
    ).toEqual({
      url: "https://careers.example/jobs",
      status: 200,
      html: "<html>Rendered jobs</html>",
    });
    await loadPage("https://careers.example/jobs", { render: true });
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.launch.mock.calls[0][0]).toMatchObject({
      headless: true,
      executablePath: expect.stringContaining("chromium_headless_shell-151/"),
    });
    expect(page.waitForSelector).toHaveBeenCalledWith(".job", {
      state: "attached",
    });
    expect(context.close).toHaveBeenCalledTimes(2);
    expect(browser.newContext).toHaveBeenCalledWith({
      userAgent: "job-ops-crawler/1.0 (+https://github.com/DaKheera47/job-ops)",
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
  it("aborts stalled context creation and cleans up a context that arrives late", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const controller = new AbortController();
    let finishCreation!: (value: typeof context) => void;
    let creationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      creationStarted = resolve;
    });
    browser.newContext.mockImplementationOnce(() => {
      creationStarted();
      return new Promise((resolve) => {
        finishCreation = resolve;
      });
    });
    const pending = (await api()).loadPage("https://careers.example/jobs", {
      render: true,
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow("stop creation");
    await started;
    controller.abort(new Error("stop creation"));
    await rejected;
    expect(page.goto).not.toHaveBeenCalled();
    finishCreation(context);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    false,
    true,
  ])("bounds stalled context cleanup while preserving the load outcome (error: %s)", async (fails) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let closing!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      closing = resolve;
    });
    context.close.mockImplementationOnce(() => {
      closing();
      return new Promise(() => {});
    });
    if (fails) page.goto.mockRejectedValue(new Error("navigation failed"));
    let finished = false;
    const pending = (await api())
      .loadPage("https://careers.example/jobs", {
        render: true,
      })
      .finally(() => {
        finished = true;
      });
    const outcome = fails
      ? expect(pending).rejects.toThrow("navigation failed")
      : expect(pending).resolves.toMatchObject({ status: 200 });
    await closeStarted;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("honors the executable override and retries a failed launch", async () => {
    vi.stubEnv("CRAWLER_CHROMIUM_PATH", "/configured/chromium");
    mocks.launch
      .mockRejectedValueOnce(new Error("launch failed"))
      .mockResolvedValue(browser);
    const { loadPage } = await api();
    await expect(
      loadPage("https://careers.example/jobs", { render: true }),
    ).rejects.toThrow("launch failed");
    await loadPage("https://careers.example/jobs", { render: true });
    expect(mocks.launch).toHaveBeenLastCalledWith({
      headless: true,
      executablePath: "/configured/chromium",
      args: [
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    expect(mocks.readdir).not.toHaveBeenCalled();
  });
  it("guards the document and subresources, never forwarding private requests or non-GET requests", async () => {
    browserRequests = [
      { url: "https://careers.example/jobs" },
      { url: "https://127.0.0.1/secret", navigation: false, type: "fetch" },
      { url: "http://public.example/", navigation: false, type: "script" },
      {
        url: "https://public.example/",
        navigation: false,
        method: "POST",
        type: "fetch",
      },
    ];
    replies.push({ body: "<html>jobs</html>" });
    await (await api()).loadPage("https://careers.example/jobs", {
      render: true,
    });
    expect(network).toHaveLength(1);
    expect(fulfill).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(3);
    expect(context.routeWebSocket).toHaveBeenCalled();
  });
  it("aborts iframe navigation without failing the main page", async () => {
    browserRequests = [
      { url: "https://careers.example/jobs" },
      { url: "http://127.0.0.1/iframe", frame: "iframe" },
    ];
    replies.push({ body: "jobs" });
    await expect(
      (await api()).loadPage("https://careers.example/jobs", { render: true }),
    ).resolves.toMatchObject({ status: 200 });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(network).toHaveLength(1);
  });
  it("identifies rendered requests with the honest crawler User-Agent", async () => {
    browserRequests = [{ url: "https://careers.example/jobs" }];
    replies.push({ body: "jobs" });
    await (await api()).loadPage("https://careers.example/jobs", {
      render: true,
    });
    expect(network[0].options.headers["user-agent"]).toBe(
      "job-ops-crawler/1.0 (+https://github.com/DaKheera47/job-ops)",
    );
  });
  it("propagates challenge headers on rendered documents", async () => {
    browserRequests = [{ url: "https://careers.example/jobs" }];
    replies.push({
      headers: { "cf-mitigated": "challenge" },
      body: "challenge",
    });
    const { SiteBlockedError } = await import("./types");
    await expect(
      (await api()).loadPage("https://careers.example/jobs", { render: true }),
    ).rejects.toBeInstanceOf(SiteBlockedError);
  });
  it("keeps a replacement browser when the old browser disconnects late", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { loadPage } = await api();
    await loadPage("https://careers.example/jobs", { render: true });
    const disconnect = browser.on.mock.calls[0][1];
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const replacement = {
      ...browser,
      close: vi.fn(async () => {}),
      on: vi.fn(),
    };
    mocks.launch.mockResolvedValue(replacement);
    await loadPage("https://careers.example/jobs", { render: true });
    disconnect();
    await loadPage("https://careers.example/jobs", { render: true });
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(replacement.close).toHaveBeenCalledTimes(1);
  });
  it("releases the active page count before context cleanup finishes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let finishClose!: () => void;
    let closing!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      closing = resolve;
    });
    const closeFinished = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    context.close.mockImplementationOnce(() => {
      closing();
      return closeFinished;
    });
    const { loadPage } = await api();
    const first = loadPage("https://careers.example/jobs", { render: true });
    await closeStarted;
    try {
      await loadPage("https://careers.example/jobs", { render: true });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(browser.close).toHaveBeenCalledTimes(1);
    } finally {
      finishClose();
      await first;
    }
  });
  it("preserves the load error and idle cleanup when context close rejects", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    context.close.mockRejectedValue(new Error("close failed"));
    page.goto.mockRejectedValue(new Error("original navigation error"));
    await expect(
      (await api()).loadPage("https://careers.example/jobs", { render: true }),
    ).rejects.toThrow("original navigation error");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
  it("rejects a cross-host browser navigation and propagates blocked documents", async () => {
    const { loadPage } = await api();
    browserRequests = [{ url: "https://other.example/jobs" }];
    await expect(
      loadPage("https://careers.example/jobs", { render: true }),
    ).rejects.toThrow("unsafe browser navigation");
    browserRequests = [{ url: "https://careers.example/jobs" }];
    replies.push({ status: 403 });
    await expect(
      loadPage("https://careers.example/jobs", { render: true }),
    ).rejects.toThrow("HTTP 403");
    expect(context.close).toHaveBeenCalledTimes(2);
  });
  it("closes the context when the caller aborts", async () => {
    const controller = new AbortController();
    page.goto.mockImplementation(async () => {
      controller.abort(new Error("stop browser"));
      throw new Error("context closed");
    });
    await expect(
      (await api()).loadPage("https://careers.example/jobs", {
        render: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop browser");
    expect(context.close).toHaveBeenCalled();
  });
});
