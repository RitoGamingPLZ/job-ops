export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeHtmlText(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
