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
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
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

  if (isIP(normalized) !== 6) return true;
  // URL canonicalization expands dotted IPv4-mapped suffixes into hex groups.
  const canonical = new URL(`https://[${normalized}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = canonical.includes("::")
    ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail]
    : head;
  const parts = words.map((word) => Number.parseInt(word, 16));
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return isPrivateIpv4([parts[6] >> 8, parts[6] & 255, parts[7] >> 8, parts[7] & 255]);
  }

  // Only global unicast (2000::/3), excluding 6to4 (2002::/16),
  // Teredo/benchmarking/documentation (2001:0000::/23, 2001:db8::/32), and 3fff::/20.
  const isGlobalUnicast =
    (parts[0] & 0xe000) === 0x2000 &&
    parts[0] !== 0x2002 &&
    !(parts[0] === 0x2001 && (parts[1] < 0x200 || parts[1] === 0xdb8)) &&
    !(parts[0] === 0x3fff && parts[1] < 0x1000);
  return !isGlobalUnicast;
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
