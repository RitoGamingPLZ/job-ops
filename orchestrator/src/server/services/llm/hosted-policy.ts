const HOSTED_LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "lm_studio"]);

function normalizeProvider(provider: string | null | undefined): string {
  return provider?.trim().toLowerCase().replace(/[-.]/g, "_") ?? "";
}

export function isHostedLocalProvider(provider: string | null | undefined): boolean {
  return HOSTED_LOCAL_PROVIDERS.has(normalizeProvider(provider));
}
