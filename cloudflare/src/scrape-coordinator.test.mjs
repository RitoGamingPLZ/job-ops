import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Load the Worker module with only its platform superclass substituted.
function loadModule(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    URL,
    Request,
    Response,
    AbortSignal,
    TextEncoder,
    crypto,
    setTimeout,
    clearTimeout,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

const utils = loadModule("./utils.ts");
const { ScrapeCoordinatorDO, ScraperContainer } = loadModule("./scrape-coordinator.ts", {
  "cloudflare:workers": { DurableObject: class {} },
  "./utils": utils,
});

function makeCoordinator(env) {
  const coordinator = Object.create(ScrapeCoordinatorDO.prototype);
  coordinator.env = env;
  coordinator.poolCursor = 0;
  return coordinator;
}

function makeContainerDO(env, options = {}) {
  const starts = [];
  const timeoutCalls = [];
  const tcpRequests = [];
  const container = {
    running: options.running ?? false,
    images: { base: "job-ops-image:latest" },
    start(startOpts) {
      starts.push(startOpts);
      container.running = true;
    },
    async setInactivityTimeout(durationMs) {
      timeoutCalls.push(durationMs);
    },
    getTcpPort(port) {
      return {
        async fetch(urlOrRequest, init) {
          const req =
            urlOrRequest instanceof Request ? urlOrRequest : new Request(urlOrRequest, init);
          const pathname = new URL(req.url).pathname;
          tcpRequests.push({ port, pathname, method: req.method });
          if (pathname === "/health") {
            return options.onHealth
              ? options.onHealth()
              : new Response(JSON.stringify({ status: "ok" }), { status: 200 });
          }
          if (options.onForward) {
            return options.onForward(req);
          }
          return new Response("ok", { status: 200 });
        },
      };
    },
  };

  const ctx = {
    container,
    blockConcurrencyWhile(fn) {
      return fn();
    },
  };
  const instance = new ScraperContainer(ctx, env);
  instance.ctx = ctx;
  instance.env = env;
  return { instance, container, starts, timeoutCalls, tcpRequests };
}

function namespace(calls) {
  return {
    getByName(name) {
      return {
        async fetch(url, init) {
          calls.push({
            name,
            url,
            headers: init.headers,
            body: JSON.parse(init.body),
          });
          return new Response(null, { status: 202 });
        },
      };
    },
  };
}

function task(runtime) {
  return { id: "task-1", source: "example", target: "https://example.com", runtime };
}

for (const runtime of ["worker", "container", "browser"]) {
  test(`${runtime} dispatch round-robins across SCRAPER_CONTAINER pool`, async () => {
    const calls = [];
    const coordinator = makeCoordinator({
      SCRAPER_CONTAINER: namespace(calls),
      SCRAPER_POOL_SIZE: "2",
      BROWSER: {
        fetch() {
          assert.fail("Browser Rendering has no extraction contract");
        },
      },
    });
    for (let i = 0; i < 3; i++) {
      await coordinator.dispatchTask(task(runtime));
    }
    assert.deepEqual(
      calls.map(({ name }) => name),
      ["scraper-0", "scraper-1", "scraper-0"],
    );
    for (const call of calls) {
      assert.equal(call.url, "http://scraper/scrape");
      assert.equal(call.body.taskId, "task-1");
      assert.equal(call.body.poolWorker, call.name);
      if (runtime === "browser") {
        assert.equal(call.body.runtime, "browser-fallback");
      } else if (runtime === "worker") {
        assert.equal(call.body.runtime, "worker");
      }
    }
  });
}

test("ScrapeCoordinatorDO falls back to CRON_SECRET when INTERNAL_SYNC_SECRET is blank", async () => {
  const calls = [];
  const coordinator = makeCoordinator({
    SCRAPER_CONTAINER: namespace(calls),
    INTERNAL_SYNC_SECRET: "   ",
    CRON_SECRET: " cron-fallback-secret ",
  });
  await coordinator.dispatchTask(task("container"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["x-internal-sync-secret"], "cron-fallback-secret");
});

test("ScraperContainer passes CRON_SECRET fallback when INTERNAL_SYNC_SECRET is unset or blank", async () => {
  for (const internalSecret of [undefined, "   "]) {
    const { instance, starts } = makeContainerDO({
      INTERNAL_SYNC_SECRET: internalSecret,
      CRON_SECRET: "cron-secret-value",
    });
    const res = await instance.fetch(
      new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
    );
    assert.equal(res.status, 200);
    assert.equal(starts.length, 1);
    assert.equal(starts[0].env.INTERNAL_SYNC_SECRET, "cron-secret-value");
  }
});

test("ScraperContainer prefers trimmed INTERNAL_SYNC_SECRET and omits when neither secret is set", async () => {
  const both = makeContainerDO({
    INTERNAL_SYNC_SECRET: " primary-secret ",
    CRON_SECRET: "cron-secret-value",
  });
  await both.instance.fetch(
    new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
  );
  assert.equal(both.starts[0].env.INTERNAL_SYNC_SECRET, "primary-secret");

  const neither = makeContainerDO({});
  await neither.instance.fetch(
    new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
  );
  assert.equal("INTERNAL_SYNC_SECRET" in neither.starts[0].env, false);
});

test("ScraperContainer starts PDF renderer with standard-1 and pdf-worker entrypoint, scrapers with default", async () => {
  const pdf = makeContainerDO({ CRON_SECRET: "secret" });
  await pdf.instance.fetch(
    new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
  );
  assert.equal(pdf.starts[0].instance, "standard-1");
  assert.deepEqual(Array.from(pdf.starts[0].entrypoint), [
    "node",
    "/app/orchestrator/dist/pdf-worker/pdf-worker.mjs",
  ]);

  const scraper = makeContainerDO({ CRON_SECRET: "secret" });
  await scraper.instance.fetch(
    new Request("http://scraper/scrape", { method: "POST", body: "{}" }),
  );
  assert.equal("instance" in scraper.starts[0], false);
  assert.equal("entrypoint" in scraper.starts[0], false);
});

test("ScraperContainer skips /health probe on warm requests and re-checks after restart or forward error", async () => {
  let failFirstForward = false;
  const { instance, container, tcpRequests } = makeContainerDO(
    { CRON_SECRET: "secret" },
    {
      onForward() {
        if (failFirstForward) {
          failFirstForward = false;
          throw new Error("container connection reset");
        }
        return new Response("ok", { status: 200 });
      },
    },
  );

  // Cold start probes /health once then forwards.
  await instance.fetch(new Request("http://scraper/internal/render-pdf", { method: "POST" }));
  assert.deepEqual(
    tcpRequests.map((r) => r.pathname),
    ["/health", "/internal/render-pdf"],
  );

  // Warm request skips /health.
  await instance.fetch(new Request("http://scraper/internal/render-pdf", { method: "POST" }));
  assert.deepEqual(
    tcpRequests.map((r) => r.pathname),
    ["/health", "/internal/render-pdf", "/internal/render-pdf"],
  );

  // Forward failure resets readiness so next request re-probes /health.
  failFirstForward = true;
  await assert.rejects(
    () => instance.fetch(new Request("http://scraper/internal/render-pdf", { method: "POST" })),
    /container connection reset/,
  );
  await instance.fetch(new Request("http://scraper/internal/render-pdf", { method: "POST" }));
  assert.deepEqual(
    tcpRequests.map((r) => r.pathname),
    [
      "/health",
      "/internal/render-pdf",
      "/internal/render-pdf",
      "/internal/render-pdf",
      "/health",
      "/internal/render-pdf",
    ],
  );

  // Container sleeping (running=false) restarts and re-probes /health.
  container.running = false;
  await instance.fetch(new Request("http://scraper/internal/render-pdf", { method: "POST" }));
  assert.equal(tcpRequests[tcpRequests.length - 2].pathname, "/health");
  assert.equal(tcpRequests[tcpRequests.length - 1].pathname, "/internal/render-pdf");
});
