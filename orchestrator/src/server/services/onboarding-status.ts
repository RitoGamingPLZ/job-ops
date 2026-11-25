import { forbidden, unprocessableEntity } from "@infra/errors";
import { logger } from "@infra/logger";
import { getRequestId, isSystemAdmin } from "@infra/request-context";
import { getJobOpsAppStatus } from "@server/config/app-mode";
import { isDemoMode } from "@server/config/demo";
import { resolveLlmValidationEndpoint } from "@server/config/llm-validation-endpoint";
import { getSetting } from "@server/repositories/settings";
import { getCurrentAccountEntitlements } from "@server/services/account-entitlements";
import { enqueueAutoPdfRegenerationForSettingsChanges } from "@server/services/auto-pdf-regeneration";
import { syncCandidateLibrary } from "@server/services/candidate-library";
import { getCurrentDesignResume, getDesignResumeStatus } from "@server/services/design-resume";
import { getOriginalEnvValue } from "@server/services/envSettings";
import { canUseDefaultModel } from "@server/services/server-credentials";
import { resolveLlmApiKey } from "@server/services/llm/credentials";
import { isHostedLocalProvider } from "@server/services/llm/hosted-policy";
import { LlmService } from "@server/services/llm/service";
import { parseV5ResumeData } from "@server/services/resume-document/schema";
import { applySettingsUpdates } from "@server/services/settings-update";
import { mapGlmProviderAlias } from "@shared/settings-registry";
import type { UpdateSettingsInput } from "@shared/settings-schema";
import type {
  LlmProviderId,
  OnboardingRequirement,
  OnboardingRequirementPrimaryAction,
  OnboardingRequirementStatus,
  OnboardingStatusResponse,
  ResumeV5Document,
} from "@shared/types";
import { LLM_PROVIDER_VALUES } from "@shared/types";

export type ValidationResponse = {
  valid: boolean;
  message: string | null;
  status?: number | null;
};

export type OnboardingModelActionInput = {
  provider?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
};

export type OnboardingProfileActionInput = {
  country?: string | null;
  cities: string[];
  workplaceTypes: Array<"remote" | "hybrid" | "onsite">;
};

export type OnboardingResumeConfirmActionInput = {
  source: string;
};

function normalizeLlmProviderValue(provider: string | null | undefined): LlmProviderId | undefined {
  if (!provider) return undefined;
  const normalized = provider.trim().toLowerCase().replace(/[-.]/g, "_");
  const mapped = mapGlmProviderAlias(normalized);
  if (mapped === "claude") return "anthropic";
  return (LLM_PROVIDER_VALUES as readonly string[]).includes(mapped)
    ? (mapped as LlmProviderId)
    : undefined;
}

const CLI_PROVIDERS = new Set(["codex", "gemini_cli", "claude_cli"]);

export async function validateLlm(options: {
  apiKey?: string | null;
  provider?: string | null;
  baseUrl?: string | null;
}): Promise<ValidationResponse> {
  const hostedMode = getJobOpsAppStatus().appMode === "hosted";
  const restricted = hostedMode || !isSystemAdmin();
  const [storedApiKey, storedProvider, storedBaseUrl] = await Promise.all([
    getSetting("llmApiKey"),
    getSetting("llmProvider"),
    getSetting("llmBaseUrl"),
  ]);

  const normalizedProvider = normalizeLlmProviderValue(
    options.provider?.trim() ||
      storedProvider?.trim() ||
      (restricted ? (hostedMode ? "openrouter" : "gemini") : undefined),
  );
  const {
    usesBaseUrl: shouldUseBaseUrl,
    baseUrl: resolvedBaseUrl,
    hasCustomUserBaseUrl,
  } = resolveLlmValidationEndpoint({
    provider: normalizedProvider,
    override: options.baseUrl,
    stored: storedBaseUrl,
    environment: restricted ? undefined : getOriginalEnvValue("LLM_BASE_URL"),
    fallbackToDefault: false,
  });
  const resolvedApiKey = resolveLlmApiKey({
    storedApiKey: options.apiKey ?? storedApiKey,
    provider: normalizedProvider,
    allowEnvironmentCredentials: !restricted,
  });

  if (
    restricted &&
    (CLI_PROVIDERS.has(normalizedProvider ?? "") ||
      isHostedLocalProvider(normalizedProvider) ||
      hasCustomUserBaseUrl)
  ) {
    return {
      valid: false,
      message: "Hosted LLM providers must use supported public provider endpoints.",
    };
  }

  logger.debug("LLM onboarding validation resolved config", {
    provider: normalizedProvider ?? null,
    usesBaseUrl: shouldUseBaseUrl,
    hasBaseUrl: Boolean(resolvedBaseUrl),
    hasApiKey: Boolean(resolvedApiKey),
  });

  const llm = new LlmService({
    apiKey: resolvedApiKey,
    provider: normalizedProvider,
    baseUrl: resolvedBaseUrl,
    allowEnvironmentCredentials: !restricted,
    allowCliProviders: !restricted,
  });
  return llm.validateCredentials();
}

