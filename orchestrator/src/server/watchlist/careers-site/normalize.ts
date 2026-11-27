// Pure value helpers shared by every careers-site extractor (JSON-LD, microdata, CSS selectors,
// search discovery and public facets). Nothing here touches the network or a DOM.

// A value this long is almost certainly the wrong node (a whole section), not a field.
const MAX_FIELD_LENGTH = 200;

const EMPLOYMENT_TYPES: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACTOR: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Internship",
  VOLUNTEER: "Volunteer",
  PER_DIEM: "Per diem",
};
const SALARY_UNITS: Record<string, string> = {
  HOUR: "hour",
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
};

/** A plain object, or an empty one: lets untrusted JSON be read without repeated guards. */
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The trimmed string, or null when it is not a string or is blank. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Collapse whitespace; an empty or overlong value is treated as absent. */
export function collapseText(value: unknown, max = MAX_FIELD_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed && collapsed.length <= max ? collapsed : null;
}

/** Any parseable date as a full ISO timestamp. */
export function isoDate(value: unknown): string | null {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

/** An application deadline. Date-only input stays date-only so no time or zone is invented. */
export function deadlineDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !Number.isFinite(Date.parse(raw))) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date(raw).toISOString();
}

/** schema.org jobLocation (Place, PostalAddress, strings, or a list of them) as one label. */
export function jobLocation(value: unknown): string | null {
  const entries = Array.isArray(value) ? value : [value];
  const labels = entries.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const place = record(entry);
    const address = record(place.address);
    const country = record(address.addressCountry);
    const parts = [
      text(address.addressLocality),
      text(address.addressRegion),
      text(address.addressCountry) ?? text(country.name),
    ].filter(Boolean);
    const label = text(place.address) || parts.join(", ") || text(place.name);
    return label ? [label] : [];
  });
  return [...new Set(labels)].join("; ") || null;
}

function amount(value: unknown): string | null {
  // A blank string would otherwise read as 0, and a pay of 0 is a missing value, not a salary.
  const number =
    typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "").trim()) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return null;
  return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatOneSalary(raw: unknown): string | null {
  const salary = record(raw);
  const currency = collapseText(salary.currency, 3)?.toUpperCase();
  const value = record(salary.value);
  // `value` is either a QuantitativeValue object or a plain number.
  const quantity = Object.keys(value).length ? value : { value: salary.value };
  const min = amount(quantity.minValue);
  const max = amount(quantity.maxValue);
  const single = amount(quantity.value);
  const range = min && max ? (min === max ? min : `${min}–${max}`) : (single ?? min ?? max);
  if (!range) return null;
  const unit = SALARY_UNITS[String(quantity.unitText ?? "").toUpperCase()];
  return `${currency && /^[A-Z]{3}$/.test(currency) ? `${currency} ` : ""}${range}${
    unit ? ` per ${unit}` : ""
  }`;
}

/** A schema.org MonetaryAmount. Several different amounts are ambiguous, so they yield null. */
export function formatSalary(raw: unknown): string | null {
  const formatted = (Array.isArray(raw) ? raw : [raw])
    .map(formatOneSalary)
    .filter((entry): entry is string => entry !== null);
  const distinct = new Set(formatted);
  return distinct.size === 1 ? formatted[0] : null;
}

/** schema.org employmentType (one value or a list) as readable labels; "OTHER" says nothing. */
export function formatEmploymentType(raw: unknown): string | null {
  const labels = (Array.isArray(raw) ? raw : [raw]).flatMap((entry) => {
    const label = collapseText(entry);
    if (!label) return [];
    return [EMPLOYMENT_TYPES[label.toUpperCase().replace(/[\s-]+/g, "_")] ?? label];
  });
  const distinct = [...new Set(labels)];
  return distinct.length && !distinct.every((label) => /^other$/i.test(label))
    ? distinct.join(", ")
    : null;
}

/** Whether two URLs are the same page ignoring query, hash and trailing slashes. */
export function sameUrlPath(a: string, b: string): boolean {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const path = (url: URL) => url.pathname.replace(/\/+$/, "") || "/";
    return x.origin === y.origin && path(x) === path(y);
  } catch {
    return false;
  }
}
