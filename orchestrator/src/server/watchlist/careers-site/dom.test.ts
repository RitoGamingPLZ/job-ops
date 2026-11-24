import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkerdRuntime, parseDom } from "./dom";

const html = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer"}</script>
</head><body><main><h1>Careers</h1>
<a href="/jobs/1">One</a><a href="/jobs/2?x=1">Two</a><a>No href</a>
<div itemscope itemtype="https://schema.org/JobPosting"><span class="t"> Staff Eng </span></div>
</main></body></html>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.com/jobs/1</loc></url>
<url><loc>https://example.com/jobs/2</loc></url>
</urlset>`;
const index = `<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>`;

function queries() {
  const doc = parseDom(html).window.document;
  const xml = parseDom(sitemap, { contentType: "text/xml" }).window.document;
  const idx = parseDom(index, { contentType: "text/xml" }).window.document;
  return {
    links: Array.from(doc.querySelectorAll("a[href]"), (a) => a.getAttribute("href")),
    jsonLd: Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((node) =>
      JSON.parse(node.textContent ?? "{}"),
    ),
    microdata: Boolean(doc.querySelector('[itemtype$="/JobPosting"]')),
    heading: doc.querySelector("h1")?.textContent,
    hasMain: Boolean(doc.querySelector("main,article,[role=main]")),
    title: doc.querySelector(".t")?.textContent?.trim(),
    locs: Array.from(xml.querySelectorAll("loc"), (node) => node.textContent?.trim()),
    sitemapRoot: xml.documentElement.localName,
    indexRoot: idx.documentElement.localName,
    empty: parseDom("").window.document.querySelectorAll("a[href]").length,
  };
}

describe("parseDom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses jsdom on Node and linkedom in the Cloudflare worker, with identical query results", () => {
    expect(isWorkerdRuntime()).toBe(false);
    const node = queries();
    expect(node.links).toEqual(["/jobs/1", "/jobs/2?x=1"]);
    expect(node.sitemapRoot).toBe("urlset");
    expect(node.indexRoot).toBe("sitemapindex");

    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(isWorkerdRuntime()).toBe(true);
    expect(queries()).toEqual(node);
  });

  it("supports closing the window in both runtimes", () => {
    expect(() => parseDom(html).window.close()).not.toThrow();
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(() => parseDom(html).window.close()).not.toThrow();
  });
});
