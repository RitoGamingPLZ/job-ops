import * as api from "@client/api";
import { fileToDataUrl } from "@client/components/design-resume/utils";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useSettings } from "@client/hooks/useSettings";
import { queryKeys } from "@client/lib/queryKeys";
import { normalizeLlmProvider } from "@client/pages/settings/utils";
import type { AppSettings, OnboardingStatusResponse } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { bucketCount, trackProductEvent } from "@/lib/analytics";
import {
  getDurationBucket,
  getEndpointMode,
  getErrorCategory,
  getFileSizeBucket,
  getFileType,
  getHttpStatusBucket,
} from "./analytics";
import type { OnboardingFormData } from "./types";

export function useOnboardingFlow() {
  const queryClient = useQueryClient();
  const { settings, isLoading: settingsLoading } = useSettings();
  const demoInfo = useDemoInfo();
  const demoMode = demoInfo?.demoMode ?? false;

  const [isSaving, setIsSaving] = useState(false);
  const [isImportingResume, setIsImportingResume] = useState(false);
  const [importingResumeFileName, setImportingResumeFileName] = useState<string | null>(null);

  const { getValues, reset, setValue, watch } = useForm<OnboardingFormData>({
    defaultValues: {
      llmProvider: "",
      llmBaseUrl: "",
      llmApiKey: "",
      model: "",
      pdfRenderer: "typst",
    },
  });

  const syncSettingsCache = useCallback(
    (nextSettings: AppSettings) => {
      queryClient.setQueryData(queryKeys.settings.current(), nextSettings);
    },
    [queryClient],
  );

  const refreshOnboardingState = useCallback(
    async (status?: OnboardingStatusResponse) => {
      if (status) {
        queryClient.setQueryData(queryKeys.onboarding.status(), status);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.designResume.all }),
      ]);
    },
    [queryClient],
  );

  useEffect(() => {
    if (!settings) return;

    reset({
      llmProvider: settings.llmProvider?.value || "",
      llmBaseUrl: settings.llmBaseUrl?.value || "",
      llmApiKey: "",
      model: settings.model?.override ?? "",
      pdfRenderer: "typst",
    });
  }, [reset, settings]);

  const llmProvider = watch("llmProvider");
  const selectedProvider = normalizeLlmProvider(
    llmProvider || settings?.llmProvider?.value || "openrouter",
  );

  const handleSaveModel = useCallback(async () => {
    const values = getValues();
    const provider = selectedProvider;

    trackProductEvent("onboarding_model_verify_submitted", {
      provider,
      endpoint_mode: getEndpointMode(values.llmBaseUrl),
      has_key_input: Boolean(values.llmApiKey.trim()),
      has_model_input: Boolean(values.model.trim()),
    });

    try {
      setIsSaving(true);
      const status = await api.saveOnboardingModel({
        provider,
        baseUrl: values.llmBaseUrl.trim() || null,
        apiKey: values.llmApiKey.trim() || null,
        model: values.model.trim() || null,
      });
      await refreshOnboardingState(status);
      trackProductEvent("onboarding_model_verify_completed", {
        result: "success",
        provider,
      });
      toast.success("Model connection verified");
      return status;
    } catch (error) {
      trackProductEvent("onboarding_model_verify_completed", {
        result: "error",
        provider,
        error_category: getErrorCategory(error),
        http_status_bucket: getHttpStatusBucket(error),
      });
      showErrorToast(error, "Failed to verify model connection");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [getValues, refreshOnboardingState, selectedProvider]);

  const handleImportResumeFile = useCallback(
    async (file: File) => {
      const startedAt = Date.now();
      const fileType = getFileType(file);
      trackProductEvent("onboarding_resume_upload_submitted", {
        file_type: fileType,
        file_size_bucket: getFileSizeBucket(file),
        was_reimport: Boolean(settings?.pdfRenderer?.value),
      });

      try {
        setImportingResumeFileName(file.name);
        setIsImportingResume(true);
        const dataUrl = await fileToDataUrl(file);
        const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

        if (!match) {
          throw new Error("Resume file could not be encoded for upload.");
        }

        const document = await api.importDesignResumeFromFile({
          fileName: file.name,
          mediaType: file.type || match[1],
          dataBase64: match[2],
        });

        queryClient.setQueryData(queryKeys.designResume.current(), document);
        queryClient.setQueryData(queryKeys.designResume.status(), {
          exists: true,
          documentId: document.id,
          updatedAt: document.updatedAt,
        });

        if (settings?.pdfRenderer?.value !== "typst") {
          const nextSettings = await api.updateSettings({
            pdfRenderer: "typst",
          });
          syncSettingsCache(nextSettings);
          setValue("pdfRenderer", "typst");
        }

        await refreshOnboardingState();
        trackProductEvent("onboarding_resume_upload_completed", {
          result: "success",
          file_type: fileType,
          duration_bucket: getDurationBucket(startedAt),
          section_count_bucket: bucketCount(
            Object.keys(
              ((document as { sections?: Record<string, unknown> }).sections ?? {}) as Record<
                string,
                unknown
              >,
            ).length,
          ),
        });
        toast.success("Resume uploaded", {
          description:
            settings?.pdfRenderer?.value === "typst"
              ? "Your local base resume document is ready."
              : "Your local base resume document is ready and PDF rendering was switched to Typst.",
        });
      } catch (error) {
        trackProductEvent("onboarding_resume_upload_completed", {
          result: "error",
          file_type: fileType,
          duration_bucket: getDurationBucket(startedAt),
          error_category: getErrorCategory(error),
        });
        showErrorToast(error, "Failed to import resume file");
      } finally {
        setIsImportingResume(false);
        setImportingResumeFileName(null);
      }
    },
    [
      queryClient,
      refreshOnboardingState,
      settings?.pdfRenderer?.value,
      setValue,
      syncSettingsCache,
    ],
  );

  const isBusy = isSaving || settingsLoading || isImportingResume;

  return {
    demoMode,
    handleImportResumeFile,
    handleSaveModel,
    isBusy,
    isImportingResume,
    importingResumeFileName,
    llmKeyHint: settings?.llmApiKeyHint ?? null,
    selectedProvider,
    settings,
    settingsLoading,
    setValue,
    watch,
  };
}
