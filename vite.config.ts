import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "**/dist/**",
  "docs-site/.docusaurus/**",
  "docs-site/build/**",
  "**/.venv/**",
  ".claude/**",
  "**/data/**",
  "**/storage/**",
  "cloudflare/.wrangler/**",
];

export default defineConfig({
  // Run by the pre-commit hook (.vite-hooks/pre-commit): format, lint and type-check
  // the staged files with the same command CI runs, auto-fixing what it can.
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    indentStyle: "space",
    indentWidth: 2,
    lineEnding: "lf",
    ignorePatterns,
  },
  lint: {
    ignorePatterns,
    overrides: [
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/test-utils.ts"],
        rules: {
          "typescript/no-explicit-any": "off",
        },
      },
    ],
  },
});
