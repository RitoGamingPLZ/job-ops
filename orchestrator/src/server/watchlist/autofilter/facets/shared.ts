export function rankFacetValues<T extends number | undefined>(
  counts: Iterable<readonly [string, T]>,
) {
  return [...counts]
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        (rightCount ?? 0) - (leftCount ?? 0) || left.localeCompare(right),
    )
    .slice(0, 60)
    .map(([value, count]) => ({ value, count }));
}
