import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorDir = resolve(__dirname, "..");
const entryPoint = resolve(orchestratorDir, "src/server/careers-worker.ts");
const outFile = resolve(orchestratorDir, "dist/careers-worker/careers-worker.mjs");
const settingsRepo = resolve(orchestratorDir, "src/server/repositories/settings.ts");

/** Names a module exports, read from source so a stub never drifts from the real module. */
function exportedNames(file) {
  const source = readFileSync(file, "utf8");
  const names = new Set();
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g,
  ))
    names.add(match[1]);
  return [...names];
}

/**
 * Keeps database/SQLite modules out of the stateless careers-site worker bundle. The caller sends
 * its own LLM connection with every learn request, so the tenant-settings helpers (which read the
 * database) are never reached here: calling one throws instead of opening a database.
 */
const stubDbModulesPlugin = {
  name: "stub-db-modules",
  setup(pluginBuild) {
    const stubs = new Map([
      ["@server/services/modelSelection", ["createConfiguredLlmService", "resolveLlmModel"]],
      ["better-sqlite3", []],
    ]);
    pluginBuild.onResolve(
      { filter: /^(?:@server\/services\/modelSelection|better-sqlite3)$/ },
      (args) => ({
        path: args.path,
        namespace: "careers-worker-stub",
      }),
    );
    pluginBuild.onResolve({ filter: /repositories\/settings$/ }, (args) => ({
      path: args.path,
      namespace: "careers-worker-stub",
      pluginData: { names: exportedNames(settingsRepo) },
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "careers-worker-stub" }, (args) => {
      const names = args.pluginData?.names ?? stubs.get(args.path) ?? [];
      return {
        contents: `
const unavailable = () => {
  throw new Error(${JSON.stringify(
    `Module "${args.path}" is not available in the stateless careers-site worker`,
  )});
};
${names.map((name) => `export const ${name} = unavailable;`).join("\n")}
export default unavailable;
`,
        loader: "js",
      };
    });
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
  // Packages with native parts, dynamic requires or large binaries stay on disk: the image
  // already has them installed next to the orchestrator.
  external: ["jsdom", "playwright", "playwright-core", "camoufox-js"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  plugins: [stubDbModulesPlugin],
  logLevel: "info",
});

const bundled = readFileSync(outFile, "utf8");
for (const forbidden of ["better-sqlite3", "drizzle-orm"]) {
  if (bundled.includes(forbidden)) {
    throw new Error(`Unexpected database dependency "${forbidden}" in ${outFile}`);
  }
}
