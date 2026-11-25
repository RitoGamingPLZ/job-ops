import { isHttpUrl } from "@infra/url";

function normalizeBaseUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed || !isHttpUrl(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

/** The origin JobOps is reachable at: the request's own origin, else `JOBOPS_PUBLIC_BASE_URL`. */
export function resolvePublicBaseUrl(args: { requestOrigin?: string | null }): string | null {
  const fromRequest = normalizeBaseUrl(args.requestOrigin);
  if (fromRequest) return fromRequest;
  return normalizeBaseUrl(process.env.JOBOPS_PUBLIC_BASE_URL ?? null);
}
