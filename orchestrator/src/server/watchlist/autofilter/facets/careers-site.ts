import { badRequest, upstreamError } from "@infra/errors";
import { JSDOM } from "jsdom";
import { isAllowedByRobots, loadPage } from "../../careers-site/fetch";
import { facetConfig } from "../../careers-site/run-recipe";
import { SiteBlockedError } from "../../careers-site/types";
import type { FacetDiscovery, Facets } from "../types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function usableKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 60 &&
    !/^(?:_?(?:page|paged|pagination|offset|skip|limit|per_page)|utm_.*|gclid|fbclid|msclkid|ref|referrer|source|tracking.*)$/i.test(
      key,
    )
  );
}

/** Static public facets only; no tenant data, stored recipes, browser, or LLM. */
async function readListingFacets(
  { careersUrl, signal }: Parameters<FacetDiscovery>[0],
  filtered = false,
): Promise<Facets> {
  let base: URL;
  try {
    base = new URL(careersUrl);
  } catch {
    throw badRequest("Use an HTTPS careers listing URL.");
  }
  if (base.protocol !== "https:" || base.username || base.password || base.port)
    throw badRequest("Use an HTTPS careers listing URL.");
  if (!filtered) base.search = "";
  base.hash = "";
  signal?.throwIfAborted();
  if (!(await isAllowedByRobots(base.href, { signal })))
    throw new SiteBlockedError(base.hostname, "robots.txt disallows listing");
  const page = await loadPage(base.href, { render: false, signal });
  if (page.status < 200 || page.status >= 300)
    throw upstreamError(`Careers facets returned HTTP ${page.status}.`);
  const listing = new URL(page.url);
  const params = new Map<
    string,
    { multi: boolean; values: Map<string, number | undefined> }
  >();
  const add = (key: string, value: string, multi: boolean, count?: number) => {
    if (!usableKey(key) || !value || value.length > 120 || !value.trim())
      return;
    let param = params.get(key);
    if (!param) {
      param = { multi, values: new Map() };
      params.set(key, param);
    }
    param.multi ||= multi;
    const previous = param.values.get(value);
    param.values.set(
      value,
      count === undefined ? previous : Math.max(previous ?? 0, count),
    );
  };
  const choices = (root: ParentNode, key?: string) => {
    for (const select of root.querySelectorAll("select")) {
      const name = key ?? select.getAttribute("name") ?? "";
      for (const option of select.querySelectorAll<HTMLOptionElement>(
        "option[value]",
      )) {
        if (option.disabled || select.disabled) continue;
        const raw = option.getAttribute("data-counter");
        const count =
          raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))
            ? Number(raw)
            : undefined;
        // FacetWP encodes multi-select values as one comma-delimited parameter;
        // expose single choices because the shared builder repeats URL keys.
        add(name, option.value, key ? false : select.multiple, count);
      }
    }
  };
  const dom = new JSDOM(page.html);
  let total: number | undefined;
  const jobs = new Set<string>();
  try {
    choices(dom.window.document);
    for (const anchor of dom.window.document.querySelectorAll("a[href]")) {
      let url: URL;
      try {
        url = new URL(anchor.getAttribute("href") ?? "", listing);
      } catch {
        continue;
      }
      if (url.origin !== listing.origin || url.username || url.password)
        continue;
      if (url.pathname === listing.pathname) {
        for (const [key, value] of url.searchParams) add(key, value, false);
      } else if (
        /\/(?:positions?|jobs?|openings?|requisitions?)\/[^/]+/i.test(
          url.pathname,
        ) ||
        url.searchParams.has("gh_jid")
      ) {
        url.search = "";
        url.hash = "";
        jobs.add(url.href);
      }
    }
    const config = facetConfig(page.html);
    if (config) {
      let data: Record<string, unknown> = {};
      try {
        data = record(JSON.parse(config));
      } catch {
        /* Ignore malformed public metadata. */
      }
      const preload = record(data.preload_data);
      const pager = record(record(preload.settings).pager);
      if (
        typeof pager.total_rows === "number" &&
        Number.isSafeInteger(pager.total_rows) &&
        pager.total_rows >= 0
      )
        total = pager.total_rows;
      if (
        typeof data.prefix === "string" &&
        /^[_a-z-]{0,20}$/i.test(data.prefix)
      ) {
        for (const [name, html] of Object.entries(record(preload.facets))) {
          if (typeof html !== "string") continue;
          const fragment = JSDOM.fragment(html);
          choices(fragment, `${data.prefix}${name}`);
          for (const choice of fragment.querySelectorAll("[data-value]")) {
            const raw = choice.getAttribute("data-counter");
            add(
              `${data.prefix}${name}`,
              choice.getAttribute("data-value") ?? "",
              false,
              raw !== null &&
                /^\d+$/.test(raw) &&
                Number.isSafeInteger(Number(raw))
                ? Number(raw)
                : undefined,
            );
          }
        }
      }
    }
  } finally {
    dom.window.close();
  }
  // Without FacetWP totals this is only an approximation: unique recognizable
  // job links on this static page, excluding jobs on later pages or rendered by JS.
  return {
    unfilteredTotal: total ?? jobs.size,
    params: [...params]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 12)
      .map(([key, param]) => ({
        key,
        multi: param.multi,
        values: [...param.values]
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]))
          .slice(0, 60)
          .map(([value, count]) =>
            count === undefined ? { value } : { value, count },
          ),
      })),
  } satisfies Facets;
}

export const discoverCareersSiteFacets: FacetDiscovery = async (input) => ({
  ...(await readListingFacets(input)),
  countFiltered: async (filtered) =>
    (await readListingFacets(filtered, true)).unfilteredTotal,
});
