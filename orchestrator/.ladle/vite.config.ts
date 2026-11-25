import baseConfig from "../vite.config";

function filterLadlePlugins(plugins: unknown): unknown[] {
  if (!Array.isArray(plugins)) {
    return plugins ? [plugins] : [];
  }
  const kept: unknown[] = [];
  for (const item of plugins) {
    if (Array.isArray(item)) {
      const nested = filterLadlePlugins(item);
      if (nested.length > 0) kept.push(nested);
      continue;
    }
    if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
      if (item.name.startsWith("vite:react") || item.name.startsWith("vite-plus:")) {
        continue;
      }
    }
    if (item) kept.push(item);
  }
  return kept;
}

export default {
  plugins: filterLadlePlugins(baseConfig.plugins),
  resolve: baseConfig.resolve,
  define: baseConfig.define,
};