export async function validateResumeConfig(): Promise<ValidationResponse> {
  try {
    const localStatus = await getDesignResumeStatus();
    if (localStatus.exists) {
      return { valid: true, message: null };
    }
    return {
      valid: false,
      message: "No local resume is ready yet. Upload a PDF, DOCX, or resume JSON file.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resume validation failed.";
    return { valid: false, message };
  }
}

function isUnavailable(validation: ValidationResponse): boolean {
  if (validation.status === 0 || (validation.status ?? 0) >= 500) return true;
  const message = validation.message?.toLowerCase() ?? "";
  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnrefused",
    "unavailable",
    "failed to fetch",
  ].some((needle) => message.includes(needle));
}

function getModelValidationMessage(args: {
  validation: ValidationResponse;
  provider: LlmProviderId | undefined;
  providerLabel: string;
}): string {
  const baseMessage =
    args.validation.message ||
    `Job Ops could not verify ${args.providerLabel}. Check the connection and try again.`;

  if (args.provider === "ollama" && isUnavailable(args.validation)) {
    return `${baseMessage} Local Ollama models can be slow or unavailable on smaller hardware. Try a smaller or faster model, make sure Ollama is reachable from the Job Ops container, add more CPU/GPU/RAM, or switch provider from the model step.`;
  }

  return baseMessage;
}

function buildRequirement(args: {
  id: OnboardingRequirement["id"];
  status: OnboardingRequirementStatus;
  title: string;
  message: string;
  primaryAction: OnboardingRequirementPrimaryAction;
  details?: Record<string, unknown>;
}): OnboardingRequirement {
  return {
    id: args.id,
    status: args.status,
    title: args.title,
    message: args.message,
    primaryAction: args.primaryAction,
    ...(args.details ? { details: args.details } : {}),
  };
}

async function buildModelRequirement(): Promise<OnboardingRequirement> {
  const hostedMode = getJobOpsAppStatus().appMode === "hosted";
  const nonAdminLocal = !hostedMode && !isSystemAdmin();
  const [provider, baseUrl, model, completed, apiKey] = await Promise.all([
    getSetting("llmProvider"),
    getSetting("llmBaseUrl"),
    getSetting("model"),
    getSetting("onboardingLlmCompleted"),
    nonAdminLocal ? getSetting("llmApiKey") : Promise.resolve(null),
  ]);
  const normalizedProvider = normalizeLlmProviderValue(provider);
  const providerLabel = normalizedProvider ?? "selected provider";

  if (
    nonAdminLocal &&
    (!apiKey?.trim() ||
      CLI_PROVIDERS.has(normalizedProvider ?? "") ||
      isHostedLocalProvider(normalizedProvider))
  ) {
    return buildRequirement({
      id: "model",
      status: "needs_action",
      title: "Add your own AI API key",
      message:
        "Your account does not include the server default model. Add and verify your own AI provider API key before using Job Ops.",
      primaryAction: "connect_model",
      details: {
        provider:
          CLI_PROVIDERS.has(normalizedProvider ?? "") || isHostedLocalProvider(normalizedProvider)
            ? null
            : (normalizedProvider ?? null),
        baseUrl: null,
      },
    });
  }

  if (completed === "1") {
    if (normalizedProvider === "codex") {
      const validation = await validateLlm({ provider: "codex" });
      if (!validation.valid) {
        return buildRequirement({
          id: "model",
          status: "needs_action",
          title: "Reconnect Codex",
          message:
            validation.message ||
            "The saved Codex sign-in is no longer usable. Sign in again before continuing.",
          primaryAction: "connect_model",
          details: {
            provider: normalizedProvider,
            baseUrl: null,
          },
        });
      }
    }

    if (normalizedProvider === "litellm" && !model?.trim()) {
      return buildRequirement({
        id: "model",
        status: "needs_action",
        title: "Choose a LiteLLM model",
        message:
          "LiteLLM is connected. Choose one of the models your proxy serves before continuing.",
        primaryAction: "connect_model",
        details: {
          provider: normalizedProvider,
          baseUrl: baseUrl?.trim() || null,
        },
      });
    }

    if (normalizedProvider === "ollama" && !model?.trim()) {
      return buildRequirement({
        id: "model",
        status: "needs_action",
        title: "Choose an Ollama model",
        message:
          "Ollama is connected. Choose one of the models installed in Ollama before continuing.",
        primaryAction: "connect_model",
        details: {
          provider: normalizedProvider,
          baseUrl: baseUrl?.trim() || null,
        },
      });
    }

    return buildRequirement({
      id: "model",
      status: "ready",
      title: "Model connected",
      message:
        "The LLM is ready to power scoring, tailoring, ghostwriting, and email classification.",
      primaryAction: "none",
      details: {
        provider: normalizedProvider ?? null,
        baseUrl: baseUrl?.trim() || null,
      },
    });
  }
  return buildRequirement({
    id: "model",
    status: "needs_action",
    title: "Connect your AI provider",
    message: `Choose and verify ${providerLabel}. The connection is saved only after the server confirms it can be used.`,
    primaryAction: "connect_model",
    details: {
      provider: normalizedProvider ?? null,
      baseUrl: baseUrl?.trim() || null,
    },
  });
}

