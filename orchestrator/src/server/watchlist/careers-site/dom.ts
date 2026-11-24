import { JSDOM } from "jsdom";
import { DOMParser, parseHTML } from "linkedom";

/**
 * Minimal subset of a JSDOM instance that the careers-site crawler uses, so the same code
 * can run on Node (jsdom) and inside the Cloudflare Durable Object runtime (linkedom).
 */
export interface ParsedDom {
  window: { document: Document; close(): void };
}

/** The Durable Object bundle stubs out jsdom, so parse with linkedom there. */
export function isWorkerdRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export function parseDom(source: string, options?: { contentType?: "text/xml" }): ParsedDom {
  if (!isWorkerdRuntime()) return new JSDOM(source, options);
  const document =
    options?.contentType === "text/xml"
      ? new DOMParser().parseFromString(source, "text/xml")
      : parseHTML(source).document;
  return { window: { document: document as unknown as Document, close() {} } };
}
