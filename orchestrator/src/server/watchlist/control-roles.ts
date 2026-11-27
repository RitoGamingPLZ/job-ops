import { WATCHLIST_CONTROL_ROLES, type WatchlistControlRole } from "@shared/types";

function tokens(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const WORKPLACE = ["remote", "workplace", "arrangement", "hybrid", "onsite", "worktype"];
const EMPLOYMENT = [
  "employment",
  "jobtype",
  "timetype",
  "commitment",
  "contracttype",
  "positiontype",
  "schedule",
];
const LOCATION = ["location", "loc", "city", "region", "country", "state", "office", "geo"];
const LEVEL = ["level", "seniority", "experience", "grade"];
const DEPARTMENT = [
  "team",
  "department",
  "dept",
  "function",
  "discipline",
  "category",
  "organization",
  "businessunit",
];
const KEYWORD = ["q", "query", "keyword", "search", "term", "text", "kw"];

/**
 * Guess what a filter means from its name, so boards that name the same thing differently share one
 * vocabulary. Order matters: the more specific meanings are tested first ("Work Type" is a
 * workplace choice on Eightfold, "time_type" an employment type on Workday, `location_search` is
 * still a location). Unknown names return undefined; a wrong guess is worse than none.
 */
export function inferControlRole(key: string, label?: string): WatchlistControlRole | undefined {
  for (const name of label ? [key, label] : [key]) {
    const words = tokens(name).map((word) => word.replace(/ies$/, "y").replace(/s$/, ""));
    const compact = words.join("");
    const has = (list: string[]) =>
      list.some((entry) => (entry.length <= 3 ? words.includes(entry) : compact.includes(entry)));
    // Short generic words only count as whole words: "text" must not match "context".
    const hasWord = (list: string[]) => words.some((word) => list.includes(word));
    if (has(WORKPLACE)) return "workplace";
    if (has(EMPLOYMENT)) return "employmentType";
    if (has(LOCATION)) return "location";
    if (has(LEVEL)) return "level";
    if (has(DEPARTMENT)) return "department";
    if (hasWord(KEYWORD)) return "keyword";
  }
  return undefined;
}

/** A control's role: the one recorded when it was learned, else a guess from its name. */
export function roleOf(param: {
  key: string;
  label?: string;
  role?: WatchlistControlRole;
}): WatchlistControlRole | undefined {
  return param.role ?? inferControlRole(param.key, param.label);
}

/** `{ role }` when one is known, so optional spreads stay free of `role: undefined`. */
export function roleField(param: { key: string; label?: string; role?: WatchlistControlRole }): {
  role?: WatchlistControlRole;
} {
  const role = roleOf(param);
  return role ? { role } : {};
}

/** Display order of a role: the shared vocabulary's order, unknown roles last (sorts are stable). */
export function roleRank(role: WatchlistControlRole | undefined): number {
  const index = role ? WATCHLIST_CONTROL_ROLES.indexOf(role) : -1;
  return index < 0 ? WATCHLIST_CONTROL_ROLES.length : index;
}