async function buildResumeRequirement(): Promise<OnboardingRequirement> {
  const [localStatus, confirmedSource] = await Promise.all([
    getDesignResumeStatus(),
    getSetting("onboardingResumeConfirmedSource"),
  ]);
  if (localStatus.exists) {
    const source = `local:${localStatus.documentId}`;
    return buildRequirement({
      id: "resume",
      status: confirmedSource === source ? "ready" : "needs_action",
      title: confirmedSource === source ? "Resume confirmed" : "Review your resume",
      message:
        confirmedSource === source
          ? "You confirmed the resume Job Ops should use for matching and applications."
          : "Check the parsed resume, then confirm that Job Ops loaded the correct document.",
      primaryAction: confirmedSource === source ? "none" : "confirm_resume",
      details: {
        source: "local",
        confirmationSource: source,
        documentId: localStatus.documentId ?? null,
        updatedAt: localStatus.updatedAt ?? null,
      },
    });
  }

  return buildRequirement({
    id: "resume",
    status: "needs_action",
    title: "Load your resume",
    message:
      "Upload your existing resume as a PDF, DOCX or JSON file. Job Ops uses it as the baseline for matching, fit assessment, and application workflows.",
    primaryAction: "upload_resume",
    details: { source: "none" },
  });
}

async function buildHostedResumeRequirement(): Promise<OnboardingRequirement> {
  const localStatus = await getDesignResumeStatus();
  if (localStatus.exists) {
    return buildRequirement({
      id: "resume",
      status: "ready",
      title: "Resume loaded",
      message:
        "Your resume is ready to drive job matching, fit assessment, search terms, and application workflows.",
      primaryAction: "none",
      details: {
        source: "local",
        documentId: localStatus.documentId ?? null,
        updatedAt: localStatus.updatedAt ?? null,
      },
    });
  }

  return buildRequirement({
    id: "resume",
    status: "needs_action",
    title: "Upload your existing resume, PDF or DOCX",
    message:
      "Upload your existing resume as a PDF or DOCX. Job Ops will use it as the baseline for matching, fit assessment, search terms, and application workflows.",
    primaryAction: "upload_resume",
    details: { source: "upload" },
  });
}

async function migrateLegacyOnboardingState(args: {
  hostedMode: boolean;
  userEditableLlmSettings: boolean;
}): Promise<void> {
  if ((await getSetting("onboardingLegacyMigrationPending")) !== "1") return;

  const update: UpdateSettingsInput = {
    onboardingProfileCompleted: true,
    onboardingLegacyMigrationPending: false,
  };

  if (args.userEditableLlmSettings) {
    const [provider, model, validation] = await Promise.all([
      getSetting("llmProvider"),
      getSetting("model"),
      validateLlm({}),
    ]);
    const normalizedProvider = normalizeLlmProviderValue(provider);
    update.onboardingLlmCompleted =
      validation.valid &&
      !((normalizedProvider === "ollama" || normalizedProvider === "litellm") && !model?.trim());
  }

  if (!args.hostedMode) {
    const localStatus = await getDesignResumeStatus();
    if (localStatus.exists && localStatus.documentId) {
      update.onboardingResumeConfirmedSource = `local:${localStatus.documentId}`;
    }
  }

  await applySettingsUpdates(update);
  logger.info("Migrated legacy onboarding state", {
    requestId: getRequestId() ?? null,
    modelReady: update.onboardingLlmCompleted ?? null,
    resumeReady: Boolean(update.onboardingResumeConfirmedSource),
  });
}

