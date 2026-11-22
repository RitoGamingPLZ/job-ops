import * as api from "@client/api";
import type { LlmProviderId } from "@client/pages/settings/utils";
import type { LlmPurpose } from "@shared/types";
import { useEffect, useState } from "react";

/**
 * Loads model suggestions for a provider. Keeps the previous list while a new
 * request is in flight and ignores results from superseded requests.
 */
export function useLlmModels(input: {
  provider: LlmProviderId;
  baseUrl: string;
  apiKey: string;
  showBaseUrl: boolean;
  showApiKey: boolean;
  enabled: boolean;
  hasSavedKey?: boolean;
  purpose?: LlmPurpose;
}): {
  availableModels: string[];
  isLoadingModels: boolean;
  modelsError: string | null;
} {
  const {
    provider,
    baseUrl,
    apiKey,
    showBaseUrl,
    showApiKey,
    enabled,
    hasSavedKey,
    purpose,
  } = input;
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    void hasSavedKey;
    if (!enabled) {
      setAvailableModels([]);
      setModelsError(null);
      setIsLoadingModels(false);
      return;
    }

    let cancelled = false;
    setIsLoadingModels(true);
    setModelsError(null);

    void api
      .getLlmModels({
        provider,
        baseUrl: showBaseUrl ? baseUrl.trim() || undefined : undefined,
        apiKey: showApiKey ? apiKey.trim() || undefined : undefined,
        purpose,
      })
      .then((models) => {
        if (cancelled) return;
        setAvailableModels(models);
      })
      .catch((error) => {
        if (cancelled) return;
        setAvailableModels([]);
        setModelsError(
          error instanceof Error ? error.message : "Failed to load models.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    provider,
    baseUrl,
    apiKey,
    showBaseUrl,
    showApiKey,
    enabled,
    hasSavedKey,
    purpose,
  ]);

  return { availableModels, isLoadingModels, modelsError };
}
