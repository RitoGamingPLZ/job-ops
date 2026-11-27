export function shouldHydrateSourceLabel(
  source: { sourceType: string; label: string; careersUrl: string },
  sourceType: string,
): boolean {
  const label = source.label.trim();
  return source.sourceType === sourceType && (!label || label === source.careersUrl.trim());
}
