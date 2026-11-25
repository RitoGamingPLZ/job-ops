import type * as api from "@client/api";
import { LlmModelConfiguration } from "@client/components/llmmodelconfiguration/LlmModelConfiguration";
import {
  getLlmProviderConfig,
  type LlmProviderId,
  RESTRICTED_LLM_PROVIDERS,
} from "@client/pages/settings/utils";
import type React from "react";
import type { ValidationState } from "../types";
import { InlineValidation } from "./InlineValidation";

export const LlmConnectionStep: React.FC<{
  apiKey: string;
  baseUrl: string;
  defaultModel: string | null | undefined;
  effectiveModel: string | null | undefined;
  isBusy: boolean;
  llmKeyHint: string | null;
  model: string;
  restrictProviders?: boolean;
  savedBaseUrl: string | null | undefined;
  savedProvider: string | null | undefined;
  selectedProvider: LlmProviderId;
  validation: ValidationState;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onCodexAuthStatusChange?: (status: Awaited<ReturnType<typeof api.getCodexAuthStatus>>) => void;
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
}> = ({
  apiKey,
  baseUrl,
  defaultModel,
  effectiveModel,
  isBusy,
  llmKeyHint,
  model,
  restrictProviders = false,
  savedBaseUrl,
  savedProvider,
  selectedProvider,
  validation,
  onApiKeyChange,
  onBaseUrlChange,
  onCodexAuthStatusChange,
  onModelChange,
  onProviderChange,
}) => {
  const effectiveSelectedProvider =
    restrictProviders && !RESTRICTED_LLM_PROVIDERS.some((id) => id === selectedProvider)
      ? (RESTRICTED_LLM_PROVIDERS[0] ?? selectedProvider)
      : selectedProvider;
  const providerConfig = getLlmProviderConfig(effectiveSelectedProvider);
  const displayValidation =
    !providerConfig.requiresApiKey && validation.message?.toLowerCase().includes("api key")
      ? { ...validation, checked: false, message: null }
      : validation;

  return (
    <div data-onboarding-target="model-form">
      <LlmModelConfiguration
        mode="compact"
        disabled={isBusy}
        restrictProviders={restrictProviders}
        selectedProvider={effectiveSelectedProvider}
        savedProvider={savedProvider}
        savedBaseUrl={savedBaseUrl}
        apiKeyHint={llmKeyHint}
        effectiveModel={effectiveModel}
        defaultModel={defaultModel}
        provider={{
          value: selectedProvider,
          onChange: onProviderChange,
        }}
        baseUrl={{
          value: baseUrl,
          onChange: onBaseUrlChange,
        }}
        apiKey={{
          value: apiKey,
          onChange: onApiKeyChange,
        }}
        model={{
          value: model,
          onChange: onModelChange,
        }}
        validationSlot={
          <InlineValidation
            state={displayValidation}
            successMessage={`${providerConfig.label} connection verified.`}
          />
        }
        onCodexAuthStatusChange={onCodexAuthStatusChange}
      />
    </div>
  );
};
