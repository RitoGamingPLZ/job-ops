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
  return Boolean(authority && !authority.includes(":") && !authority.includes("@"));
}
