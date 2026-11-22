import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "**/dist/**",
  "docs-site/.docusaurus/**",
  "docs-site/build/**",
  "**/.venv/**",
  ".claude/**",
  "**/data/**",
  "**/storage/**",
];

export default defineConfig({
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
