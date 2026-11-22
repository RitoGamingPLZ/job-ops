import { mkdirSync } from "node:fs";
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
  plugins: [stubNativeModulesPlugin],
  logLevel: "info",
});
