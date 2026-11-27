export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeTableChecksum(rows: Record<string, unknown>[]): Promise<string> {
  const payload = rows.map((row) => canonicalJson(row)).join("\n");
  return sha256Hex(payload);
}

export function getBearerToken(request: Request): string {
  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

export function resolveInternalContainerSecret(env: {
  INTERNAL_SYNC_SECRET?: string;
  CRON_SECRET?: string;
}): string | undefined {
  const primary = env.INTERNAL_SYNC_SECRET?.trim();
  if (primary) return primary;
  const fallback = env.CRON_SECRET?.trim();
  return fallback || undefined;
}

export function normalizePath(pathname: string): string {
  const decoded = decodeURI(pathname);
  return (
    decoded
      .toLowerCase()
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "") || "/"
  );
}

export function jsonError(
  request: Request,
  code: string,
  message: string,
  init: ResponseInit & { details?: unknown },
): Response {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const { details, ...responseInit } = init;
  const headers = new Headers(responseInit.headers);
  headers.set("x-request-id", requestId);
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      meta: { requestId },
    },
    { ...responseInit, headers },
  );
}
