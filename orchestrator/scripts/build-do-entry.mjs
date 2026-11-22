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
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "net",
  "os",
  "path",
  "querystring",
  "stream",
  "string_decoder",
  "tls",
  "tty",
  "url",
  "util",
  "vm",
  "zlib",
];

const builtinImports = NODE_BUILTIN_SHIMS.map(
  (mod) => `import * as __ns_${mod} from "node:${mod}";`,
).join("\n");

const builtinEntries = NODE_BUILTIN_SHIMS.map(
  (mod) => `  "${mod}": __unwrapNodeBuiltin(__ns_${mod}),\n  "node:${mod}": __unwrapNodeBuiltin(__ns_${mod}),`,
).join("\n");

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
  /throw Error\('Dynamic require of "'\+([a-zA-Z0-9_$]+)\+'" is not supported'\)/g;
const matches = bundled.match(dynamicRequirePattern);
if (!matches || matches.length === 0) {
  throw new Error(
    "Expected esbuild dynamic require helper pattern in dist/do/do-entry.mjs, but none matched",
  );
}
const patched = bundled.replace(
  dynamicRequirePattern,
  (_match, varName) => `return __doRequire(${varName})`,
);
writeFileSync(outFile, patched, "utf8");
