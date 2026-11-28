import { JSDOM } from "jsdom";

/**
 * Evidence about how many postings a careers listing really exposes. A recipe is shared by every
 * user of the host, so one that sees a single posting of hundreds would quietly serve a near-empty
 * watchlist to everyone. The learner uses these helpers to build patterns from the whole posting
 * set and to reject recipes that look under-fitted.
 */

/** Fewest postings a listing should expose before a recipe is trusted without other evidence. */
export const MIN_POSTINGS = 5;

// A segment that names the posting collection. `careers` alone is too generic to prefer: a
// `/careers/` prefix also holds team, benefit and culture pages.
const SPECIFIC_SEGMENT =
  /^(?:jobs?|positions?|openings?|vacanc(?:y|ies)|opportunit(?:y|ies)|roles?)$/i;
const GENERIC_SEGMENT = /^careers?$/i;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastMatch(parts: string[], pattern: RegExp): number {
  for (let index = parts.length - 1; index >= 0; index--) {
    if (pattern.test(parts[index])) return index;
  }
  return -1;
}

/**
 * The directory shared by every posting URL, found from the segment that names the collection:
 * `/us/en/job/` for `/us/en/job/R123/Engineer`. Using the posting's own parent directory instead
 * would fit one posting when each lives in a directory named after its id.
 */
export function jobPathPrefix(pathname: string): string | null {
  const directories = pathname.split("/").filter(Boolean).slice(0, -1);
  let index = lastMatch(directories, SPECIFIC_SEGMENT);
  if (index < 0) index = lastMatch(directories, GENERIC_SEGMENT);
  return index < 0 ? null : `/${directories.slice(0, index + 1).join("/")}/`;
}

function tailDepth(pathname: string, prefix: string): number {
  return pathname.slice(prefix.length).split("/").filter(Boolean).length;
}

/**
 * An anchored pattern for posting URLs below `prefix`. It allows the path depths that carry a real
 * share of the sitemap (Plaid nests postings two or three levels deep) and nothing shallower, so a
 * department index page next to the postings is not mistaken for one.
 */
export function postingPattern(
  origin: string,
  prefix: string,
  sampleUrl: string,
  sitemapUrls: string[],
): string {
  const sampleDepth = tailDepth(new URL(sampleUrl).pathname, prefix);
  const depths = new Map<number, number>();
  let total = 0;
  for (const value of sitemapUrls) {
    let pathname: string;
    try {
      pathname = new URL(value).pathname;
    } catch {
      continue;
    }
    if (!pathname.startsWith(prefix)) continue;
    const depth = tailDepth(pathname, prefix);
    if (!depth) continue;
    depths.set(depth, (depths.get(depth) ?? 0) + 1);
    total++;
  }
  const kept = [...depths]
    .filter(([depth, count]) => depth === sampleDepth || count / total >= 0.2)
    .map(([depth]) => depth)
    .sort((a, b) => a - b);
  const low = kept[0] ?? sampleDepth;
  const high = Math.max(Math.min(kept.at(-1) ?? sampleDepth, low + 2), sampleDepth);
  const segment = "[^/?#]+";
  const required = Array.from({ length: low }, () => segment).join("/");
  const optional = high > low ? `(?:/${segment}){0,${high - low}}` : "";
  return `^${escapeRegex(origin + prefix)}${required}${optional}/?$`;
}

// Controls that reveal more postings on the same listing: a next link or a load-more button.
const MORE_CONTROL = /^(?:next(?: page)?|more|(?:load|show|view|see) more|older|[›»>]+)$/i;
// Links to the page that actually lists the postings, rather than a marketing landing page.
const LISTING_LINK =
  /(?:search|find|browse|explore)[\s_-]*(?:results|jobs|roles|openings|positions)|(?:all|view|see)[\s_-]*(?:all[\s_-]*)?(?:jobs|roles|openings|positions)|open[\s_-]*(?:positions|roles|jobs)|current[\s_-]*openings|job[\s_-]*search/i;

export interface ListingHints {
  /** The page offers a next link or a load-more control, so more postings sit behind it. */
  more: boolean;
  /** Other pages on the host that look like the real posting listing, best guess first. */
  alternatives: string[];
}

/** Read the signs that a listing page shows only some of the postings. `own` keeps URLs on the host. */
export function readListingHints(
  html: string,
  pageUrl: string,
  own: (url: string) => string | null,
): ListingHints {
  const dom = new JSDOM(html);
  try {
    const { document } = dom.window;
    const normalized = (node: Element) => (node.textContent ?? "").replace(/\s+/g, " ").trim();
    const more =
      document.querySelector('a[rel~="next"], link[rel~="next"]') !== null ||
      Array.from(document.querySelectorAll('a, button, [role="button"]')).some((node) =>
        MORE_CONTROL.test(normalized(node)),
      );
    const current = new URL(pageUrl);
    current.hash = "";
    const found = new Map<string, number>();
    for (const anchor of document.querySelectorAll("a[href]")) {
      let target: string | null;
      try {
        const url = new URL(anchor.getAttribute("href") ?? "", pageUrl);
        url.hash = "";
        target = own(url.href);
      } catch {
        continue;
      }
      if (!target || target === current.href) continue;
      const path = new URL(target).pathname;
      const rank = LISTING_LINK.test(path) ? 0 : LISTING_LINK.test(normalized(anchor)) ? 1 : -1;
      if (rank < 0) continue;
      found.set(target, Math.min(found.get(target) ?? rank, rank));
    }
    const alternatives = [...found]
      .sort(([a, rankA], [b, rankB]) => rankA - rankB || a.length - b.length)
      .map(([url]) => url)
      .slice(0, 3);
    return { more, alternatives };
  } finally {
    dom.window.close();
  }
}

/**
 * Recipes learned before the quality gate could fit a single posting and still look healthy, so
 * nothing ever relearned them. A recipe saved before this moment that returns fewer than
 * `MIN_POSTINGS` postings is relearned once in the background; the learner now vets the
 * replacement, and a recipe saved after this moment is never second-guessed this way. Remove it
 * once every host has been seen again.
 */
export const RECIPE_QUALITY_GATE_SHIPPED_AT = "2026-11-28T03:15:00.000Z";

/**
 * How long a pre-gate recipe must have been stored before it is relearned. A relearn replaces the
 * recipe at once, but a finished crawl stays cached for minutes; without this the stale result
 * would keep re-triggering a relearn that already happened.
 */
export const RELEARN_MIN_AGE_MS = 10 * 60_000;

/** Whether a stored recipe predates the quality gate and returned too few postings to be trusted. */
export function shouldRelearnUnderfitRecipe(input: {
  learnedAt: string;
  postings: number;
  now?: number;
}): boolean {
  const age = (input.now ?? Date.now()) - Date.parse(input.learnedAt);
  return (
    input.postings < MIN_POSTINGS &&
    input.learnedAt < RECIPE_QUALITY_GATE_SHIPPED_AT &&
    age > RELEARN_MIN_AGE_MS
  );
}
