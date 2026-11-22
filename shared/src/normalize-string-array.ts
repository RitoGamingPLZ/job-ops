/**
 * Trims values, drops empties, and dedupes (case-insensitively by default),
 * keeping the first spelling. `maxLength` truncates before the duplicate check;
 * `maxItems` stops once that many values are kept.
 */
export function normalizeStringArray(
  values: readonly string[] | null | undefined,
  options?: { caseSensitive?: boolean; maxItems?: number; maxLength?: number },
): string[] {
  if (!values || values.length === 0) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = value.trim().slice(0, options?.maxLength);
    if (!trimmed) continue;

    const key = options?.caseSensitive ? trimmed : trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(trimmed);
    if (options?.maxItems !== undefined && normalized.length >= options.maxItems) break;
  }

  return normalized;
}
