import { asRecord } from "@shared/utils/type-conversion";

type PathSegment = string | number;

export function getNestedValue(value: unknown, path: PathSegment[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return current;
}
