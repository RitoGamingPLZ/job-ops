/**
 * Careers-site sources are keyed `careers_site:<host>` or `careers_site:<host>?<24 hex>`, where the
 * suffix digests the user's filter query. The same posting reached through two filters is still one
 * posting, so ignored and imported state is matched on the host key alone. Other source types keep
 * their exact key. Nothing is rewritten in storage: this only widens how stored rows are matched.
 */
export function watchlistStateSource(source: string): string {
  return source.startsWith("careers_site:") ? source.replace(/\?[0-9a-f]{24}$/, "") : source;
}
