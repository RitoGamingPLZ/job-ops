import { getOriginalEnvValue } from "@server/services/envSettings";
import { normalizeLlmProviderName } from "@shared/settings-registry";
import { toStringOrNull } from "@shared/utils/type-conversion";

const PROVIDER_ENV_KEY: Record<string, string> = {
  atlascloud: "ATLASCLOUD_API_KEY",
  litellm: "LITELLM_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  requesty: "REQUESTY_API_KEY",
  api_route: "API_ROUTE_API_KEY",
  orcarouter: "ORCAROUTER_API_KEY",
};

/**
 * Resolve the effective LLM API key from stored settings and environment.
 * Matches LlmService constructor behavior so onboarding, imports, and pipeline
 * agree on whether credentials are configured.
 */
export function resolveLlmApiKey(options: {
  storedApiKey?: string | null;
  purposeApiKey?: string | null;
  provider?: string | null;
  allowEnvironmentCredentials?: boolean;
}): string | null {
  const purposeApiKey = toStringOrNull(options.purposeApiKey);
  if (purposeApiKey) return purposeApiKey;

  const storedApiKey = toStringOrNull(options.storedApiKey);
  if (storedApiKey) return storedApiKey;

  if (options.allowEnvironmentCredentials === false) return null;

  const envApiKey = toStringOrNull(getOriginalEnvValue("LLM_API_KEY"));
  if (envApiKey) return envApiKey;

  const provider = normalizeLlmProviderName(options.provider);
  const envKey = PROVIDER_ENV_KEY[provider];
  return envKey ? toStringOrNull(getOriginalEnvValue(envKey)) : null;
}
