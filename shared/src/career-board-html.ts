export function htmlToText(html: string, breakAfterLists = true): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(
      breakAfterLists ? /<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi : /<\/\s*(p|div|li|h[1-6])\s*>/gi,
      "\n",
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