export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  const appStatus = getJobOpsAppStatus();
  const hostedMode = appStatus.appMode === "hosted";
  const nonAdminLocal = !hostedMode && !isSystemAdmin();
  const userEditableLlmSettings = hostedMode
    ? (await getCurrentAccountEntitlements()).userEditableLlmSettings
    : nonAdminLocal
      ? !(await canUseDefaultModel())
      : appStatus.capabilities.userEditableLlmSettings;

  if (isDemoMode()) {
    const requirements: OnboardingRequirement[] = [
      buildRequirement({
        id: "profile",
        status: "ready",
        title: "Search preferences saved",
        message: "Demo mode includes search preferences.",
        primaryAction: "none",
      }),
      ...(userEditableLlmSettings
        ? [
            buildRequirement({
              id: "model",
              status: "ready",
              title: "Model connected",
              message: "Demo mode simulates the model connection.",
              primaryAction: "none",
            }),
          ]
        : []),
      buildRequirement({
        id: "resume",
        status: "ready",
        title: "Resume loaded",
        message: "Demo mode includes a ready resume.",
        primaryAction: "none",
      }),
    ];
    return { complete: true, nextRequirementId: null, requirements };
  }

  await migrateLegacyOnboardingState({
    hostedMode,
    userEditableLlmSettings,
  });

  const profileCompleted = await getSetting("onboardingProfileCompleted");
  const profileRequirement = buildRequirement({
    id: "profile",
    status: profileCompleted === "1" ? "ready" : "needs_action",
    title: profileCompleted === "1" ? "Search preferences saved" : "Tell us where you want to work",
    message:
      profileCompleted === "1"
        ? "Your location and workplace preferences will seed future runs."
        : "Add your preferred locations and workplace style so Job Ops can prepare sensible run defaults and sponsor-focused sources.",
    primaryAction: profileCompleted === "1" ? "none" : "save_profile",
  });
  // The system admin only manages users and server-wide settings, so their setup is just the
  // server's default AI connection. Search preferences and a resume belong to job-seeking users.
  const adminSetup = !hostedMode && isSystemAdmin();
  const requirements = adminSetup
    ? userEditableLlmSettings
      ? [await buildModelRequirement()]
      : []
    : userEditableLlmSettings
      ? [
          profileRequirement,
          await buildModelRequirement(),
          hostedMode ? await buildHostedResumeRequirement() : await buildResumeRequirement(),
        ]
      : [
          profileRequirement,
          hostedMode ? await buildHostedResumeRequirement() : await buildResumeRequirement(),
        ];
  const nextRequirement = requirements.find((requirement) => requirement.status !== "ready");

  return {
    complete: !nextRequirement,
    nextRequirementId: nextRequirement?.id ?? null,
    requirements,
  };
}

async function persistOnboardingSettings(input: UpdateSettingsInput, route: string): Promise<void> {
  const plan = await applySettingsUpdates(input);
  queueMicrotask(() => {
    void enqueueAutoPdfRegenerationForSettingsChanges({
      updatedSettingKeys: plan.updatedSettingKeys,
      requestedBy: "user",
    }).catch((error) => {
      logger.warn("Failed to queue auto PDF regeneration for onboarding", {
        route,
        updatedSettingKeys: plan.updatedSettingKeys,
        error,
      });
    });
  });
}

