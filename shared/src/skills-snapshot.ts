/** Canonical text of the visible skill groups, used as set_skills previousText. */
export function skillsSnapshot(items: Record<string, unknown>[]): string {
  return items
    .filter((item) => !item.hidden)
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const keywords = Array.isArray(item.keywords)
        ? item.keywords
            .filter((keyword): keyword is string => typeof keyword === "string")
            .map((keyword) => keyword.trim())
            .filter(Boolean)
        : [];
      return `${name}: ${keywords.join(", ")}`;
    })
    .join("\n");
}
