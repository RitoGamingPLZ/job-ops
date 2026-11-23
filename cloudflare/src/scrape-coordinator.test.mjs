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
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

const utils = loadModule("./utils.ts");
const { ScrapeCoordinatorDO } = loadModule("./scrape-coordinator.ts", {
  "cloudflare:workers": { DurableObject: class {} },
  "./utils": utils,
});

function makeCoordinator(env) {
  const coordinator = Object.create(ScrapeCoordinatorDO.prototype);
  coordinator.env = env;
  coordinator.poolCursor = 0;
  return coordinator;
}

function namespace(calls) {
  return {
    getByName(name) {
      return {
        async fetch(url, init) {
          calls.push({ name, url, body: JSON.parse(init.body) });
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
