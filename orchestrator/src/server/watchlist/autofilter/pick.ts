import { roleRank } from "../control-roles";
import type { Facets, FilterIntent, FilterParam } from "./types";

type Facet = Facets["params"][number];

const MAX_MULTI = 5;
// Words that describe seniority, not what kind of work it is, so they must not pick a department.
const SENIORITY = new Set(["senior", "junior", "lead", "staff", "principal", "intern", "head"]);
const WORKPLACE_PATTERN: Record<FilterIntent["workplaceTypes"][number], RegExp> = {
  remote: /remote|work[\s_-]*from[\s_-]*home|anywhere/i,
  hybrid: /hybrid/i,
  onsite: /on[\s_-]*site|in[\s_-]*(?:the[\s_-]*)?office|office/i,
};

const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/** "Engineer", "Engineering" and "engineers" share one stem, so a title can find its department. */
const stem = (word: string) => word.slice(0, 6);
function stems(text: string): Set<string> {
  return new Set(
    squash(text)
      .split(" ")
      .filter((word) => word.length >= 3 && !SENIORITY.has(word))
      .map(stem),
  );
}

/** Whether an option names the wanted place: one contains the other ("Toronto, ON" ~ "Toronto"). */
function names(option: string, wanted: string): boolean {
  const [a, b] = [squash(option), squash(wanted)];
  return Boolean(a && b) && (a.includes(b) || (a.length >= 4 && b.includes(a)));
}

function values(facet: Facet): string[] {
  return facet.values?.map((entry) => entry.value) ?? [];
}

/** The options of a choice facet that satisfy `test`, best first, capped by how many it accepts. */
function pickOptions(facet: Facet, wanted: Array<(option: string) => boolean>): string[] {
  const chosen: string[] = [];
  for (const test of wanted) {
    const hit = values(facet).find((option) => test(option) && !chosen.includes(option));
    if (hit) chosen.push(hit);
  }
  return chosen.slice(0, facet.multi ? MAX_MULTI : 1);
}

/**
 * Fill a site's filters from the user's own saved search preferences, with no model: titles go in
 * the keyword box, country and cities in the location filter, workplace types in the workplace
 * filter, and a department the titles clearly belong to. Facets are matched by their role, so
 * boards that name the same filter differently are treated alike. Anything the preferences do not
 * speak to is left alone; narrowing too far is caught by the caller's result check.
 */
export function pickFiltersFromIntent(
  intent: FilterIntent,
  facets: Facets,
  /** The user's own note about the source ("platform team, backend"), extra words for a department. */
  description = "",
): { params: FilterParam[]; rationale: string } {
  const params: FilterParam[] = [];
  const said: string[] = [];
  const add = (facet: Facet, chosen: string[], label: string) => {
    if (!chosen.length || params.some((param) => param.key === facet.key)) return;
    params.push({ key: facet.key, values: chosen });
    said.push(`${label}: ${chosen.join(", ")}`);
  };
  const places = [...intent.cities, intent.country].map((place) => place.trim()).filter(Boolean);
  const title = intent.titles.map((entry) => entry.trim()).find(Boolean);
  const titleStems = stems([...intent.titles, description].join(" "));
  const used = new Set<string>();

  const ordered = [...facets.params].sort((a, b) => roleRank(a.role) - roleRank(b.role));
  for (const facet of ordered) {
    if (!facet.role || used.has(facet.role)) continue;
    if (facet.role === "keyword" && facet.freeText && title) {
      add(facet, [title.slice(0, 120)], "keyword");
      used.add("keyword");
    } else if (facet.role === "location" && places.length) {
      const chosen = facet.freeText
        ? places.slice(0, facet.multi ? 3 : 1)
        : pickOptions(
            facet,
            places.map((place) => (option: string) => names(option, place)),
          );
      add(facet, chosen, "location");
      if (chosen.length) used.add("location");
    } else if (facet.role === "workplace" && !facet.freeText) {
      // Wanting every kind of workplace (or none) is not a filter.
      const wanted = [...new Set(intent.workplaceTypes)];
      if (wanted.length && wanted.length < 3) {
        const chosen = pickOptions(
          facet,
          wanted.map((type) => (option: string) => WORKPLACE_PATTERN[type].test(option)),
        );
        add(facet, chosen, "workplace");
        if (chosen.length) used.add("workplace");
      }
    } else if (facet.role === "department" && !facet.freeText && titleStems.size) {
      const scored = values(facet)
        .map((option) => ({
          option,
          score: [...stems(option)].filter((word) => titleStems.has(word)).length,
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const chosen = scored.slice(0, facet.multi ? 3 : 1).map((entry) => entry.option);
      add(facet, chosen, "team");
      if (chosen.length) used.add("department");
    }
  }
  return {
    params,
    rationale: `Matched your saved search preferences (${said.join("; ")})`.slice(0, 300),
  };
}
