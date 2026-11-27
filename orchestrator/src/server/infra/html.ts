export function escapeHtml(value: string) {
  return escapeHtmlMarkup(value).replace(/"/g, "&quot;");
}

export function escapeHtmlMarkup(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlText(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
