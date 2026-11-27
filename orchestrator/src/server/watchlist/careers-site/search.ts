import { badRequest } from "@infra/errors";
import { JSDOM } from "jsdom";
import { parseListingFacets, usableKey } from "../autofilter/facets/careers-site";
import type { Facets } from "../autofilter/types";
import { tryParseSafeHttpsUrl } from "../adapters/url";
import { roleField } from "../control-roles";
import { collapseText, sameUrlPath } from "./normalize";
import { detectQueryPagination, jobId } from "./run-recipe";
import type { Recipe, RecipeSearch, SearchParam } from "./types";

/** What a user typed or picked, per control key. Lives in the user's own source URL only. */
export type SearchValues = Record<string, string[]>;

const MAX_TEXT_LENGTH = 120;
const MAX_CHOICES = 10;
const MAX_URL_LENGTH = 500;
// Words that are only useful as a sample keyword when they can tell two postings apart.
const MIN_KEYWORD_LENGTH = 5;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** A recipe's search controls only describe the listing path they were learned on. */
export function sameListingPath(search: RecipeSearch, careersUrl: string): boolean {
  return sameUrlPath(search.url, careersUrl);
}

/**
 * Build the listing URL for a set of user values, entirely from the verified controls. Values for
 * managed keys (controls and the pager) are replaced, cleared controls are removed, and every
 * other query parameter of the verified listing is kept.
 */
export function buildSearchUrl(
  search: RecipeSearch,
  values: SearchValues,
  /** A URL the user already has: its query parameters that are not controls (set by the Suggest panel, say) are kept. */
  carryFrom?: string,
): string {
  const controls = new Map(search.params.map((param) => [param.key, param]));
  for (const key of Object.keys(values)) {
    if (!controls.has(key)) throw badRequest("Unknown search control.");
  }
  const url = new URL(search.url);
  url.hash = "";
  for (const key of controls.keys()) url.searchParams.delete(key);
  if (search.pagination.kind === "query") url.searchParams.delete(search.pagination.param);
  for (const param of search.params) {
    const given = (values[param.key] ?? []).map((value) => value.trim()).filter(Boolean);
    if (!given.length) continue;
    let chosen: string[];
    if (param.input.kind === "text") {
      chosen = [...new Set(given)];
      if (chosen.some((text) => text.length > MAX_TEXT_LENGTH || hasControlCharacter(text)))
        throw badRequest("Search text is too long or contains control characters.");
    } else {
      const allowed = new Set(param.input.options.map((option) => option.value));
      chosen = [...new Set(given)];
      if (chosen.some((value) => !allowed.has(value))) throw badRequest("Choose an offered value.");
    }
    const several = param.input.kind === "text" ? param.input.multiple === true : true;
    if (param.encoding === "single" || !several ? chosen.length > 1 : chosen.length > MAX_CHOICES)
      throw badRequest("Too many values for this search control.");
    if (param.encoding === "comma") {
      if (chosen.some((value) => value.includes(",")))
        throw badRequest("This search control cannot take a value with a comma.");
      url.searchParams.set(param.key, chosen.join(","));
    } else for (const value of chosen) url.searchParams.append(param.key, value);
  }
  if (carryFrom) {
    const fixed = new Set(url.searchParams.keys());
    const managed = new Set(controls.keys());
    if (search.pagination.kind === "query") managed.add(search.pagination.param);
    for (const [key, value] of new URL(carryFrom).searchParams) {
      if (!managed.has(key) && !fixed.has(key)) url.searchParams.append(key, value);
    }
  }
  url.searchParams.sort();
  if (url.href.length > 2000) throw badRequest("Search is too long.");
  return url.href;
}

/** The inverse of `buildSearchUrl`: which control values a saved source URL already carries. */
export function readSearchValues(search: RecipeSearch, careersUrl: string): SearchValues {
  const url = new URL(careersUrl);
  const values: SearchValues = {};
  for (const param of search.params) {
    let read = url.searchParams.getAll(param.key);
    if (param.encoding === "comma") read = read.flatMap((value) => value.split(","));
    read = read.map((value) => value.trim()).filter(Boolean);
    if (param.input.kind === "text" && !param.input.multiple) read = read.slice(0, 1);
    if (read.length) values[param.key] = read;
  }
  return values;
}

