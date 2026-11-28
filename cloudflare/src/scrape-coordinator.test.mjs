import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
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
    Headers,
    AbortSignal,
    TextEncoder,
    console,
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

test("careers scans persist, deduplicate and dispatch under the initiating scope", async () => {
  const db = new DatabaseSync(":memory:");
  const dispatched = [];
  const crawled = [];
  const inflight = [];
  let alarm = null;
  const env = {
    APP_STORE: {
      getByName: () => ({
        async executeCareersCrawl(input) {
          crawled.push(input);
          return { kind: "jobs", jobs: [{ id: "posting" }] };
        },
        async executeCareersScan(input) {
          dispatched.push(input);
          if (
            input.careersUrl === "https://second.example/jobs" &&
            dispatched.filter((item) => item.careersUrl === input.careersUrl).length === 1
          ) {
            return { outcome: "unavailable" };
          }
          return { outcome: "found" };
        },
      }),
    },
  };
  const storage = {
    sql: {
      exec(query, ...params) {
        if (!params.length && query.trimStart().startsWith("CREATE")) {
          db.exec(query);
          return;
        }
        const rows = db.prepare(query).all(...params);
        return { toArray: () => rows, one: () => rows[0] };
      },
    },
    transactionSync(operation) {
      db.exec("BEGIN");
      try {
        operation();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    getAlarm: async () => alarm,
    setAlarm: async (time) => {
      alarm = time;
    },
  };
  const context = { storage, waitUntil: (work) => inflight.push(work) };
  const input = {
    careersUrl: "https://example.com/careers?q=private",
    userId: "user-a",
    tenantId: "tenant-a",
    requestId: "request-a",
  };
  try {
    const coordinator = makeCoordinator(env);
    coordinator.ctx = context;
    coordinator.ensureSchema();
    await Promise.all([
      coordinator.enqueueCareersScan(input),
      coordinator.enqueueCareersScan({ ...input, userId: "user-b", tenantId: "tenant-b" }),
      coordinator.enqueueCareersScan({ ...input, careersUrl: "https://second.example/jobs" }),
      coordinator.enqueueCareersScan({ ...input, careersUrl: "https://third.example/jobs" }),
    ]);
    assert.ok(alarm);
    const rows = db.prepare("SELECT target, params_json FROM scrape_tasks ORDER BY rowid").all();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].target, "https://example.com/careers");
    assert.deepEqual(JSON.parse(rows[0].params_json), {
      userId: "user-a",
      tenantId: "tenant-a",
      requestId: "request-a",
    });

    const restarted = makeCoordinator(env);
    restarted.ctx = context;
    const scan = await restarted.careersScanStatus(input.careersUrl);
    assert.equal(scan.state, "queued");
    const crawl = {
      key: "same-public-filters",
      host: "example.com",
      scanTaskId: scan.taskId,
      payload: { careersUrl: "https://example.com/careers" },
    };
    await Promise.all([restarted.enqueueCareersCrawl(crawl), restarted.enqueueCareersCrawl(crawl)]);
    await restarted.alarm();
    await Promise.all(inflight);
    assert.equal(dispatched.length, 2);
    assert.equal(crawled.length, 0);
    assert.equal(dispatched[0].userId, "user-a");
    assert.equal(dispatched[0].tenantId, "tenant-a");
    assert.equal((await restarted.careersScanStatus(input.careersUrl)).outcome.outcome, "found");
    assert.equal((await restarted.enqueueCareersScan(input)).state, "finished");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM scrape_tasks WHERE status = 'pending'").get().n,
      3,
    );
    assert.equal(
      (await restarted.careersScanStatus("https://second.example/jobs")).state,
      "queued",
    );
    db.exec("UPDATE scrape_tasks SET next_retry_at = 0 WHERE status = 'pending'");
    db.exec("UPDATE source_state SET last_dispatched_at = 0");
    await restarted.alarm();
    await Promise.all(inflight);
    const second = await restarted.careersScanStatus("https://second.example/jobs");
    assert.equal(second.outcome.outcome, "found");
    assert.equal(crawled.length, 1);
    const result = await restarted.enqueueCareersCrawl(crawl);
    assert.equal(result.state, "finished");
    assert.equal(result.result.jobs[0].id, "posting");
    assert.equal((await restarted.readCareersCrawl(crawl.key, crawl.host)).jobs[0].id, "posting");
  } finally {
    db.close();
  }
});

