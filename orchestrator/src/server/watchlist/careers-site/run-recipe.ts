import { asyncPool } from "@server/utils/async-pool";
import { getFreshMapEntry, setBoundedMapEntry } from "../adapters/common";
import { extractBalancedJson, extractJsonLdObjects, findJsonLdJobPostings } from "../adapters/html";
import { createBudgetSignal } from "../adapters/http";
import { tryParseSafeHttpsUrl } from "../adapters/url";
import { JSDOM } from "jsdom";
import { extractExtraFields } from "./fields";
import { isAllowedByRobots, loadPage } from "./fetch";
import { isoDate, jobLocation, record, sameUrlPath, text } from "./normalize";
import { type CrawledJob, detailRenders, type Recipe, SiteBlockedError } from "./types";

const MAX_URL_LENGTH = 500;
const DETAIL_CACHE_TTL_MS = 24 * 60 * 60_000;
const DETAIL_CACHE_MAX_ENTRIES = 2_000;
// Explicitly global: only public job details, keyed by their full URL (including
// query), never tenant settings or credentials. ponytail: In-memory, lost on restart.
const ROBOTS_DISALLOWED_URL = "robots.txt disallows this URL";
const detailCache = new Map<string, { job: CrawledJob; expires: number; extraction: string }>();

export function jobId(url: string, recipe: Recipe): string | undefined {
  return url.length <= MAX_URL_LENGTH && recipe.jobIdPattern
    ? new RegExp(recipe.jobIdPattern).exec(url)?.[1]
    : undefined;
}

function sameSite(value: string, base: string): string | null {
  const baseUrl = tryParseSafeHttpsUrl(base);
  const url = baseUrl ? tryParseSafeHttpsUrl(value, baseUrl) : null;
  if (!url || !baseUrl || url.host !== baseUrl.host) return null;
  url.hash = "";
  return url.href;
}

// Bound scanning before parsing: page content is untrusted and may contain many
// incomplete assignments. Only inspect the first assignment, once.
export function facetConfig(html: string | undefined): string | null {
  if (!html) return null;
  const marker = html.indexOf("FWP_JSON");
  if (marker < 0) return null;
  const assignment = html.slice(marker + 8, marker + 8 + 100_000);
  const start = /^\s*=\s*\{/.exec(assignment);
  if (!start) return null;
  return extractBalancedJson(assignment, start[0].length - 1, "{");
}

// Pager names seen on real boards: page/_paged, offset/skip (Amazon, SmartRecruiters), and start
// (Eightfold). The wider list is only trusted where the learner verifies the second page.
const COMMON_PAGER = /^(?:_?paged?|offset|skip)$/i;
const VERIFIED_PAGER =
  /^(?:_?paged?|offset|skip|start|from|pg|page_?(?:num|number|no|index)|pagenum(?:ber)?|pageno|pageindex)$/i;
const ZERO_BASED_PAGER = /^(?:offset|skip|start|from|page_?index|pageindex)$/i;

/** Infer query pagination from same-path links or public FacetWP pager metadata. */
export function detectQueryPagination(
  values: string[],
  base: string,
  html?: string,
  /** Also accept less common pager names. Only for callers that verify page two shows new postings. */
  verified = false,
) {
  const first = new URL(base);
  // FacetWP server-renders jobs but serializes its pager as JSON, without hrefs.
  // Read the public configuration as data; never execute page scripts.
  const config = facetConfig(html);
  if (config) {
    try {
      const data = record(JSON.parse(config));
      const pager = record(record(record(data.preload_data).settings).pager);
      if (
        typeof data.prefix === "string" &&
        /^[_a-z-]{0,20}$/i.test(data.prefix) &&
        Number.isSafeInteger(pager.page) &&
        Number(pager.page) >= 1 &&
        Number.isSafeInteger(pager.total_pages) &&
        Number(pager.total_pages) > Number(pager.page)
      ) {
        return {
          kind: "query" as const,
          param: `${data.prefix}paged`,
          start: Number(pager.page),
          step: 1,
        };
      }
    } catch {
      // Malformed pagination metadata does not hide ordinary pagination links.
    }
  }
  const detected: {
    kind: "query";
    param: string;
    start: number;
    step: number;
  }[] = [];
  for (const value of values) {
    const href = sameSite(value, base);
    if (!href) continue;
    const next = new URL(href);
    if (next.pathname !== first.pathname) continue;
    const keys = new Set([...first.searchParams.keys(), ...next.searchParams.keys()]);
    const changed = [...keys].filter(
      (key) => first.searchParams.getAll(key).join() !== next.searchParams.getAll(key).join(),
    );
    if (changed.length !== 1 || !(verified ? VERIFIED_PAGER : COMMON_PAGER).test(changed[0]))
      continue;
    const param = changed[0];
    const raw = next.searchParams.get(param);
    if (!raw || !/^\d+$/.test(raw)) continue;
    const start = Number(first.searchParams.get(param) ?? (ZERO_BASED_PAGER.test(param) ? 0 : 1));
    const end = Number(raw);
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start)
      detected.push({ kind: "query", param, start, step: end - start });
  }
  return detected.sort((a, b) => a.step - b.step)[0] ?? null;
}

