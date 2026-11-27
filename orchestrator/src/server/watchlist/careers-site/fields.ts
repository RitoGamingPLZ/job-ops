import { collapseText, deadlineDate, formatEmploymentType, formatSalary } from "./normalize";
import { type DetailFields, EXTRA_FIELD_NAMES, type ExtraFieldName, type FieldRule } from "./types";

const POSTING_PROPERTY: Partial<Record<ExtraFieldName, string>> = {
  salary: "baseSalary",
  deadline: "validThrough",
  jobType: "employmentType",
};

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/\s*:$/, "").toLowerCase();
}

/** The value next to a visible label ("Salary: $90k", `<dt>Salary</dt><dd>$90k</dd>`). */
function byLabel(document: Document, rule: Extract<FieldRule, { kind: "label" }>): string | null {
  const wanted = normalizeLabel(rule.label);
  const values = new Set<string>();
  const containers = Array.from(document.querySelectorAll(rule.container)).slice(0, 20);
  for (const container of containers) {
    for (const element of Array.from(container.querySelectorAll("*")).slice(0, 500)) {
      if (element.childElementCount > 0) continue;
      if (normalizeLabel(element.textContent ?? "") !== wanted) continue;
      let value = collapseText(element.nextElementSibling?.textContent);
      if (!value) {
        const parent = collapseText(element.parentElement?.textContent);
        const own = collapseText(element.textContent);
        if (parent && own && parent.toLowerCase().startsWith(own.toLowerCase()))
          value = collapseText(parent.slice(own.length).replace(/^[\s:–-]+/, ""));
      }
      if (value) values.add(value);
    }
  }
  // Two different values next to the same label are ambiguous: leave the field blank.
  return values.size === 1 ? [...values][0] : null;
}

function readRule(
  name: ExtraFieldName,
  rule: FieldRule,
  document: Document,
  posting: Record<string, unknown> | null,
): string | null {
  try {
    if (rule.kind === "jobPosting") {
      if (!posting || POSTING_PROPERTY[name] !== rule.property) return null;
      const raw = posting[rule.property];
      if (rule.property === "baseSalary") return formatSalary(raw);
      if (rule.property === "employmentType") return formatEmploymentType(raw);
      return collapseText(raw);
    }
    if (rule.kind === "label") return byLabel(document, rule);
    const node = document.querySelector(rule.selector);
    if (!node) return null;
    return collapseText(rule.attribute ? node.getAttribute(rule.attribute) : node.textContent);
  } catch {
    // An invalid selector must not discard an otherwise valid posting.
    return null;
  }
}

function validate(name: ExtraFieldName, value: string | null): string | null {
  if (!value) return null;
  // A salary without any number ("Competitive") is not a salary.
  if (name === "salary") return /\d/.test(value) ? value : null;
  if (name === "deadline") return deadlineDate(value);
  return value;
}

/**
 * Read the optional fields a recipe has rules for. Missing, overlong or ambiguous values become
 * null; they never fail the posting and are never guessed.
 */
export function extractExtraFields(input: {
  document: Document;
  /** The JobPosting data when the page has one (JSON-LD or microdata). */
  posting: Record<string, unknown> | null;
  fields: DetailFields | undefined;
}): Partial<Record<ExtraFieldName, string | null>> {
  const result: Partial<Record<ExtraFieldName, string | null>> = {};
  if (!input.fields) return result;
  for (const name of EXTRA_FIELD_NAMES) {
    const rule = input.fields[name];
    if (rule) result[name] = validate(name, readRule(name, rule, input.document, input.posting));
  }
  return result;
}