/** Candidate controls found in static listing HTML. Nothing here is trusted until verified. */
export function discoverSearchParams(html: string, pageUrl: string): SearchParam[] {
  const candidates = new Map<string, SearchParam>();
  const labels = new Map<string, Map<string, string>>();
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    for (const select of document.querySelectorAll("select[name]")) {
      const key = select.getAttribute("name") ?? "";
      const byValue = labels.get(key) ?? new Map<string, string>();
      for (const option of select.querySelectorAll("option[value]")) {
        const label = collapseText(option.textContent, 120);
        if (label) byValue.set(option.getAttribute("value") ?? "", label);
      }
      labels.set(key, byValue);
    }
    for (const input of document.querySelectorAll("input[name]")) {
      const type = (input.getAttribute("type") ?? "text").toLowerCase();
      const form = input.closest("form");
      const method = (form?.getAttribute("method") ?? "get").toLowerCase();
      const key = input.getAttribute("name") ?? "";
      if ((type !== "search" && type !== "text") || method !== "get" || !usableKey(key)) continue;
      if (input.hasAttribute("disabled") || candidates.has(key)) continue;
      const id = input.getAttribute("id");
      const labelled = id
        ? Array.from(document.querySelectorAll("label[for]")).find(
            (label) => label.getAttribute("for") === id,
          )
        : undefined;
      const label = collapseText(
        input.getAttribute("aria-label") ??
          input.getAttribute("placeholder") ??
          labelled?.textContent,
        80,
      );
      candidates.set(key, {
        key,
        ...(label ? { label } : {}),
        ...roleField({ key, label: label ?? undefined }),
        input: { kind: "text" },
        encoding: "single",
      });
    }
  } finally {
    dom.window.close();
  }
  for (const facet of parseListingFacets(html, pageUrl).params) {
    // A single value is not a choice, and a text input of the same name wins.
    if (!facet.values || facet.values.length < 2 || candidates.has(facet.key)) continue;
    const byValue = labels.get(facet.key);
    candidates.set(facet.key, {
      key: facet.key,
      ...roleField({ key: facet.key }),
      input: {
        kind: "choice",
        options: facet.values.slice(0, 100).map(({ value }) => {
          const label = byValue?.get(value);
          return label && label !== value ? { value, label } : { value };
        }),
      },
      encoding: facet.multi ? "repeat" : "single",
    });
  }
  return [...candidates.values()];
}

/** Job ids and link texts a listing page offers, judged by the recipe's own job URL rules. */
export function readListingLinks(html: string, pageUrl: string, recipe: Recipe) {
  const pattern = new RegExp(recipe.jobUrlPattern);
  const base = tryParseSafeHttpsUrl(pageUrl);
  const ids = new Set<string>();
  const titles: string[] = [];
  const hrefs: string[] = [];
  if (!base) return { ids, titles, hrefs };
  const dom = new JSDOM(html);
  try {
    for (const anchor of dom.window.document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      hrefs.push(href);
      const url = tryParseSafeHttpsUrl(href, base);
      if (!url || url.host !== base.host) continue;
      url.hash = "";
      if (url.href.length > MAX_URL_LENGTH || !pattern.test(url.href)) continue;
      ids.add(jobId(url.href, recipe) || url.href);
      const title = collapseText(anchor.textContent, 160);
      if (title) titles.push(title);
    }
  } finally {
    dom.window.close();
  }
  return { ids, titles, hrefs };
}

