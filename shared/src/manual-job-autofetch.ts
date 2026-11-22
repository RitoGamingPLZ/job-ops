const BLOCKED_AUTOFETCH_HOSTS: Array<{
  label: string;
  match: (hostname: string) => boolean;
}> = [
  {
    label: "LinkedIn",
    match: (hostname) => hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"),
  },
  {
    label: "Indeed",
    match: (hostname) => hostname === "indeed.com" || hostname.includes("indeed."),
  },
];

/** Label of the site whose job pages must not be auto-fetched, or null. */
export function getBlockedAutofetchLabel(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname) return null;
  return BLOCKED_AUTOFETCH_HOSTS.find((entry) => entry.match(hostname))?.label ?? null;
}
