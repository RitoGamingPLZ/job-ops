/**
 * Outbound fetch helpers for user-supplied URLs (job pages, webhooks, ...).
 *
 * Any authenticated user can make the server request a URL, so every hop must
 * be public http(s): no loopback, private, link-local or cloud-metadata hosts,
 * redirects are re-checked, and response bodies are size-capped.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isLocalOrPrivateHostname } from "./public-hostname";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  );
}

/** True for anything that is not a routable public unicast address. */
export function isPrivateAddress(address: string): boolean {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(normalized);
  if (v4) return isPrivateIpv4(v4);

  if (!normalized.includes(":")) return true;
  if (normalized === "::" || normalized === "::1") return true;

  // IPv4-mapped / compatible forms such as ::ffff:127.0.0.1
  const mapped = normalized.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    const mappedV4 = parseIpv4(mapped[1]);
    return mappedV4 ? isPrivateIpv4(mappedV4) : true;
  }
  if (normalized.startsWith("::ffff:")) return true;

  return (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  );
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Enter a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new UnsafeUrlError("That address is not publicly reachable.");
    }
    return url;
  }
  if (isLocalOrPrivateHostname(hostname)) {
    throw new UnsafeUrlError("That address is not publicly reachable.");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("Could not resolve that host.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new UnsafeUrlError("That address is not publicly reachable.");
  }
  return url;
}

async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UnsafeUrlError("The response is too large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UnsafeUrlError("The response is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export type FetchPublicTextOptions = {
  init?: RequestInit;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
};

/** GET/POST a public URL, following at most a few re-validated redirects. */
export async function fetchPublicText(
  raw: string,
  options: FetchPublicTextOptions = {},
): Promise<{ response: Response; text: string; finalUrl: string }> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const response = await fetch(url, {
      ...options.init,
      signal: options.signal,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new UnsafeUrlError("The server returned an invalid redirect.");
      current = new URL(location, url).toString();
      continue;
    }

    const text = response.ok ? await readTextCapped(response, maxBytes) : "";
    if (!response.ok) await response.body?.cancel().catch(() => undefined);
    return { response, text, finalUrl: url.toString() };
  }
  throw new UnsafeUrlError("Too many redirects.");
}

/** Fire-and-forget-safe POST for webhooks: public hosts only, no redirects. */
export async function postJsonToPublicUrl(
  raw: string,
  body: unknown,
  headers: Record<string, string>,
  options: { signal?: AbortSignal; allowPrivateNetwork?: boolean } = {},
): Promise<Response> {
  // The operator may target their own LAN (n8n, etc.); everyone else may not.
  const url = options.allowPrivateNetwork ? new URL(raw) : await assertPublicHttpUrl(raw);
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
    signal: options.signal,
  });
}