function makeContainerDO(env, options = {}) {
  const starts = [];
  const timeoutCalls = [];
  const tcpRequests = [];
  const container = {
    running: options.running ?? false,
    images: { base: "job-ops-image:latest" },
    start(startOpts) {
      starts.push(startOpts);
      if (options.startRunningAfterMs === undefined) {
        container.running = true;
      } else {
        setTimeout(() => {
          container.running = true;
        }, options.startRunningAfterMs);
      }
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
          if (options.startRunningAfterMs !== undefined && !container.running) {
            throw new Error("container is not listening");
          }
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

test("ScraperContainer starts both careers-site operations with the same worker on standard-1", async () => {
  for (const path of ["/internal/careers-site/learn", "/internal/careers-site/run"]) {
    const careers = makeContainerDO({ CRON_SECRET: "secret" });
    await careers.instance.fetch(
      new Request(`http://scraper${path}`, { method: "POST", body: "{}" }),
    );
    assert.equal(careers.starts[0].instance, "standard-1");
    assert.deepEqual(Array.from(careers.starts[0].entrypoint), [
      "node",
      "/app/orchestrator/dist/careers-worker/careers-worker.mjs",
    ]);
  }
  // Other scraper requests stay on the default size.
  const scraper = makeContainerDO({ CRON_SECRET: "secret" });
  await scraper.instance.fetch(
    new Request("http://scraper/internal/scrape/jobs", { method: "POST", body: "{}" }),
  );
  assert.equal("instance" in scraper.starts[0], false);
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

test("ScraperContainer waits through slow container placement instead of returning 503", async () => {
  const { instance, container } = makeContainerDO(
    { CRON_SECRET: "secret" },
    { startRunningAfterMs: 5_500 },
  );
  const res = await instance.fetch(
    new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
  );
  assert.equal(res.status, 200);
  assert.equal(container.running, true);
});

test("ScraperContainer returns 503 quickly when the container exits after starting", async () => {
  let probes = 0;
  const { instance, container } = makeContainerDO(
    { CRON_SECRET: "secret" },
    {
      onHealth() {
        probes += 1;
        container.running = false;
        return new Response("not ready", { status: 503 });
      },
    },
  );
  const startedAt = Date.now();
  const res = await instance.fetch(
    new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
  );
  assert.equal(res.status, 503);
  assert.ok(probes >= 1);
  assert.ok(Date.now() - startedAt < 5_000);
});

test("ScraperContainer starts the PDF renderer for the warm-up request", async () => {
  const warm = makeContainerDO({ CRON_SECRET: "secret" });
  const res = await warm.instance.fetch(
    new Request("http://scraper/internal/render-pdf/warm", { method: "POST" }),
  );
  assert.equal(res.status, 200);
  assert.equal(warm.starts[0].instance, "standard-1");
  assert.deepEqual(Array.from(warm.starts[0].entrypoint), [
    "node",
    "/app/orchestrator/dist/pdf-worker/pdf-worker.mjs",
  ]);
  assert.deepEqual(warm.timeoutCalls, [5 * 60_000]);
});

test("ScraperContainer logs how long a PDF request waited for the container and then ran", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  try {
    const { instance } = makeContainerDO({ CRON_SECRET: "secret" });
    await instance.fetch(
      new Request("http://scraper/internal/render-pdf", { method: "POST", body: "{}" }),
    );
    await instance.fetch(new Request("http://scraper/scrape", { method: "POST", body: "{}" }));
  } finally {
    console.log = originalLog;
  }

  const timings = logs
    .map((line) => JSON.parse(line))
    .filter((e) => e.msg === "pdf-container-timing");
  assert.equal(timings.length, 1);
  assert.equal(timings[0].path, "/internal/render-pdf");
  assert.equal(timings[0].coldStart, true);
  assert.equal(timings[0].status, 200);
  assert.equal(typeof timings[0].readyMs, "number");
  assert.equal(typeof timings[0].forwardMs, "number");
});

test("jsonError honors request IDs and preserves response headers", async () => {
  const { jsonError } = loadModule("./utils.ts");
  const request = new Request("https://example.com/api/jobs", {
    headers: { "x-request-id": "worker-request" },
  });
  const response = jsonError(request, "SERVICE_UNAVAILABLE", "Maintenance", {
    status: 503,
    headers: { "retry-after": "30" },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-request-id"), "worker-request");
  assert.equal(response.headers.get("retry-after"), "30");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "SERVICE_UNAVAILABLE", message: "Maintenance" },
    meta: { requestId: "worker-request" },
  });

  const detailedResponse = jsonError(request, "UNPROCESSABLE_ENTITY", "Checksum mismatch", {
    status: 422,
    details: { expected: { jobs: "abc" } },
  });
  assert.equal(detailedResponse.status, 422);
  assert.deepEqual(await detailedResponse.json(), {
    ok: false,
    error: {
      code: "UNPROCESSABLE_ENTITY",
      message: "Checksum mismatch",
      details: { expected: { jobs: "abc" } },
    },
    meta: { requestId: "worker-request" },
  });
});
