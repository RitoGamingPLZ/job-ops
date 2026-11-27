import type { WatchlistSource } from "@shared/types";
import type { z } from "zod";

export function resolveCustomLabel(
  label: string | null | undefined,
  careersUrl: string,
  fallback: string,
  ...extraIgnored: Array<string | undefined>
): string {
  const trimmed = label?.trim();
  const careersTrimmed = careersUrl.trim();
  if (
    !trimmed ||
    trimmed === careersTrimmed ||
    extraIgnored.some((ignored) => ignored !== undefined && trimmed === ignored)
  ) {
    return fallback;
  }
  return trimmed;
}

export function parseCatalogSourcesLenient<TSchema extends z.ZodTypeAny>(
  entries: unknown[],
  schema: TSchema,
  mapEntry: (parsed: z.infer<TSchema>) => WatchlistSource | null,
): WatchlistSource[] {
  return entries.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    if (!parsed.success) return [];
    try {
      const mapped = mapEntry(parsed.data);
      return mapped ? [mapped] : [];
    } catch {
      return [];
    }
  });
}

export function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function getFreshMapEntry<K, V extends { expires: number }>(
  map: Map<K, V>,
  key: K,
  now = Date.now(),
): V | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    map.delete(key);
    return undefined;
  }
  return entry;
}

export function pruneExpiredTimestamps<K>(
  map: Map<K, number>,
  ttlMs: number,
  now = Date.now(),
): void {
  for (const [key, timestamp] of map) {
    if (now - timestamp >= ttlMs) {
      map.delete(key);
    }
  }
}

export function classifyLlmFailure(message: string): {
  kind: "not_configured" | "timeout_or_aborted" | "http" | "unknown";
  status?: string;
} {
  if (message === "LLM API key not configured") return { kind: "not_configured" };
  if (/\b(timed?\s*out|aborted|AbortError|TimeoutError)\b/i.test(message)) {
    return { kind: "timeout_or_aborted" };
  }
  const status = message.match(/LLM API error: (\d{3})\b/)?.[1];
  return status ? { kind: "http", status } : { kind: "unknown" };
}
