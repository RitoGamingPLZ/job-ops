/** Fetches a search results page as HTML, throwing a descriptive error on non-OK status. */
export async function fetchExtractorSearchHtml(args: {
  url: string;
  sourceLabel: string;
  acceptLanguage: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(args.url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": args.acceptLanguage,
      "user-agent": "Mozilla/5.0 (compatible; JobOps/1.0)",
    },
  });

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(
      `${args.sourceLabel} search request failed with ${response.status}${statusText} for ${args.url}`,
    );
  }

  return response.text();
}