// Read nested microdata scopes (Place -> PostalAddress, Organization, etc.).
function microdata(scope: Element): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const element of scope.querySelectorAll("[itemprop]")) {
    if (element.parentElement?.closest("[itemscope]") !== scope) continue;
    const value = element.hasAttribute("itemscope")
      ? microdata(element)
      : (element.getAttribute("content") ??
        element.getAttribute("datetime") ??
        (element.getAttribute("itemprop") === "description"
          ? element.innerHTML
          : element.textContent?.trim()));
    for (const key of (element.getAttribute("itemprop") ?? "").split(/\s+/)) {
      if (!key) continue;
      const previous = result[key];
      result[key] =
        previous === undefined
          ? value
          : Array.isArray(previous)
            ? [...previous, value]
            : [previous, value];
    }
  }
  return result;
}

/** Parse one job page per recipe.detail. Returns null for missing jobs, invalid selectors, or overlong URLs. */
export function extractJob(html: string, url: string, recipe: Recipe): CrawledJob | null {
  if (url.length > MAX_URL_LENGTH) return null;
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    let data: Record<string, unknown> | null = null;
    let fromJsonLd = false;
    // Only structured JobPosting data can answer a `jobPosting` field rule.
    let posting: Record<string, unknown> | null = null;
    if (recipe.detail.kind === "selectors") {
      const detail = recipe.detail;
      data = {
        title: document.querySelector(detail.title)?.textContent,
        description: document.querySelector(detail.description)?.innerHTML,
        jobLocation: detail.location ? document.querySelector(detail.location)?.textContent : null,
        datePosted: detail.postedAt
          ? (() => {
              const node = document.querySelector(detail.postedAt);
              return (
                node?.getAttribute("datetime") ?? node?.getAttribute("content") ?? node?.textContent
              );
            })()
          : null,
      };
    } else {
      for (const candidate of findJsonLdJobPostings(extractJsonLdObjects(html))) {
        if (text(candidate.title) && text(candidate.description)) {
          data = candidate;
          fromJsonLd = true;
          break;
        }
      }
      if (!data) {
        for (const scope of document.querySelectorAll("[itemscope][itemtype]")) {
          if (
            scope
              .getAttribute("itemtype")
              ?.split(/\s+/)
              .some((type) => /^https?:\/\/schema\.org\/JobPosting\/?$/.test(type))
          ) {
            const candidate = microdata(scope);
            if (text(candidate.title) && text(candidate.description)) {
              data = candidate;
              break;
            }
          }
        }
      }
    }
    if (!data || !text(data.title) || !text(data.description)) return null;
    if (recipe.detail.kind === "jsonld") posting = data;
    const decode = (value: string | null): string | null => {
      if (value === null || !fromJsonLd) return value;
      const node = document.createElement("textarea");
      // Escape literal markup while leaving character references for HTML decoding.
      node.innerHTML = value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return node.value;
    };
    return {
      id: jobId(url, recipe) || url,
      url,
      title: decode(text(data.title)) as string,
      employer: decode(text(record(data.hiringOrganization).name) ?? text(data.hiringOrganization)),
      location: decode(jobLocation(data.jobLocation)),
      postedAt: isoDate(data.datePosted),
      descriptionHtml: text(data.description),
      // JSON-LD text may carry character references, like the title above.
      ...Object.fromEntries(
        Object.entries(extractExtraFields({ document, posting, fields: recipe.detail.fields })).map(
          ([name, value]) => [name, decode(value ?? null)],
        ),
      ),
    };
  } catch {
    return null;
  } finally {
    dom.window.close();
  }
}

