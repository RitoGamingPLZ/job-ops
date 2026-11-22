type Primitive = string | number | boolean | null;

export type AnalyticsPayload = Record<string, Primitive>;

const DISALLOWED_KEY_PARTS = [
  "query",
  "url",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "code",
] as const;

export function sanitizeAnalyticsPayload(
  data: Record<string, unknown> | undefined,
): AnalyticsPayload | undefined {
  if (!data) return undefined;
  const sanitized: AnalyticsPayload = {};
  for (const [key, value] of Object.entries(data)) {
    const loweredKey = key.toLowerCase();
    if (DISALLOWED_KEY_PARTS.some((part) => loweredKey.includes(part))) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function withAnalyticsMetadata(
  payload: AnalyticsPayload | undefined,
  metadata: {
    analyticsUserId?: string | null;
    appVersion?: string | null;
  },
): AnalyticsPayload | undefined {
  const analyticsUserId = metadata.analyticsUserId?.trim() || null;
  const appVersion = metadata.appVersion?.trim() || null;

  if (!analyticsUserId && !appVersion) {
    return payload;
  }

  return {
    ...payload,
    ...(analyticsUserId ? { analytics_user_id: analyticsUserId } : {}),
    ...(appVersion ? { app_version: appVersion } : {}),
  };
}