/** A word that appears in some listed titles but not all, so a keyword filter must change the list. */
function sampleKeyword(titles: string[]): string | null {
  const unique = [...new Set(titles)];
  const counts = new Map<string, number>();
  for (const title of unique) {
    for (const word of new Set(title.toLowerCase().match(/[a-z]+/g) ?? [])) {
      if (word.length >= MIN_KEYWORD_LENGTH) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const words = [...counts].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const distinguishing = words.find(([, count]) => unique.length < 2 || count < unique.length);
  return distinguishing?.[0] ?? null;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function sampleChoice(param: SearchParam): string | null {
  if (param.input.kind !== "choice") return null;
  // Options arrive ranked by how many postings they match; prefer a narrow one that is not empty.
  const options = param.input.options.filter(
    (option) => !/^(?:all|any|-?1|0)?$/i.test(option.value),
  );
  return options.at(-1)?.value ?? null;
}

function priority(param: SearchParam): number {
  if (param.input.kind === "text")
    return /search|keyword|query|^q$|term|text/i.test(param.key) ? 0 : 2;
  return 1;
}

export interface VerifySearchInput {
  recipe: Recipe;
  /** The public listing the controls were read from, without a query. */
  listingUrl: string;
  baseline: { html: string; url: string };
  candidates: SearchParam[];
  render: boolean;
  waitFor?: string;
  /** Loads one same-host listing page with the caller's budget, robots and rendering rules. */
  load: (url: string) => Promise<{ html: string; url: string } | null>;
  /** Upper bound for `load` calls, including the pagination check. */
  maxLoads: number;
}

/**
 * Keep only controls whose effect is observable: filtering must return postings, and change which
 * postings are returned. A control the site silently ignores is dropped. Pagination is accepted
 * only if page two still carries the filter and shows postings page one did not.
 */
export async function verifySearch(input: VerifySearchInput): Promise<RecipeSearch | null> {
  const baseline = readListingLinks(input.baseline.html, input.baseline.url, input.recipe);
  if (!baseline.ids.size) return null;
  const keyword = sampleKeyword(baseline.titles);
  const provisional = (param: SearchParam): RecipeSearch => ({
    url: input.listingUrl,
    params: [param],
    pagination: { kind: "none" },
    maxPages: 1,
    render: input.render,
    ...(input.waitFor ? { waitFor: input.waitFor } : {}),
  });
  const verified: SearchParam[] = [];
  let firstEvidence: { url: string; html: string; ids: Set<string> } | null = null;
  let loads = 0;
  const ordered = [...input.candidates].sort((a, b) => priority(a) - priority(b));
  for (const param of ordered) {
    if (loads >= input.maxLoads - 1) break;
    const sample = param.input.kind === "text" ? keyword : sampleChoice(param);
    if (!sample) continue;
    let url: string;
    try {
      url = buildSearchUrl(provisional(param), { [param.key]: [sample] });
    } catch {
      continue;
    }
    loads++;
    const page = await input.load(url);
    if (!page) continue;
    const found = readListingLinks(page.html, page.url, input.recipe);
    if (!found.ids.size || sameSet(found.ids, baseline.ids)) continue;
    verified.push(param);
    firstEvidence ??= { url: page.url, html: page.html, ids: found.ids };
  }
  if (!verified.length || !firstEvidence) return null;

  let pagination: RecipeSearch["pagination"] = { kind: "none" };
  let maxPages = 1;
  const detected = detectQueryPagination(
    readListingLinks(firstEvidence.html, firstEvidence.url, input.recipe).hrefs,
    firstEvidence.url,
    firstEvidence.html,
    true,
  );
  if (detected && loads < input.maxLoads) {
    const next = new URL(firstEvidence.url);
    next.searchParams.set(detected.param, String(detected.start + detected.step));
    const page = await input.load(next.href);
    const second = page ? readListingLinks(page.html, page.url, input.recipe) : null;
    if (second && [...second.ids].some((id) => !firstEvidence.ids.has(id))) {
      pagination = detected;
      maxPages = 5;
    }
  }
  return { ...provisional(verified[0]), params: verified, pagination, maxPages };
}

/**
 * The verified controls as the facet list Suggest Filters reasons over. Text controls become
 * free-text keys, so the model may place a job title in a board's keyword box. Only repeated
 * keys are offered as multi-select: the suggestion URL repeats keys and cannot comma-join.
 */
export function facetParamsFromSearch(search: RecipeSearch): Facets["params"] {
  return search.params.map((param) =>
    param.input.kind === "text"
      ? {
          key: param.key,
          ...roleField(param),
          multi: param.input.multiple === true && param.encoding === "repeat",
          freeText: true as const,
        }
      : {
          key: param.key,
          ...roleField(param),
          multi: param.encoding === "repeat",
          values: param.input.options.map(({ value }) => ({ value })),
        },
  );
}
