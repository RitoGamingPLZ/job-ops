import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const orchestratorDir = resolve(__dirname, "..");
const entryPoint = resolve(orchestratorDir, "src/server/pdf-worker.ts");
const outFile = resolve(orchestratorDir, "dist/pdf-worker/pdf-worker.mjs");

/**
 * Keeps database/SQLite modules out of the stateless PDF render worker bundle.
 * Internal render requests supply picture bytes inline (`resolvedPicture: null` when absent),
 * so the design-resume repository is never called in the container worker.
 */
const stubDbModulesPlugin = {
  name: "stub-db-modules",
  setup(pluginBuild) {
    pluginBuild.onResolve(
      { filter: /^(?:@server\/repositories\/design-resume|better-sqlite3)$/ },
      (args) => ({
        path: args.path,
        namespace: "pdf-worker-stub",
      }),
    );

    pluginBuild.onLoad({ filter: /.*/, namespace: "pdf-worker-stub" }, (args) => ({
      contents: `
const unavailable = () => {
  throw new Error(${JSON.stringify(
    `Module "${args.path}" is not available in the stateless PDF worker`,
  )});
};
export const getDesignResumeAssetById = unavailable;
export default unavailable;
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
