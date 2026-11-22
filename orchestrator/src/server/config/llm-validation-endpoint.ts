export function getDefaultValidationBaseUrl(
  provider: string | undefined,
): string | undefined {
  if (provider === "litellm") return "http://localhost:4000";
  if (provider === "lmstudio") return "http://localhost:1234";
  if (provider === "ollama") return "http://localhost:11434";
  if (provider === "openai_compatible") return "https://api.openai.com";
  if (provider === "glm") return "https://api.z.ai/api/paas/v4";
  return undefined;
}

export function resolveLlmValidationEndpoint(args: {
  provider: string | undefined;
  override: string | null | undefined;
  stored: string | null | undefined;
  environment: string | undefined;
  fallbackToDefault: boolean;
}): {
  usesBaseUrl: boolean;
  baseUrl: string | undefined;
  hasCustomUserBaseUrl: boolean;
} {
  const usesBaseUrl =
    args.provider === "litellm" ||
    args.provider === "lmstudio" ||
    args.provider === "ollama" ||
    args.provider === "glm" ||
    args.provider === "openai_compatible";
  const hasExplicitOverride =
    args.override !== undefined && args.override !== null;
  const userBaseUrl = hasExplicitOverride
    ? args.override?.trim()
    : args.stored?.trim();
  const defaultBaseUrl = getDefaultValidationBaseUrl(args.provider);
  const baseUrl = usesBaseUrl
    ? userBaseUrl ||
      args.environment?.trim() ||
      (hasExplicitOverride || args.fallbackToDefault
        ? defaultBaseUrl
        : undefined)
    : undefined;

  return {
    usesBaseUrl,
    baseUrl,
    hasCustomUserBaseUrl:
      Boolean(userBaseUrl) && userBaseUrl !== defaultBaseUrl,
  };
}
