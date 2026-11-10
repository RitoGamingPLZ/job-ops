// TODO(lead-merge): temporary copy of `htmlToPlainText` from @shared/resume-bullets
// (added server-side in step 60). Delete this file and import from there at merge.
const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
/** Tags stripped, entities decoded like bulletsFromHtml, whitespace collapsed, trimmed. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const key = entity.slice(1, -1).toLowerCase();
      if (!key.startsWith("#")) return NAMED[key] ?? entity;
      const code = key.startsWith("#x")
        ? Number.parseInt(key.slice(2), 16)
        : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "�";
    })
    .replace(/\s+/g, " ")
    .trim();
}
