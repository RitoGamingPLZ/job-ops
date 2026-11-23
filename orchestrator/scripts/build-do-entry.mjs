import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorDir = resolve(__dirname, "..");
const entryPoint = resolve(orchestratorDir, "src/server/do-entry.ts");
const outFile = resolve(orchestratorDir, "dist/do/do-entry.mjs");

const NATIVE_ONLY_PACKAGES = [
  "better-sqlite3",
  "playwright",
  "playwright-core",
  "rebrowser-playwright",
  "pdf-parse",
  "pdfjs-dist",
  "browser-utils",
];

const NATIVE_ONLY_PREFIXES = ["@camoufox/", "impit"];

function isNativeOnlyModule(specifier) {
  if (NATIVE_ONLY_PACKAGES.includes(specifier)) {
    return true;
  }
  return NATIVE_ONLY_PREFIXES.some(
    (prefix) => specifier === prefix || specifier.startsWith(prefix),
  );
}

/**
 * Replaces native/browser-only dependencies with lightweight stubs so the
 * bundle loads cleanly inside Cloudflare Workers (`workerd` + `nodejs_compat`).
 */
const stubNativeModulesPlugin = {
  name: "stub-native-modules",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) => {
      if (isNativeOnlyModule(args.path)) {
        return {
          path: args.path,
          namespace: "native-stub",
        };
      }
      return null;
    });

    pluginBuild.onLoad({ filter: /.*/, namespace: "native-stub" }, (args) => ({
      contents: `
const unavailable = () => {
  throw new Error(${JSON.stringify(
    `Module "${args.path}" is not available inside the Cloudflare Durable Object runtime`,
  )});
};
const proxy = new Proxy(unavailable, {
  get(_target, prop) {
    if (prop === "__esModule") return true;
    if (prop === "default") return proxy;
    return proxy;
  },
  construct() {
    unavailable();
  },
});
module.exports = proxy;
`,
      loader: "js",
    }));
  },
};

const NODE_BUILTIN_SHIMS = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "console",
  "constants",
  "crypto",
  "diagnostics_channel",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "timers/promises",
  "tls",
  "tty",
  "url",
  "util",
  "util/types",
  "vm",
  "worker_threads",
  "zlib",
];

const OPTIONAL_UNSHIMMED_REQUIRES = new Set([
  "bufferutil",
  "canvas",
  "utf-8-validate",
  "node:path/win32",
  "node:sqlite",
]);

function shimIdentifier(mod) {
  return `__ns_${mod.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

const builtinImports = NODE_BUILTIN_SHIMS.map(
  (mod) => `import * as ${shimIdentifier(mod)} from "node:${mod}";`,
).join("\n");

const builtinEntries = NODE_BUILTIN_SHIMS.map((mod) => {
  const id = shimIdentifier(mod);
  return `  "${mod}": __unwrapNodeBuiltin(${id}),\n  "node:${mod}": __unwrapNodeBuiltin(${id}),`;
}).join("\n");

const doRequireBanner = `${builtinImports}
function __unwrapNodeBuiltin(ns) {
  const def = ns && ns.default;
  if (typeof def === "function") {
    return new Proxy(def, {
      get(target, prop, receiver) {
        if (prop in ns && prop !== "default") {
          return ns[prop];
        }
        return Reflect.get(target, prop, receiver);
      },
      has(target, prop) {
        return (prop in ns && prop !== "default") || Reflect.has(target, prop);
      },
    });
  }
  if (def && typeof def === "object") {
    return Object.assign({}, def, ns);
  }
  return ns;
}
const __DO_BUILTINS__ = {
${builtinEntries}
};
function __doRequire(id) {
  if (Object.prototype.hasOwnProperty.call(__DO_BUILTINS__, id)) {
    return __DO_BUILTINS__[id];
  }
  const err = new Error(\`Cannot find module '\${id}'\`);
  err.code = "MODULE_NOT_FOUND";
  throw err;
}
`;

mkdirSync(dirname(outFile), { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: resolve(orchestratorDir, "tsconfig.json"),
  external: ["node:*", "cloudflare:*"],
  banner: { js: doRequireBanner },
  plugins: [stubNativeModulesPlugin],
  logLevel: "info",
});

const bundled = readFileSync(outFile, "utf8");
const dynamicRequirePattern =
  /\([a-zA-Z0-9_$]+=>typeof require<"u"\?require:typeof Proxy<"u"\?new Proxy\([a-zA-Z0-9_$]+,\{get:\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)=>\(typeof require<"u"\?require:[a-zA-Z0-9_$]+\)\[[a-zA-Z0-9_$]+\]\}\):[a-zA-Z0-9_$]+\)\(function\(([a-zA-Z0-9_$]+)\)\{if\(typeof require<"u"\)return require\.apply\(this,arguments\);throw Error\('Dynamic require of "'\+\1\+'" is not supported'\)\}\)/g;
const matches = bundled.match(dynamicRequirePattern);
if (!matches || matches.length === 0) {
  throw new Error(
    "Expected esbuild dynamic require helper IIFE in dist/do/do-entry.mjs, but none matched",
  );
}
const patched = bundled.replace(dynamicRequirePattern, "__doRequire");

// Verify no unshimmed Node built-in CJS require() calls slipped into the bundle.
const shimSet = new Set(NODE_BUILTIN_SHIMS.flatMap((mod) => [mod, `node:${mod}`]));
const assignMatch = patched.match(/([a-zA-Z0-9_$]+)=__doRequire/);
if (!assignMatch) {
  throw new Error("Expected minified __doRequire assignment in dist/do/do-entry.mjs");
}
const requireVar = assignMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const callPattern = new RegExp(`\\b${requireVar}\\((["'])([^"']+)\\1\\)`, "g");
const missingShims = new Set();
for (const match of patched.matchAll(callPattern)) {
  const specifier = match[2];
  if (!shimSet.has(specifier) && !OPTIONAL_UNSHIMMED_REQUIRES.has(specifier)) {
    missingShims.add(specifier);
  }
}
if (missingShims.size > 0) {
  throw new Error(
    `Unshimmed CJS require() specifiers in dist/do/do-entry.mjs: ${Array.from(missingShims).sort().join(", ")}`,
  );
}

writeFileSync(outFile, patched, "utf8");