export async function saveOnboardingModelAction(
  input: OnboardingModelActionInput,
): Promise<OnboardingStatusResponse> {
  const hostedMode = getJobOpsAppStatus().appMode === "hosted";
  if (hostedMode && !(await getCurrentAccountEntitlements()).userEditableLlmSettings) {
    throw forbidden("This hosted account uses the included AI provider.");
  }
  const provider = normalizeLlmProviderValue(input.provider);
  const restricted = hostedMode || !isSystemAdmin();
  if (
    restricted &&
    (CLI_PROVIDERS.has(provider ?? "") ||
      isHostedLocalProvider(provider) ||
      Boolean(input.baseUrl?.trim()))
  ) {
    throw forbidden(
      "CLI, local, and custom-endpoint LLM providers are unavailable for this account.",
    );
  }
  const [storedProvider, storedModel] = await Promise.all([
    getSetting("llmProvider"),
    getSetting("model"),
  ]);
  const storedNormalizedProvider = normalizeLlmProviderValue(storedProvider);
  const hasInputModel = Boolean(input.model?.trim());
  const hasSavedOllamaModel =
    provider === "ollama" && storedNormalizedProvider === "ollama" && Boolean(storedModel?.trim());

  const hasSavedLiteLlmModel =
    provider === "litellm" &&
    storedNormalizedProvider === "litellm" &&
    Boolean(storedModel?.trim());

  if (provider === "litellm" && !hasInputModel && !hasSavedLiteLlmModel) {
    throw unprocessableEntity(
      "Choose a LiteLLM model before continuing. If no models appear, check the proxy URL and virtual key.",
      {
        provider,
        status: null,
      },
    );
  }

  if (provider === "ollama" && !hasInputModel && !hasSavedOllamaModel) {
    throw unprocessableEntity(
      "Choose an Ollama model before continuing. If no models appear, pull a model in Ollama and try again.",
      {
        provider,
        status: null,
      },
    );
  }

  const validation = await validateLlm({
    provider,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
  });
  const route = "POST /api/onboarding/actions/model";

  logger.info("Onboarding model validation completed", {
    requestId: getRequestId() ?? null,
    route,
    provider: provider ?? null,
    validationStatus: validation.valid ? "valid" : "invalid",
  });

  if (!validation.valid) {
    throw unprocessableEntity(
      getModelValidationMessage({
        validation,
        provider,
        providerLabel: provider ?? "selected provider",
      }),
      {
        provider: provider ?? null,
        status: validation.status ?? null,
      },
    );
  }

  const update: UpdateSettingsInput = {};
  if (provider) update.llmProvider = provider;
  if (input.baseUrl !== undefined) update.llmBaseUrl = input.baseUrl ?? "";
  if (input.apiKey?.trim()) update.llmApiKey = input.apiKey.trim();
  if (input.model?.trim()) update.model = input.model.trim();
  update.onboardingLlmCompleted = true;

  await persistOnboardingSettings(update, route);
  return getOnboardingStatus();
}

export async function saveOnboardingProfileAction(
  input: OnboardingProfileActionInput,
): Promise<OnboardingStatusResponse> {
  const route = "POST /api/onboarding/actions/profile";
  await persistOnboardingSettings(
    {
      searchCities: input.cities.join("|"),
      workplaceTypes: input.workplaceTypes,
      jobspyCountryIndeed: input.country?.trim() || null,
      onboardingProfileCompleted: true,
    },
    route,
  );
  return getOnboardingStatus();
}

async function syncCandidateLibraryForOnboardingSource(source: string): Promise<void> {
  try {
    if (source.startsWith("local:")) {
      const designResume = await getCurrentDesignResume();
      if (designResume?.resumeJson) {
        syncCandidateLibrary(
          parseV5ResumeData(
            designResume.resumeJson as Record<string, unknown>,
          ) as unknown as ResumeV5Document,
        );
      }
      return;
    }
  } catch (error) {
    logger.warn("Failed to sync candidate library during onboarding resume confirmation", {
      requestId: getRequestId(),
      route: "POST /api/onboarding/actions/resume/confirm",
      source,
      error,
    });
  }
}

export async function confirmOnboardingResumeAction(
  input: OnboardingResumeConfirmActionInput,
): Promise<OnboardingStatusResponse> {
  const localStatus = await getDesignResumeStatus();
  const validSources = new Set<string>();
  if (localStatus.exists && localStatus.documentId) {
    validSources.add(`local:${localStatus.documentId}`);
  }
  if (!validSources.has(input.source)) {
    throw unprocessableEntity(
      "The selected resume changed before it could be confirmed. Review the current resume and try again.",
      { source: input.source },
    );
  }
  await persistOnboardingSettings(
    { onboardingResumeConfirmedSource: input.source },
    "POST /api/onboarding/actions/resume/confirm",
  );
  await syncCandidateLibraryForOnboardingSource(input.source);
  return getOnboardingStatus();
}
