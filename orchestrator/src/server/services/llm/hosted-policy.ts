import { normalizeLlmProviderName } from "@shared/settings-registry";

const HOSTED_LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "litellm"]);

export function isHostedLocalProvider(provider: string | null | undefined): boolean {
  return HOSTED_LOCAL_PROVIDERS.has(normalizeLlmProviderName(provider));
}
