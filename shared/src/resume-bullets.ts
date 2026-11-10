function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

/** HTML to plain text: tags stripped, br/paragraph breaks become newlines, entities decoded, whitespace collapsed. Server and client share it so text comparisons match. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      const key = entity.slice(1, -1).toLowerCase();
      if (!key.startsWith("#")) return named[key] ?? entity;
      const code = key.startsWith("#x")
        ? Number.parseInt(key.slice(2), 16)
        : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "\uFFFD";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function bulletsFromHtml(html: string): string[] {
  const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => htmlToPlainText(match[1] ?? ""))
    .filter(Boolean);
  if (items.length) return items;
  return htmlToPlainText(html)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function bulletsToHtml(bullets: string[]): string {
  if (!bullets.length) return "";
  return `<ul>${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`;
}

/** Description prose is original HTML; only explicit list items are bullets.
 * Keep this HTML as data: consumers must sanitize it before rendering as HTML.
 */
export function splitDescription(html: string): {
  introHtml: string;
  bullets: string[];
} {
  const lists = [...html.matchAll(/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)];
  return {
    introHtml: html.replace(/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ""),
    bullets: lists.flatMap(([list]) =>
      /<li\b/i.test(list) ? bulletsFromHtml(list) : [],
    ),
  };
}

/** Reuse the original list position when editing bullets, so trailing prose stays put. */
export function joinDescription(
  introHtml: string,
  bullets: string[],
  originalHtml?: string,
): string {
  const listHtml = bulletsToHtml(bullets);
  if (
    originalHtml !== undefined &&
    splitDescription(originalHtml).introHtml === introHtml
  ) {
    let replaced = false;
    const next = originalHtml.replace(
      /<(ul|ol)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      () => {
        const replacement = replaced ? "" : listHtml;
        replaced = true;
        return replacement;
      },
    );
    if (replaced) return next;
  }
  return introHtml + listHtml;
}

/** Plain-text intro edits intentionally replace its markup with paragraphs. */
export function introTextToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("");
}
