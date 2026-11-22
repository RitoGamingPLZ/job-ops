import { fetchExtractorSearchHtml } from "job-ops-shared/extractor-http";

const KHAMSAT_ORIGIN = "https://khamsat.com";

export function buildFiveamsatSearchUrl(query: string): string {
  const normalizedQuery = query.trim().replace(/\s+/g, "-");
  return `${KHAMSAT_ORIGIN}/services/${encodeURIComponent(normalizedQuery)}`;
}

export async function fetchFiveamsatSearchPage(args: {
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  return fetchExtractorSearchHtml({
    url: buildFiveamsatSearchUrl(args.query),
    sourceLabel: "Khamsat",
    acceptLanguage: "ar,en;q=0.9",
    fetchImpl: args.fetchImpl,
  });
}
