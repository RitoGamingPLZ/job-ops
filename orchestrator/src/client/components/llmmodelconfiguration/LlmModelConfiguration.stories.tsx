import { type LlmProviderId } from "@client/pages/settings/utils";
import type { Story } from "@ladle/react";
import type { LlmPurpose, LlmPurposeApiKeyHints, LlmPurposeOverrides } from "@shared/types";
import { useEffect, useState } from "react";
import { LlmModelConfiguration } from "./LlmModelConfiguration";

const MOCK_MODELS: Record<string, string[]> = {
  openai: ["gpt-5.4-mini", "gpt-5.4", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  litellm: ["openai/gpt-5.4-mini", "anthropic/claude-sonnet-4-6"],
  openrouter: ["anthropic/claude-sonnet-4", "google/gemini-2.5-flash"],
};

function installMockHandlers() {
  window.__mockFetchHandlers = {
    "/api/settings/llm-models": async (_url: string, init?: RequestInit) => {
      let provider = "openai";
      try {
        const parsed = init?.body ? (JSON.parse(String(init.body)) as { provider?: string }) : {};
        if (parsed.provider) provider = parsed.provider;
      } catch {
        // ignore malformed request body
      }
      return { models: MOCK_MODELS[provider] ?? ["default-model"] };
    },
    "/api/settings/codex-auth": {
      authenticated: false,
      expiresAt: null,
      accountId: null,
      email: null,
      pending: false,
    },
  };
}

type HarnessProps = {
  mode?: "compact" | "settings";
  initialProvider?: LlmProviderId;
  restrictProviders?: boolean;
  defaultModelStatus?: "granted" | "required" | null;
  apiKeyHint?: string | null;
  defaultModel?: string | null;
  effectiveModel?: string | null;
  withPurposeOverrides?: boolean;
};

function ConfigurationHarness({
  mode = "settings",
  initialProvider = "openai",
  restrictProviders = false,
  defaultModelStatus = null,
  apiKeyHint = null,
  defaultModel = "gpt-5.4-mini",
  effectiveModel = "gpt-5.4-mini",
  withPurposeOverrides = false,
}: HarnessProps) {
  installMockHandlers();

  useEffect(() => {
    installMockHandlers();
    return () => {
      window.__mockFetchHandlers = null;
    };
  }, []);

  const [provider, setProvider] = useState<string>(initialProvider);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(defaultModel ?? "");

  const [overrideValues, setOverrideValues] = useState<LlmPurposeOverrides>({
    scoring: { provider: "gemini", model: "gemini-2.5-flash" },
    tailoring: { provider: "anthropic", model: "claude-sonnet-4-6" },
    projectSelection: {},
  });
  const [overrideApiKeys, setOverrideApiKeys] = useState<
    Partial<Record<LlmPurpose, string | null>>
  >({});
  const [overrideApiKeyHints] = useState<LlmPurposeApiKeyHints>({
    scoring: "••••••••",
  });
  const [overrideModels, setOverrideModels] = useState<Record<LlmPurpose, string>>({
    scoring: "gemini-2.5-flash",
    tailoring: "claude-sonnet-4-6",
    projectSelection: "",
  });

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-border/70 bg-card p-4 text-card-foreground sm:p-6">
      <LlmModelConfiguration
        mode={mode}
        disabled={false}
        restrictProviders={restrictProviders}
        defaultModelStatus={defaultModelStatus}
        selectedProvider={provider as LlmProviderId}
        savedProvider={initialProvider}
        savedBaseUrl=""
        apiKeyHint={apiKeyHint}
        defaultModel={defaultModel}
        effectiveModel={effectiveModel}
        provider={{ value: provider, onChange: setProvider }}
        baseUrl={{ value: baseUrl, onChange: setBaseUrl }}
        apiKey={{ value: apiKey, onChange: setApiKey }}
        model={{ value: model, onChange: setModel }}
        purposeOverrides={
          withPurposeOverrides
            ? {
                values: overrideValues,
                apiKeys: overrideApiKeys,
                apiKeyHints: overrideApiKeyHints,
                models: overrideModels,
                onChange: (purpose, field, value) => {
                  setOverrideValues((prev) => ({
                    ...prev,
                    [purpose]: {
                      ...prev[purpose],
                      [field]: value || undefined,
                    },
                  }));
                  if (field === "model") {
                    setOverrideModels((prev) => ({ ...prev, [purpose]: value ?? "" }));
                  }
                },
                onApiKeyChange: (purpose, value) => {
                  setOverrideApiKeys((prev) => ({ ...prev, [purpose]: value }));
                },
              }
            : undefined
        }
      />
    </div>
  );
}

export const AdminFullConfiguration: Story = () => (
  <ConfigurationHarness
    mode="settings"
    initialProvider="openai"
    restrictProviders={false}
    apiKeyHint="••••••••"
    withPurposeOverrides={true}
  />
);
AdminFullConfiguration.storyName = "Admin full configuration";

export const NonAdminDefaultModelGranted: Story = () => (
  <ConfigurationHarness
    mode="settings"
    initialProvider="anthropic"
    restrictProviders={true}
    defaultModelStatus="granted"
    defaultModel="Managed by admin"
    effectiveModel="Managed by admin"
    withPurposeOverrides={true}
  />
);
NonAdminDefaultModelGranted.storyName = "Non-admin default model granted";

export const NonAdminByokRequired: Story = () => (
  <ConfigurationHarness
    mode="compact"
    initialProvider="gemini"
    restrictProviders={true}
    defaultModelStatus="required"
    defaultModel={null}
    effectiveModel={null}
  />
);
NonAdminByokRequired.storyName = "Non-admin BYOK required";

export const SavedKeyHidden: Story = () => (
  <ConfigurationHarness
    mode="settings"
    initialProvider="openai"
    restrictProviders={true}
    defaultModelStatus="required"
    apiKeyHint="••••••••"
  />
);
SavedKeyHidden.storyName = "Saved key hidden";
