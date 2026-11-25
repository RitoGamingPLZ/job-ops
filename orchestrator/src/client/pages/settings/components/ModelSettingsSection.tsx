import { LlmModelConfiguration } from "@client/components/llmmodelconfiguration/LlmModelConfiguration";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { ModelValues } from "@client/pages/settings/types";
import {
  type LlmProviderId,
  normalizeLlmProvider,
  RESTRICTED_LLM_PROVIDERS,
} from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type { LlmPurpose } from "@shared/types.js";
import type React from "react";
import { useFormContext } from "react-hook-form";

type ModelSettingsSectionProps = {
  values: ModelValues;
  isLoading: boolean;
  isSaving: boolean;
  restrictProviders?: boolean;
  defaultModelStatus?: "granted" | "required" | null;
  layoutMode?: "accordion" | "panel";
};

export const ModelSettingsSection: React.FC<ModelSettingsSectionProps> = ({
  values,
  isLoading,
  isSaving,
  restrictProviders = false,
  defaultModelStatus = null,
  layoutMode,
}) => {
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();
  const rawProvider = normalizeLlmProvider(
    watch("llmProvider") || values.llmProvider || (restrictProviders ? "gemini" : "openrouter"),
  );
  const selectedProvider =
    restrictProviders && !(RESTRICTED_LLM_PROVIDERS as readonly string[]).includes(rawProvider)
      ? "gemini"
      : rawProvider;
  const disabled = isLoading || isSaving;

  const setStringField = (
    field: keyof Pick<
      UpdateSettingsInput,
      | "llmBaseUrl"
      | "llmApiKey"
      | "model"
      | "modelScorer"
      | "modelTailoring"
      | "modelProjectSelection"
    >,
    value: string,
  ) => {
    setValue(field, value, { shouldDirty: true, shouldValidate: true });
  };

  const purposeOverrides = watch("llmPurposeOverrides") ?? {};
  const purposeApiKeys = watch("llmPurposeApiKeys") ?? {};

  const setPurposeOverride = (
    purpose: LlmPurpose,
    field: "provider" | "baseUrl" | "model",
    value: string | null,
  ) => {
    const current = watch("llmPurposeOverrides") ?? {};
    const nextPurpose = { ...current[purpose] };
    if (value === null || value === "") {
      delete nextPurpose[field];
    } else {
      nextPurpose[field] = value as never;
    }

    const next = { ...current };
    if (Object.keys(nextPurpose).length === 0) {
      delete next[purpose];
    } else {
      next[purpose] = nextPurpose;
    }

    setValue("llmPurposeOverrides", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const setPurposeApiKey = (purpose: LlmPurpose, value: string) => {
    setValue(`llmPurposeApiKeys.${purpose}`, value, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <SettingsSectionFrame mode={layoutMode} title="Model" value="model">
      <LlmModelConfiguration
        mode="settings"
        disabled={disabled}
        restrictProviders={restrictProviders}
        defaultModelStatus={defaultModelStatus}
        selectedProvider={selectedProvider}
        savedProvider={values.llmProvider}
        savedBaseUrl={values.llmBaseUrl}
        apiKeyHint={values.llmApiKeyHint}
        effectiveModel={values.effective}
        defaultModel={values.default}
        provider={{
          value: selectedProvider,
          onChange: (value) =>
            setValue("llmProvider", value as LlmProviderId, {
              shouldDirty: true,
              shouldValidate: true,
            }),
          error: errors.llmProvider?.message as string | undefined,
        }}
        baseUrl={{
          value: watch("llmBaseUrl") ?? "",
          onChange: (value) => setStringField("llmBaseUrl", value),
          error: errors.llmBaseUrl?.message as string | undefined,
        }}
        apiKey={{
          value: watch("llmApiKey") ?? "",
          onChange: (value) => setStringField("llmApiKey", value),
          error: errors.llmApiKey?.message as string | undefined,
        }}
        model={{
          value: watch("model") ?? "",
          onChange: (value) => setStringField("model", value),
          error: errors.model?.message as string | undefined,
        }}
        modelScorer={{
          value: watch("modelScorer") ?? "",
          onChange: (value) => setStringField("modelScorer", value),
          error: errors.modelScorer?.message as string | undefined,
        }}
        modelTailoring={{
          value: watch("modelTailoring") ?? "",
          onChange: (value) => setStringField("modelTailoring", value),
          error: errors.modelTailoring?.message as string | undefined,
        }}
        modelProjectSelection={{
          value: watch("modelProjectSelection") ?? "",
          onChange: (value) => setStringField("modelProjectSelection", value),
          error: errors.modelProjectSelection?.message as string | undefined,
        }}
        purposeOverrides={{
          values: purposeOverrides,
          apiKeys: purposeApiKeys,
          apiKeyHints: values.llmPurposeApiKeyHints,
          models: {
            scoring: values.scorer,
            tailoring: values.tailoring,
            projectSelection: values.projectSelection,
          },
          onChange: setPurposeOverride,
          onApiKeyChange: setPurposeApiKey,
        }}
      />
    </SettingsSectionFrame>
  );
};
