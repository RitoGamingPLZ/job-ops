/**
 * Formats an optional min/max compensation range into a consistent display string.
 */
export function formatSalaryRange(input: {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  interval?: string | null;
  style?: "compact" | "formatted";
}): string | undefined {
  const min = typeof input.min === "number" && Number.isFinite(input.min) ? input.min : null;
  const max = typeof input.max === "number" && Number.isFinite(input.max) ? input.max : null;
  if (min === null && max === null) return undefined;

  const currency = input.currency?.trim() || null;
  const interval = input.interval?.trim() || null;

  if (input.style === "formatted") {
    const format = (value: number) =>
      new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
    const amount =
      min !== null && max !== null
        ? `${format(min)}–${format(max)}`
        : min !== null
          ? `from ${format(min)}`
          : `up to ${format(max as number)}`;
    return `${currency ? `${currency} ` : ""}${amount}${interval ? `/${interval}` : ""}`;
  }

  const range =
    min !== null && max !== null
      ? `${Math.round(min)}-${Math.round(max)}`
      : min !== null
        ? `${Math.round(min)}+`
        : `${Math.round(max as number)}`;
  const currencyPart = currency ? `${currency} ` : "";
  const intervalPart = interval ? ` / ${interval}` : "";
  return `${currencyPart}${range}${intervalPart}`.trim();
}
