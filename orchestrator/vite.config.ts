/// <reference types="vitest" />

import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function readAppVersion(): string {
  const packageJsonPath = new URL("./package.json", import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  if (
    typeof packageJson.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(packageJson.version)
  ) {
    throw new Error(
      "orchestrator/package.json must contain a semver version in x.y.z format",
    );
  }

  return `v${packageJson.version}`;
}

const appVersion = readAppVersion();

declare global {
  // eslint-disable-next-line no-var
  var __APP_VERSION__: string;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    pool: "forks",
    maxWorkers: 4,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    exclude: ["node_modules/**", "dist/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: [
            "src/server/**/*.test.ts",
            "src/server/**/*.test.tsx",
            "src/shared/**/*.test.ts",
            "scripts/**/*.test.ts",
            "../shared/src/**/*.test.ts",
            "../career-boards/**/*.test.ts",
            "../extractors/**/tests/**/*.test.ts",
            "../extractors/*/src/**/*.test.ts",
            "../visa-sponsor-providers/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: "./src/setupTests.ts",
          include: [
            "src/client/**/*.test.ts",
            "src/client/**/*.test.tsx",
            "src/components/**/*.test.ts",
            "src/components/**/*.test.tsx",
            "src/lib/**/*.test.ts",
            "src/lib/**/*.test.tsx",
            "../docs-site/src/**/*.test.ts",
            "../docs-site/src/**/*.test.tsx",
          ],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@client": path.resolve(__dirname, "./src/client"),
      "@server": path.resolve(__dirname, "./src/server"),
      "@infra": path.resolve(__dirname, "./src/server/infra"),
      "@shared": path.resolve(__dirname, "../shared/src"),
      "job-ops-shared": path.resolve(__dirname, "../shared/src"),
      "@career-boards/bamboohr": path.resolve(
        __dirname,
        "../career-boards/bamboohr/src/index.ts",
      ),
      "@career-boards/workday": path.resolve(
        __dirname,
        "../career-boards/workday/src/index.ts",
      ),
      "@career-boards/greenhouse": path.resolve(
        __dirname,
        "../career-boards/greenhouse/src/index.ts",
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/pdfs": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/stats": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
