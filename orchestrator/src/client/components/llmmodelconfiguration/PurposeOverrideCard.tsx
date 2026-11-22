import { ClaudeCliSetupHint } from "@client/components/ClaudeCliSetupHint";
import { CodexAuthPanel } from "@client/components/CodexAuthPanel";
import { GeminiCliSetupHint } from "@client/components/GeminiCliSetupHint";
import { getDefaultModelForProvider } from "@shared/settings-registry";
import type { LlmProviderId, LlmPurpose, LlmPurposeOverrides } from "@shared/types";
import { SettingsInput } from "@/client/pages/settings/components/SettingsInput";
import {
  formatSecretHint,
  getLlmProviderConfig,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  normalizeLlmProvider,
  supportsLlmModelSuggestions,
} from "@/client/pages/settings/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildModelOptions, renderKeyHelper } from "./llm-model-configuration-helpers";
import ModelField from "./ModelField";
import { useLlmModels } from "./useLlmModels";

export default function PurposeOverrideCard({
  purpose,
  defaultProvider,
  defaultModel,
  defaultBaseUrl,
  defaultApiKeyHint,
  value,
  apiKeyValue,
  apiKeyHint,
  currentModel,
  disabled,
  onChange,
  onApiKeyChange,
}: {
  purpose: LlmPurpose;
  defaultProvider: LlmProviderId;
  defaultModel: string;
  defaultBaseUrl: string;
  defaultApiKeyHint: string | null;
  value?: LlmPurposeOverrides[LlmPurpose];
  apiKeyValue: string;
  apiKeyHint: string | null;
  currentModel: string;
  disabled: boolean;
  onChange: (
    purpose: LlmPurpose,
    field: "provider" | "baseUrl" | "model",
    value: string | null,
  ) => void;
  onApiKeyChange: (purpose: LlmPurpose, value: string) => void;
}) {
  const selectedProvider = value?.provider ? normalizeLlmProvider(value.provider) : defaultProvider;
  const hasProviderOverride = Boolean(value?.provider);
  const providerConfig = getLlmProviderConfig(selectedProvider);
  const isCodexProvider = providerConfig.normalizedProvider === "codex";
  const isGeminiCliProvider = providerConfig.normalizedProvider === "gemini_cli";
  const isClaudeCliProvider = providerConfig.normalizedProvider === "claude_cli";
  const supportsModelSuggestions = supportsLlmModelSuggestions(selectedProvider);
  const baseUrlValue = value?.baseUrl ?? "";
  const modelValue = value?.model ?? "";
  const purposeProviderDefaultModel = hasProviderOverride
    ? getDefaultModelForProvider(selectedProvider)
    : defaultModel;
  const providerDefaultBaseUrl = providerConfig.showBaseUrl
    ? providerConfig.baseUrlPlaceholder
    : "";
  const effectiveBaseUrl =
    baseUrlValue || (hasProviderOverride ? providerDefaultBaseUrl : defaultBaseUrl);
  const hasSavedKey = Boolean(apiKeyHint || defaultApiKeyHint);
  const keyHint = apiKeyHint
    ? formatSecretHint(apiKeyHint)
    : defaultApiKeyHint
      ? `inherits ${formatSecretHint(defaultApiKeyHint)}`
      : "Not set";
  const { availableModels, isLoadingModels, modelsError } = useLlmModels({
    provider: selectedProvider,
    baseUrl: baseUrlValue,
    apiKey: apiKeyValue,
    showBaseUrl: providerConfig.showBaseUrl,
    showApiKey: providerConfig.showApiKey,
    enabled:
      supportsModelSuggestions &&
      (!providerConfig.requiresApiKey || Boolean(apiKeyValue.trim() || hasSavedKey)),
    hasSavedKey,
    purpose,
  });
  const modelOptions = buildModelOptions({
    models: availableModels,
    emptyLabel: "Inherit purpose default",
    emptyValue: "",
    fallbackValue: modelValue,
  });

  const modelHelper = supportsModelSuggestions
    ? isLoadingModels
      ? "Loading available models..."
      : modelsError
        ? modelsError
        : "Leave blank to inherit the purpose default."
    : `Type the exact model name, or leave blank to use the default from ${providerConfig.label}.`;

  return (
    <div className="space-y-2">
      <label htmlFor={`${purpose}-provider`} className="text-sm font-medium">
        Provider
      </label>
      <Select
        value={value?.provider ?? "__inherit__"}
        onValueChange={(nextValue) => {
          onChange(purpose, "provider", nextValue === "__inherit__" ? null : nextValue);
          onChange(purpose, "baseUrl", null);
          onChange(purpose, "model", null);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={`${purpose}-provider`} className="h-9">
          <SelectValue placeholder="Inherit default" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__inherit__">Inherit default</SelectItem>
          {LLM_PROVIDERS.map((provider) => (
            <SelectItem key={provider} value={provider}>
              {LLM_PROVIDER_LABELS[provider]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="text-xs text-muted-foreground">
        Current:{" "}
        <span className="font-mono">
          {hasProviderOverride ? selectedProvider : `inherits ${defaultProvider}`}
        </span>
      </div>

      {hasProviderOverride && isCodexProvider ? <CodexAuthPanel isBusy={disabled} /> : null}
      {hasProviderOverride && isGeminiCliProvider ? <GeminiCliSetupHint /> : null}
      {hasProviderOverride && isClaudeCliProvider ? <ClaudeCliSetupHint /> : null}

      {hasProviderOverride && providerConfig.showBaseUrl ? (
        <SettingsInput
          label="Base URL"
          inputProps={{
            name: `${purpose}.baseUrl`,
            value: baseUrlValue,
            onChange: (event) => onChange(purpose, "baseUrl", event.target.value),
          }}
          placeholder={providerConfig.baseUrlPlaceholder}
          disabled={disabled}
          helper={providerConfig.baseUrlHelper}
          current={effectiveBaseUrl}
        />
      ) : null}

      {hasProviderOverride && providerConfig.showApiKey ? (
        <SettingsInput
          label={providerConfig.requiresApiKey ? "API key" : "API key (optional)"}
          inputProps={{
            name: `${purpose}.apiKey`,
            value: apiKeyValue,
            onChange: (event) => onApiKeyChange(purpose, event.target.value),
          }}
          type="password"
          placeholder={
            providerConfig.requiresApiKey ? "Paste a purpose key" : "Optional bearer token"
          }
          disabled={disabled}
          helper={renderKeyHelper(
            providerConfig.keyHelperText,
            providerConfig.keyHelperHref,
            hasSavedKey,
          )}
          current={keyHint}
        />
      ) : null}

      <ModelField
        id={`${purpose}-model`}
        label="Model"
        value={modelValue}
        onChange={(nextValue) => onChange(purpose, "model", nextValue)}
        supportsModelSuggestions={supportsModelSuggestions}
        options={modelOptions}
        placeholder={purposeProviderDefaultModel || "Inherit model"}
        helper={modelHelper}
        current={currentModel}
        disabled={disabled || isLoadingModels}
      />
    </div>
  );
}
