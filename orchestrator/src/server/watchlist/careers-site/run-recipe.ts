import { JSDOM } from "jsdom";
import { isAllowedByRobots, loadPage } from "./fetch";
import { type CrawledJob, type Recipe, SiteBlockedError } from "./types";

const MAX_URL_LENGTH = 500;

function jobId(url: string, recipe: Recipe): string | undefined {
  return url.length <= MAX_URL_LENGTH && recipe.jobIdPattern
    ? new RegExp(recipe.jobIdPattern).exec(url)?.[1]
    : undefined;
}

function sameSite(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (
      url.protocol !== "https:" ||
      url.hostname !== new URL(base).hostname ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function date(value: unknown): string | null {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw))
    ? new Date(raw).toISOString()
    : null;
}
function location(value: unknown): string | null {
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
function posting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = posting(entry);
      if (found) return found;
    }
    return null;
  }
  const data = record(value);
  const types = Array.isArray(data["@type"]) ? data["@type"] : [data["@type"]];
  if (
    types.includes("JobPosting") &&
    text(data.title) &&
    text(data.description)
  )
    return data;
  return data["@graph"] ? posting(data["@graph"]) : null;
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
export function extractJob(
  html: string,
  url: string,
  recipe: Recipe,
): CrawledJob | null {
  if (url.length > MAX_URL_LENGTH) return null;
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    let data: Record<string, unknown> | null = null;
    let fromJsonLd = false;
    if (recipe.detail.kind === "selectors") {
      const detail = recipe.detail;
      data = {
        title: document.querySelector(detail.title)?.textContent,
        description: document.querySelector(detail.description)?.innerHTML,
        jobLocation: detail.location
          ? document.querySelector(detail.location)?.textContent
          : null,
        datePosted: detail.postedAt
          ? (() => {
              const node = document.querySelector(detail.postedAt);
              return (
                node?.getAttribute("datetime") ??
                node?.getAttribute("content") ??
                node?.textContent
              );
            })()
          : null,
      };
    } else {
      for (const script of document.querySelectorAll(
        'script[type="application/ld+json"]',
      )) {
        try {
          data = posting(JSON.parse(script.textContent ?? ""));
        } catch {
          // Malformed unrelated structured data must not hide another posting.
        }
        if (data) {
          fromJsonLd = true;
          break;
        }
      }
      if (!data) {
        for (const scope of document.querySelectorAll(
          "[itemscope][itemtype]",
        )) {
          if (
            scope
              .getAttribute("itemtype")
              ?.split(/\s+/)
              .some((type) =>
                /^https?:\/\/schema\.org\/JobPosting\/?$/.test(type),
              )
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
      employer: decode(
        text(record(data.hiringOrganization).name) ??
          text(data.hiringOrganization),
      ),
      location: decode(location(data.jobLocation)),
      postedAt: date(data.datePosted),
      descriptionHtml: text(data.description),
    };
  } catch {
    return null;
  } finally {
    dom.window.close();
  }
}

/** Collect job links from recipe.listing, newest first where known, at most `limit`, then read each job page per recipe.detail. */
export async function runRecipe(
  recipe: Recipe,
  options: { limit: number; signal?: AbortSignal },
): Promise<CrawledJob[]> {
  const { signal } = options;
  signal?.throwIfAborted();
  const limit = Math.max(0, Math.floor(options.limit));
  if (!Number.isFinite(limit) || !limit) return [];
  const pattern = new RegExp(recipe.jobUrlPattern);
  const base = recipe.listing.url;
  const candidates = new Map<string, number>();
  async function read(url: string, render = false, waitFor?: string) {
    signal?.throwIfAborted();
    if (!sameSite(url, base))
      throw new Error("Recipe URL must use the same HTTPS host.");
    if (!(await isAllowedByRobots(url, { signal })))
      throw new SiteBlockedError(
        new URL(url).hostname,
        "robots.txt disallows this URL",
      );
    const page = await loadPage(url, { render, waitFor, signal });
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
    if (
      url &&
      url.length <= MAX_URL_LENGTH &&
      sameSite(url, base) &&
      pattern.test(url)
    )
      candidates.set(url, Math.max(candidates.get(url) ?? 0, modified));
  }
  function rethrowFatal(error: unknown) {
    signal?.throwIfAborted();
    if (error instanceof SiteBlockedError) throw error;
  }
  if (recipe.listing.kind === "sitemap") {
    const visited = new Set<string>();
    async function sitemap(url: string, depth: number): Promise<void> {
      if (visited.has(url) || visited.size >= 50) return;
      visited.add(url);
      const page = await read(url);
      const dom = new JSDOM(page.html, { contentType: "text/xml" });
      try {
        const root = dom.window.document.documentElement;
        if (root.localName === "sitemapindex") {
          if (depth >= 2) return;
          let successes = 0;
          for (const entry of Array.from(root.children)) {
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
          if (!successes) throw new Error("No careers sitemaps could be read.");
        } else if (root.localName === "urlset") {
          for (const entry of Array.from(root.children)) {
            const children = Array.from(entry.children);
            const loc = children.find(
              (child) => child.localName === "loc",
            )?.textContent;
            const lastmod = children.find(
              (child) => child.localName === "lastmod",
            )?.textContent;
            if (loc)
              add(loc.trim(), lastmod ? Date.parse(lastmod) || 0 : 0, page.url);
          }
        } else throw new Error("Invalid careers sitemap.");
      } finally {
        dom.window.close();
      }
    }
    await sitemap(base, 0);
  } else {
    const listing = recipe.listing;
    let successes = 0;
    for (let pageIndex = 0; pageIndex < listing.maxPages; pageIndex++) {
      const url = new URL(base);
      if (listing.pagination.kind === "query")
        url.searchParams.set(
          listing.pagination.param,
          String(
            listing.pagination.start + pageIndex * listing.pagination.step,
          ),
        );
      else if (pageIndex) break;
      try {
        const page = await read(url.href, listing.render, listing.waitFor);
        const dom = new JSDOM(page.html);
        try {
          for (const link of dom.window.document.querySelectorAll("a[href]"))
            add(link.getAttribute("href") ?? "", 0, page.url);
        } finally {
          dom.window.close();
        }
        successes++;
        if (candidates.size >= limit) break;
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
  const selected = [...candidates]
    .sort(([a, aModified], [b, bModified]) => {
      if (aModified || bModified) return bModified - aModified;
      if (recipe.listing.kind !== "sitemap") return 0;
      const aId = numericId(a);
      const bId = numericId(b);
      if (aId === bId) return 0;
      if (aId === null) return 1;
      if (bId === null) return -1;
      return aId > bId ? -1 : 1;
    })
    .slice(0, limit);
  const jobs = new Map<string, CrawledJob>();
  const seenIds = new Set<string>();
  let index = 0;
  let fatal: unknown;
  async function worker() {
    while (index < selected.length && !fatal) {
      const [url] = selected[index++];
      try {
        const page = await read(
          url,
          recipe.detail.kind === "selectors" && recipe.detail.render,
        );
        const job = extractJob(page.html, page.url, recipe);
        if (job) {
          job.id = jobId(url, recipe) || jobId(page.url, recipe) || url;
          if (seenIds.has(job.id)) continue;
          seenIds.add(job.id);
          jobs.set(url, job);
        }
      } catch (error) {
        try {
          rethrowFatal(error);
        } catch (error) {
          fatal = error;
        }
      }
    }
  }
  await Promise.all([worker(), worker()]);
  if (fatal) throw fatal;
  signal?.throwIfAborted();
  if (selected.length && !jobs.size)
    throw new Error(
      "All selected careers job pages failed or contained no job.",
    );
  return selected.flatMap(([url]) => {
    const job = jobs.get(url);
    return job ? [job] : [];
  });
}
