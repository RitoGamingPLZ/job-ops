/**
 * Reads a positive integer from an environment variable, falling back when the variable is unset,
 * blank, non-numeric or not greater than zero.
 */
export function getPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
