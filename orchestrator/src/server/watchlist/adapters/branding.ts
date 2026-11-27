import { upstreamError } from "@infra/errors";
import { detectLogoMimeType } from "@infra/image-mime";
import type { WatchlistSourceBrandingResponse } from "@shared/types";

const WATCHLIST_LOGO_MAX_BYTES = 1_000_000;

export function shouldHydrateSourceLabel(
  source: { sourceType: string; label: string; careersUrl: string },
  sourceType: string,
): boolean {
  const label = source.label.trim();
  return source.sourceType === sourceType && (!label || label === source.careersUrl.trim());
}

export async function fetchLogoBranding(options: {
  providerLabel: string;
  logoUrl: string;
  careersUrl: string;
  signal?: AbortSignal;
  maxBytes?: number;
}): Promise<WatchlistSourceBrandingResponse> {
  const maxBytes = options.maxBytes ?? WATCHLIST_LOGO_MAX_BYTES;
  const response = await fetch(options.logoUrl, {
    method: "GET",
    redirect: "follow",
    signal: options.signal,
  });

  if (!response.ok) {
    throw upstreamError(
      `Failed to fetch ${options.providerLabel} logo with HTTP ${response.status}.`,
      {
        url: options.logoUrl,
        status: response.status,
      },
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw upstreamError(`${options.providerLabel} company logo exceeded size limit`, {
      url: options.logoUrl,
      contentLength,
      maxBytes,
    });
  }

  const contentType = response.headers.get("content-type");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw upstreamError(`${options.providerLabel} company logo exceeded size limit`, {
      url: options.logoUrl,
      contentLength: bytes.byteLength,
      maxBytes,
    });
  }

  const mimeType = detectLogoMimeType(bytes, contentType);
  if (!mimeType) {
    throw upstreamError(`${options.providerLabel} logo response was not an image.`, {
      url: options.logoUrl,
      contentType: contentType?.trim() || null,
    });
  }

  return {
    careersUrl: options.careersUrl,
    logoUrl: options.logoUrl,
    mimeType,
    imageDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}
