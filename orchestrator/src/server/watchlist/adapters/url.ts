import { badRequest } from "@infra/errors";

export function parseWatchlistUrl(value: string, invalidMessage: string): URL {
  try {
    return new URL(value.trim());
  } catch {
    throw badRequest(invalidMessage);
  }
}

export function hasPlainHttpsAuthority(value: string): boolean {
  const authority = value.trim().match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || authority.includes("@")) return false;
  if (authority.startsWith("[")) return authority.endsWith("]");
  return !authority.includes(":");
}

export function tryParseSafeHttpsUrl(value: string, relativeBase?: string | URL): URL | null {
  const trimmed = value.trim();
  if (!trimmed && relativeBase === undefined) return null;

  let url: URL;
  try {
    url = relativeBase === undefined ? new URL(trimmed) : new URL(trimmed, relativeBase);
  } catch {
    return null;
  }

  const checkExplicitAuthority = relativeBase === undefined || /^https?:\/\//i.test(trimmed);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (checkExplicitAuthority && !hasPlainHttpsAuthority(trimmed))
  ) {
    return null;
  }

  return url;
}

export function parseSafeHttpsUrl(value: string, invalidMessage: string): URL {
  const url = tryParseSafeHttpsUrl(value);
  if (!url) throw badRequest(invalidMessage);
  return url;
}

export function getSourceHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
