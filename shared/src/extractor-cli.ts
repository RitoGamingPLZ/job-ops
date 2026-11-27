export function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function emitProgress(payload: Record<string, unknown>): void {
  if (process.env.JOBOPS_EMIT_PROGRESS !== "1") return;
  console.log(`JOBOPS_PROGRESS ${JSON.stringify(payload)}`);
}