/** Collect at most `limit` jobs, newest first where known. `stopAt` stops new loads; signal aborts still throw. */
export async function runRecipe(
  recipe: Recipe,
  options: {
    limit: number;
    signal?: AbortSignal;
    stopAt?: number;
    /** Filtered sources override the host recipe listing for this run only. */
    sourceUrl?: string;
    /** Validate learned recipes against fresh pages instead of cached details. */
    bypassCache?: boolean;
  },
): Promise<CrawledJob[]> {
  const { signal, stopAt } = options;
  const stopped = () => stopAt !== undefined && Date.now() >= stopAt;
  signal?.throwIfAborted();
  const limit = Math.max(0, Math.floor(options.limit));
  if (!Number.isFinite(limit) || !limit) return [];
  // Let in-flight pages finish briefly, then preserve jobs before the hard abort.
  const loadSignal =
    stopAt === undefined
      ? signal
      : createBudgetSignal(signal, Math.max(0, stopAt - Date.now()) + 3_000);
  const pattern = new RegExp(recipe.jobUrlPattern);
  const filtered =
    options.sourceUrl && new URL(options.sourceUrl).search
      ? sameSite(options.sourceUrl, recipe.listing.url)
      : null;
  if (options.sourceUrl && new URL(options.sourceUrl).search && !filtered)
    throw new Error("Recipe URL must use the same HTTPS host.");
  const base = filtered || recipe.listing.url;
  const candidates = new Map<string, number>();
  async function read(url: string, render = false, waitFor?: string) {
    signal?.throwIfAborted();
    if (stopped()) return null;
    if (!sameSite(url, base)) throw new Error("Recipe URL must use the same HTTPS host.");
    if (!(await isAllowedByRobots(url, { signal: loadSignal })))
      throw new SiteBlockedError(new URL(url).hostname, ROBOTS_DISALLOWED_URL);
    signal?.throwIfAborted();
    if (stopped()) return null;
    const page = await loadPage(url, { render, waitFor, signal: loadSignal });
    signal?.throwIfAborted();
    if (page.status === 403 || page.status === 406)
      throw new SiteBlockedError(new URL(url).hostname, `HTTP ${page.status}`);
    if (page.status < 200 || page.status >= 300 || !sameSite(page.url, base))
      throw new Error("Careers page could not be loaded.");
    return page;
  }
  function add(value: string, modified = 0, relativeTo = base) {
    if (value.length > MAX_URL_LENGTH) return;
    const url = sameSite(value, relativeTo);
    if (url && url.length <= MAX_URL_LENGTH && sameSite(url, base) && pattern.test(url))
      candidates.set(url, Math.max(candidates.get(url) ?? 0, modified));
  }
  function rethrowFatal(error: unknown) {
    signal?.throwIfAborted();
    if (error instanceof SiteBlockedError) throw error;
  }
  if (!filtered && recipe.listing.kind === "sitemap") {
    const visited = new Set<string>();
    async function sitemap(url: string, depth: number): Promise<void> {
      if (stopped() || visited.has(url) || visited.size >= 50) return;
      visited.add(url);
      const page = await read(url);
      if (!page) return;
      const dom = new JSDOM(page.html, { contentType: "text/xml" });
      try {
        const root = dom.window.document.documentElement;
        if (root.localName === "sitemapindex") {
          if (depth >= 2) return;
          let successes = 0;
          for (const entry of Array.from(root.children)) {
            if (stopped()) break;
            const loc = Array.from(entry.children).find(
              (child) => child.localName === "loc",
            )?.textContent;
            const childUrl = loc && sameSite(loc.trim(), page.url);
            if (!childUrl) continue;
            try {
              await sitemap(childUrl, depth + 1);
              successes++;
            } catch (error) {
              rethrowFatal(error);
            }
          }
          if (!successes && !stopped()) throw new Error("No careers sitemaps could be read.");
        } else if (root.localName === "urlset") {
          for (const entry of Array.from(root.children)) {
            const children = Array.from(entry.children);
            const loc = children.find((child) => child.localName === "loc")?.textContent;
            const lastmod = children.find((child) => child.localName === "lastmod")?.textContent;
            if (loc) add(loc.trim(), lastmod ? Date.parse(lastmod) || 0 : 0, page.url);
          }
        } else throw new Error("Invalid careers sitemap.");
      } finally {
        dom.window.close();
      }
    }
    await sitemap(base, 0);
  } else {
    const listing = recipe.listing;
    // A verified search description wins over the host listing for a filtered source: the
    // listing's rendering and pager describe the unfiltered page, not the search results.
    // Search settings describe the listing path they were learned on; another path keeps the page listing.
    const search =
      filtered && recipe.search && sameUrlPath(recipe.search.url, filtered)
        ? recipe.search
        : undefined;
    const verifiedPager = search?.pagination.kind === "query";
    const render = search ? search.render : listing.kind === "page" && listing.render;
    const waitFor = search ? search.waitFor : listing.kind === "page" ? listing.waitFor : undefined;
    let pagination = search
      ? search.pagination
      : listing.kind === "page"
        ? listing.pagination
        : { kind: "none" as const };
    // A verified pager bounds the walk; without one the old filtered behaviour stays (detect on page
    // one, up to 10 pages), because "not verified" usually means the sample had only one page.
    const maxPages =
      search && verifiedPager
        ? Math.min(10, search.maxPages)
        : filtered
          ? 10
          : listing.kind === "page"
            ? Math.min(10, listing.maxPages)
            : 1;
    const candidateIds = new Set<string>();
    let successes = 0;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      if (stopped()) break;
      const url = new URL(base);
      // The filtered source itself is page one; preserve all of its query params.
      if (pagination.kind === "query" && (!filtered || pageIndex))
        url.searchParams.set(
          pagination.param,
          String(pagination.start + pageIndex * pagination.step),
        );
      else if (pageIndex) break;
      try {
        const page = await read(url.href, render, waitFor);
        if (!page) break;
        const before = candidateIds.size;
        const dom = new JSDOM(page.html);
        try {
          const links = Array.from(
            dom.window.document.querySelectorAll("a[href]"),
            (link) => link.getAttribute("href") ?? "",
          );
          for (const link of links) add(link, 0, page.url);
          for (const candidate of candidates.keys())
            candidateIds.add(jobId(candidate, recipe) || candidate);
          if (filtered && !pageIndex && !verifiedPager)
            pagination = detectQueryPagination(links, page.url, page.html) ?? {
              kind: "none",
            };
        } finally {
          dom.window.close();
        }
        successes++;
        if (
          (filtered ? candidateIds.size : candidates.size) >= limit ||
          (filtered && candidateIds.size === before)
        )
          break;
      } catch (error) {
        rethrowFatal(error);
      }
    }
    if (!successes) throw new Error("No careers listing pages could be read.");
  }
  function numericId(url: string): bigint | null {
    const id = recipe.jobIdPattern
      ? jobId(url, recipe)
      : new URL(url).pathname.match(/\d{5,}/g)?.at(-1);
    return id && /^\d+$/.test(id) ? BigInt(id) : null;
  }
  if (filtered) {
    const ids = new Set<string>();
    for (const url of candidates.keys()) {
      const id = jobId(url, recipe) || url;
      if (ids.has(id)) candidates.delete(url);
      else ids.add(id);
    }
  }
  const selected = [...candidates]
    .map(([url, modified]) => ({
      url,
      day: modified ? Math.floor(modified / 86_400_000) : null,
      id: !filtered && recipe.listing.kind === "sitemap" ? numericId(url) : null,
    }))
    .sort((a, b) => {
      if (a.day !== b.day) {
        if (a.day === null) return 1;
        if (b.day === null) return -1;
        return b.day - a.day;
      }
      if (a.id === b.id) return 0;
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return a.id > b.id ? -1 : 1;
    })
    .slice(0, limit)
    .map(({ url }) => [url] as const);
  const jobs = new Map<string, CrawledJob>();
  const seenIds = new Set<string>();
  const extraction = JSON.stringify([recipe.detail, recipe.jobIdPattern]);
  function collect(url: string, job: CrawledJob) {
    if (seenIds.has(job.id)) return;
    seenIds.add(job.id);
    jobs.set(url, { ...job });
  }
  // Collect all cached candidates before spending the remaining budget on misses.
  for (const [url] of selected) {
    const entry = options.bypassCache ? undefined : getFreshMapEntry(detailCache, url);
    if (!entry) continue;
    if (entry.extraction !== extraction) {
      detailCache.delete(url);
      continue;
    }
    collect(url, entry.job);
  }
  let completed = 0;
  let fresh = 0;
  await asyncPool({
    items: selected,
    concurrency: 3,
    shouldStop: () => stopped(),
    task: async ([url]) => {
      if (jobs.has(url)) return;
      try {
        const page = await read(url, detailRenders(recipe), recipe.detail.waitFor);
        if (!page) return;
        completed++;
        const job = extractJob(page.html, page.url, recipe);
        if (job) {
          fresh++;
          job.id = jobId(url, recipe) || jobId(page.url, recipe) || url;
          setBoundedMapEntry(
            detailCache,
            url,
            {
              job: { ...job },
              expires: Date.now() + DETAIL_CACHE_TTL_MS,
              extraction,
            },
            DETAIL_CACHE_MAX_ENTRIES,
          );
          collect(url, job);
        }
      } catch (error) {
        // A robots rule on one posting must not block the whole host; skip that posting.
        if (error instanceof SiteBlockedError && error.reason === ROBOTS_DISALLOWED_URL) return;
        rethrowFatal(error);
      }
    },
  });
  signal?.throwIfAborted();
  if ((selected.length && !jobs.size) || (completed > 0 && fresh === 0))
    throw new Error("All selected careers job pages failed or contained no job.");
  return selected.flatMap(([url]) => {
    const job = jobs.get(url);
    return job ? [job] : [];
  });
}
