import type { z } from "zod";

export function parseJsonSafely<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonWithSchema<TSchema extends z.ZodTypeAny>(
  raw: string | null | undefined,
  schema: TSchema,
): z.output<TSchema> | null {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
