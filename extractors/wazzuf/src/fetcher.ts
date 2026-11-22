import { fetchExtractorSearchHtml } from "job-ops-shared/extractor-http";

const WUZZUF_SEARCH_URL = "https://wuzzuf.net/search/jobs/";

export function buildWazzufSearchUrl(query: string): string {
  const url = new URL(WUZZUF_SEARCH_URL);
  url.searchParams.set("q", query);
  return url.toString();
}

export async function fetchWazzufSearchPage(args: {
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  return fetchExtractorSearchHtml({
    url: buildWazzufSearchUrl(args.query),
    sourceLabel: "WUZZUF",
    acceptLanguage: "en,ar;q=0.9",
    fetchImpl: args.fetchImpl,
  });
}
