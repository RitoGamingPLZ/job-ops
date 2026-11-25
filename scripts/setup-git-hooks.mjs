#!/usr/bin/env node
// Installs the Vite+ git hook dispatcher so `.vite-hooks/pre-commit` runs on commit.
// Runs from the root `prepare` script after `npm install`. Strictly best effort: it
// must never fail an install, so it skips CI, Docker/production installs (no `.git`
// or no dev dependencies) and anyone who opts out with VP_GIT_HOOKS=0.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vp = join(root, "node_modules", ".bin", process.platform === "win32" ? "vp.cmd" : "vp");

const skip =
  process.env.CI ||
  process.env.VP_GIT_HOOKS === "0" ||
  !existsSync(join(root, ".git")) ||
  !existsSync(vp);

if (!skip) {
  const result = spawnSync(vp, ["config", "--hooks", "--no-agent"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.warn("Could not install git hooks. Run `npx vp config --hooks` to retry.");
  }
}
