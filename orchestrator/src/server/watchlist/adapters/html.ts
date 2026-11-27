export function extractJsonLdObjects(html: string): unknown[] {
  const items: unknown[] = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (
      !/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?=[\s/>]))/i.test(
        script[1],
      )
    ) {
      continue;
    }
    try {
      items.push(JSON.parse(script[2]));
    } catch {
      // Malformed unrelated JSON-LD must not hide another posting.
    }
  }
  return items;
}

export function findJsonLdJobPostings(value: unknown): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
    if (types.some((type) => type === "JobPosting" || type === "https://schema.org/JobPosting")) {
      results.push(record);
    }
    if (record["@graph"] !== undefined) {
      visit(record["@graph"]);
    }
  };
  visit(value);
  return results;
}

export function extractBalancedJson(
  source: string,
  openIndex: number,
  openChar: "{" | "[",
): string | null {
  if (source[openIndex] !== openChar) return null;
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar && --depth === 0) {
      return source.slice(openIndex, i + 1);
    }
  }
  return null;
}
