import * as api from "@client/api";
import { PageHeader } from "@client/components/layout";
import {
  type SectionWorkspaceBadge,
  SectionWorkspaceNav,
  SectionWorkspacePanel,
  sectionWorkspaceItemMatchesSearch,
} from "@client/components/section-workspace/SectionWorkspace";
import { useUpdateSettingsMutation } from "@client/hooks/queries/useSettingsMutation";
import { BackupSettingsSection } from "@client/pages/settings/components/BackupSettingsSection";
import { BillingSettingsSection } from "@client/pages/settings/components/BillingSettingsSection";
import { ChatSettingsSection } from "@client/pages/settings/components/ChatSettingsSection";
import { DangerZoneSection } from "@client/pages/settings/components/DangerZoneSection";
import { DisplaySettingsSection } from "@client/pages/settings/components/DisplaySettingsSection";
import { EnvironmentSettingsSection } from "@client/pages/settings/components/EnvironmentSettingsSection";
import { ModelSettingsSection } from "@client/pages/settings/components/ModelSettingsSection";
import { PromptTemplatesSection } from "@client/pages/settings/components/PromptTemplatesSection";
import { ResumePdfSection } from "@client/pages/settings/components/ResumePdfSection";
import { ScoringSettingsSection } from "@client/pages/settings/components/ScoringSettingsSection";
import { WebhooksSection } from "@client/pages/settings/components/WebhooksSection";
import {
  type LlmProviderId,
  normalizeLlmProvider,
  resumeProjectsEqual,
} from "@client/pages/settings/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { normalizeStringArray } from "@shared/normalize-string-array.js";
import { type UpdateSettingsInput, updateSettingsSchema } from "@shared/settings-schema.js";
import type { AppSettings, JobStatus } from "@shared/types.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, type Resolver, useForm, useWatch } from "react-hook-form";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import { Button } from "@/components/ui/button";

const DEFAULT_FORM_VALUES: UpdateSettingsInput = {
  model: "",
  modelScorer: "",
  modelTailoring: "",
  modelProjectSelection: "",
  llmProvider: null,
  llmBaseUrl: "",
  llmApiKey: "",
  llmPurposeOverrides: {},
  llmPurposeApiKeys: {},
  pipelineWebhookUrl: "",
  jobCompleteWebhookUrl: "",
  resumeProjects: null,
  pdfRenderer: "typst",
  typstTheme: "classic",
  pdfPaperSize: "auto",
  renderMarkdownInJobDescriptions: null,
  autoTailorOnManualImport: null,
  chatStyleTone: "",
  chatStyleFormality: "",
  chatStyleConstraints: "",
  chatStyleDoNotUse: "",
  ghostwriterStopSlopEnabled: null,
  chatStyleSummaryMaxWords: null,
  chatStyleMaxKeywordsPerSkill: null,
  chatStyleLanguageMode: null,
  chatStyleManualLanguage: null,
  ukvisajobsEmail: "",
  ukvisajobsPassword: "",
  adzunaAppId: "",
  adzunaAppKey: "",
  webhookSecret: "",
  pipelineScheduleEnabled: null,
  pipelineScheduleHour: null,
  backupEnabled: null,
  backupHour: null,
  backupMaxCount: null,
  penalizeMissingSalary: null,
  missingSalaryPenalty: null,
  autoSkipScoreThreshold: null,
  blockedCompanyKeywords: [],
  ghostwriterSystemPromptTemplate: "",
  resumeGenerationPromptTemplate: "",
  tailoringPromptTemplate: "",
  scoringPromptTemplate: "",
};

type LlmProviderValue = LlmProviderId | null;
type SettingsSectionId =
  | "billing"
  | "model"
  | "chat"
  | "prompt-templates"
  | "scoring"
  | "resume-pdf"
  | "webhooks"
  | "environment"
  | "display"
  | "backup"
  | "danger-zone";

type SettingsGroupId =
  | "account"
  | "ai"
  | "scoring"
  | "integrations"
  | "workspaces"
  | "display"
  | "backups"
  | "danger";

type SettingsSectionDescriptor = {
  id: SettingsSectionId;
  label: string;
  description: string;
  searchTerms: string[];
};

type SettingsNavGroup = {
  id: SettingsGroupId;
  items: SettingsSectionDescriptor[];
  label: string;
};

/** The system admin only manages server-wide settings; personal job, resume and writing settings stay hidden. */
const ADMIN_SETTINGS_SECTION_IDS: ReadonlySet<SettingsSectionId> = new Set([
  "model",
  "environment",
  "backup",
  "danger-zone",
]);

const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "account",
    label: "Account",
    items: [
      {
        id: "billing",
        label: "Plan & Billing",
        description: "Your hosted plan, included AI, and Stripe subscription.",
        searchTerms: ["plan", "billing", "subscription", "stripe", "pro"],
      },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      {
        id: "model",
        label: "Models",
        description: "Provider, API credentials, and task-specific overrides.",
        searchTerms: [
          "llm",
          "provider",
          "openai",
          "glm",
          "gemini",
          "gemini_cli",
          "claude",
          "claude_cli",
          "ollama",
          "litellm",
          "codex",
        ],
      },
      {
        id: "chat",
        label: "Writing Style",
        description: "Tone, language, presets, and writing constraints.",
        searchTerms: ["ghostwriter", "language", "tone", "formality"],
      },
      {
        id: "prompt-templates",
        label: "Prompt Templates",
        description: "Base AI instructions for Ghostwriter, tailoring, and scoring.",
        searchTerms: ["prompt", "templates", "system prompt", "instructions"],
      },
    ],
  },
  {
    id: "scoring",
    label: "Scoring",
    items: [
      {
        id: "scoring",
        label: "Rules & Filters",
        description: "Salary penalties, thresholds, keywords, and scorer hints.",
        searchTerms: ["threshold", "salary", "keywords", "instructions"],
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    items: [
      {
        id: "resume-pdf",
        label: "Resume PDF",
        description: "PDF renderer, theme, paper size, and project selection.",
        searchTerms: ["resume", "pdf", "projects", "template", "typst", "latex"],
      },
      {
        id: "webhooks",
        label: "Webhooks",
        description: "Pipeline and job completion event destinations.",
        searchTerms: ["hooks", "notifications", "pipeline", "applied"],
      },
    ],
  },
  {
    id: "workspaces",
    label: "Workspaces & Security",
    items: [
      {
        id: "environment",
        label: "Workspace Access",
        description: "Service credentials and authentication protection.",
        searchTerms: [
          "security",
          "auth",
          "adzuna",
          "ukvisajobs",
          "sso",
          "single sign-on",
          "oidc",
          "google",
          "github",
          "connected accounts",
          "password",
        ],
      },
    ],
  },
  {
    id: "display",
    label: "Display",
    items: [
      {
        id: "display",
        label: "Display Preferences",
        description: "Markdown rendering and import behavior.",
        searchTerms: ["markdown", "rendering", "appearance"],
      },
    ],
  },
  {
    id: "backups",
    label: "Backups",
    items: [
      {
        id: "backup",
        label: "Backups",
        description: "Daily job searches, automatic backups, retention, and manual snapshots.",
        searchTerms: [
          "recovery",
          "database",
          "restore",
          "schedule",
          "pipeline",
          "daily",
          "job search",
        ],
      },
    ],
  },
  {
    id: "danger",
    label: "Danger Zone",
    items: [
      {
        id: "danger-zone",
        label: "Danger Zone",
        description: "Delete jobs, runs, or the full local database.",
        searchTerms: ["delete", "clear", "cleanup", "destructive"],
      },
    ],
  },
];

const SECTION_FIELD_MAP: Record<SettingsSectionId, Array<keyof UpdateSettingsInput>> = {
  billing: [],
  model: [
    "llmProvider",
    "llmBaseUrl",
    "llmApiKey",
    "llmPurposeOverrides",
    "llmPurposeApiKeys",
    "model",
    "modelScorer",
    "modelTailoring",
    "modelProjectSelection",
  ],
  chat: [
    "chatStyleTone",
    "chatStyleFormality",
    "chatStyleConstraints",
    "chatStyleDoNotUse",
    "ghostwriterStopSlopEnabled",
    "chatStyleLanguageMode",
    "chatStyleManualLanguage",
  ],
  "prompt-templates": [
    "ghostwriterSystemPromptTemplate",
    "resumeGenerationPromptTemplate",
    "tailoringPromptTemplate",
    "scoringPromptTemplate",
  ],
  scoring: [
    "penalizeMissingSalary",
    "missingSalaryPenalty",
    "autoSkipScoreThreshold",
    "blockedCompanyKeywords",
  ],
  "resume-pdf": ["pdfRenderer", "typstTheme", "pdfPaperSize", "resumeProjects"],
  webhooks: ["pipelineWebhookUrl", "jobCompleteWebhookUrl", "webhookSecret"],
  environment: ["ukvisajobsEmail", "ukvisajobsPassword", "adzunaAppId", "adzunaAppKey"],
  display: ["renderMarkdownInJobDescriptions", "autoTailorOnManualImport"],
  backup: [
    "pipelineScheduleEnabled",
    "pipelineScheduleHour",
    "backupEnabled",
    "backupHour",
    "backupMaxCount",
  ],
  "danger-zone": [],
};

function matchesSettingsSearch(searchTerm: string, item: SettingsSectionDescriptor): boolean {
  return sectionWorkspaceItemMatchesSearch(searchTerm, item);
}

const normalizeLlmProviderValue = (value: string | null | undefined): LlmProviderValue =>
  value ? normalizeLlmProvider(value) : null;

const LEGACY_MODEL_KEYS = {
  scoring: "modelScorer",
  tailoring: "modelTailoring",
  projectSelection: "modelProjectSelection",
} as const;

const mapPurposeOverridesToForm = (data: AppSettings) => {
  const overrides = { ...data.llmPurposeOverrides.override };
  for (const [purpose, modelKey] of Object.entries(LEGACY_MODEL_KEYS)) {
    const typedPurpose = purpose as keyof typeof LEGACY_MODEL_KEYS;
    const legacyModel = data[modelKey].override;
    if (legacyModel && !overrides[typedPurpose]?.model) {
      overrides[typedPurpose] = {
        ...overrides[typedPurpose],
        model: legacyModel,
      };
    }
  }
  return overrides;
};

const NULL_SETTINGS_PAYLOAD: UpdateSettingsInput = {
  model: null,
  modelScorer: null,
  modelTailoring: null,
  modelProjectSelection: null,
  llmProvider: null,
  llmBaseUrl: null,
  llmApiKey: null,
  llmPurposeOverrides: null,
  llmPurposeApiKeys: null,
  pipelineWebhookUrl: null,
  jobCompleteWebhookUrl: null,
  resumeProjects: null,
  pdfRenderer: null,
  typstTheme: null,
  pdfPaperSize: null,
  renderMarkdownInJobDescriptions: null,
  autoTailorOnManualImport: null,
  chatStyleTone: null,
  chatStyleFormality: null,
  chatStyleConstraints: null,
  chatStyleDoNotUse: null,
  ghostwriterStopSlopEnabled: null,
  chatStyleSummaryMaxWords: null,
  chatStyleMaxKeywordsPerSkill: null,
  chatStyleLanguageMode: null,
  chatStyleManualLanguage: null,
  ukvisajobsEmail: null,
  ukvisajobsPassword: null,
  adzunaAppId: null,
  adzunaAppKey: null,
  adzunaMaxJobsPerTerm: null,
  webhookSecret: null,
  pipelineScheduleEnabled: null,
  pipelineScheduleHour: null,
  backupEnabled: null,
  backupHour: null,
  backupMaxCount: null,
  penalizeMissingSalary: null,
  missingSalaryPenalty: null,
  autoSkipScoreThreshold: null,
  blockedCompanyKeywords: null,
  ghostwriterSystemPromptTemplate: null,
  resumeGenerationPromptTemplate: null,
  tailoringPromptTemplate: null,
  scoringPromptTemplate: null,
};

function getResetSettingsPayload(options: {
  canEditLlmSettings: boolean;
  isSystemAdmin: boolean;
  canUseWebhooks: boolean;
}): Partial<UpdateSettingsInput> {
  const payload: Partial<UpdateSettingsInput> = { ...NULL_SETTINGS_PAYLOAD };
  if (!options.canEditLlmSettings) {
    delete payload.model;
    delete payload.modelScorer;
    delete payload.modelTailoring;
    delete payload.modelProjectSelection;
    delete payload.llmProvider;
    delete payload.llmBaseUrl;
    delete payload.llmApiKey;
    delete payload.llmPurposeOverrides;
    delete payload.llmPurposeApiKeys;
  }
  if (!options.isSystemAdmin) {
    delete payload.ukvisajobsEmail;
    delete payload.ukvisajobsPassword;
    delete payload.adzunaAppId;
    delete payload.adzunaAppKey;
    delete payload.backupEnabled;
    delete payload.backupHour;
    delete payload.backupMaxCount;
  }
  if (!options.canUseWebhooks) {
    delete payload.pipelineWebhookUrl;
    delete payload.jobCompleteWebhookUrl;
    delete payload.webhookSecret;
  }
  return payload;
}

const mapSettingsToForm = (data: AppSettings): UpdateSettingsInput => ({
  model: data.model.override ?? "",
  modelScorer: data.modelScorer.override ?? "",
  modelTailoring: data.modelTailoring.override ?? "",
  modelProjectSelection: data.modelProjectSelection.override ?? "",
  llmProvider: normalizeLlmProviderValue(data.llmProvider.override ?? data.llmProvider.value),
  llmBaseUrl: data.llmBaseUrl.override ?? "",
  llmApiKey: "",
  llmPurposeOverrides: mapPurposeOverridesToForm(data),
  llmPurposeApiKeys: {},
  pipelineWebhookUrl: data.pipelineWebhookUrl.override ?? "",
  jobCompleteWebhookUrl: data.jobCompleteWebhookUrl.override ?? "",
  resumeProjects: data.resumeProjects.override,
  pdfRenderer: data.pdfRenderer.override ?? data.pdfRenderer.value,
  typstTheme: data.typstTheme.override ?? data.typstTheme.value,
  pdfPaperSize: data.pdfPaperSize.override ?? data.pdfPaperSize.value,
  renderMarkdownInJobDescriptions: data.renderMarkdownInJobDescriptions.override,
  autoTailorOnManualImport: data.autoTailorOnManualImport.override,
  chatStyleTone: data.chatStyleTone.override ?? "",
  chatStyleFormality: data.chatStyleFormality.override ?? "",
  chatStyleConstraints: data.chatStyleConstraints.override ?? "",
  chatStyleDoNotUse: data.chatStyleDoNotUse.override ?? "",
  ghostwriterStopSlopEnabled: data.ghostwriterStopSlopEnabled.override,
  chatStyleSummaryMaxWords: data.chatStyleSummaryMaxWords.override ?? null,
  chatStyleMaxKeywordsPerSkill: data.chatStyleMaxKeywordsPerSkill.override ?? null,
  chatStyleLanguageMode: data.chatStyleLanguageMode.override ?? null,
  chatStyleManualLanguage: data.chatStyleManualLanguage.override ?? null,
  ukvisajobsEmail: data.ukvisajobsEmail ?? "",
  ukvisajobsPassword: "",
  adzunaAppId: data.adzunaAppId ?? "",
  adzunaAppKey: "",
  webhookSecret: "",
  pipelineScheduleEnabled: data.pipelineScheduleEnabled?.override ?? null,
  pipelineScheduleHour: data.pipelineScheduleHour?.override ?? null,
  backupEnabled: data.backupEnabled.override,
  backupHour: data.backupHour.override,
  backupMaxCount: data.backupMaxCount.override,
  penalizeMissingSalary: data.penalizeMissingSalary.override,
  missingSalaryPenalty: data.missingSalaryPenalty.override,
  autoSkipScoreThreshold: data.autoSkipScoreThreshold.override,
  blockedCompanyKeywords: data.blockedCompanyKeywords.override ?? [],
  ghostwriterSystemPromptTemplate: data.ghostwriterSystemPromptTemplate.value ?? "",
  resumeGenerationPromptTemplate: data.resumeGenerationPromptTemplate.value ?? "",
  tailoringPromptTemplate: data.tailoringPromptTemplate.value ?? "",
  scoringPromptTemplate: data.scoringPromptTemplate.value ?? "",
});

const normalizeString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizePrivateInput = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (trimmed === "") return null;
  return trimmed || undefined;
};

const normalizePurposeOverrides = (
  value: UpdateSettingsInput["llmPurposeOverrides"],
  options: { dropInheritedProviderOverrides?: boolean } = {},
) => {
  if (!value) return null;
  const out: NonNullable<UpdateSettingsInput["llmPurposeOverrides"]> = {};
  for (const purpose of Object.keys(LEGACY_MODEL_KEYS) as Array<keyof typeof LEGACY_MODEL_KEYS>) {
    const override = value[purpose];
    if (!override) continue;
    const provider = normalizeLlmProviderValue(override.provider ?? null);
    const baseUrl = normalizeString(override.baseUrl ?? null);
    const model = normalizeString(override.model ?? null);
    if (options.dropInheritedProviderOverrides && !provider) {
      continue;
    }
    if (provider || baseUrl || model) {
      out[purpose] = {
        ...(provider ? { provider } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
      };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
};

const normalizePurposeApiKeys = (value: UpdateSettingsInput["llmPurposeApiKeys"]) => {
  if (!value) return null;
  const out: NonNullable<UpdateSettingsInput["llmPurposeApiKeys"]> = {};
  for (const purpose of Object.keys(LEGACY_MODEL_KEYS) as Array<keyof typeof LEGACY_MODEL_KEYS>) {
    if (!Object.hasOwn(value, purpose)) continue;
    const normalized = normalizePrivateInput(value[purpose] ?? null);
    if (typeof normalized === "string") {
      out[purpose] = normalized;
    }
  }
  return out;
};

const stringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const nullIfSame = <T,>(value: T | null | undefined, defaultValue: T) =>
  value === defaultValue ? null : (value ?? null);

const getDerivedSettings = (settings: AppSettings | null) => {
  const profileProjects = settings?.profileProjects ?? [];

  return {
    model: {
      effective: settings?.model?.value ?? "",
      default: settings?.model?.default ?? "",
      scorer: settings?.modelScorer?.value ?? "",
      tailoring: settings?.modelTailoring?.value ?? "",
      projectSelection: settings?.modelProjectSelection?.value ?? "",
      llmProvider: settings?.llmProvider?.value ?? "",
      llmBaseUrl: settings?.llmBaseUrl?.value ?? "",
      llmApiKeyHint: settings?.llmApiKeyHint ?? null,
      llmPurposeOverrides: settings?.llmPurposeOverrides?.value ?? {},
      llmPurposeApiKeyHints: settings?.llmPurposeApiKeyHints ?? {},
    },
    pipelineWebhook: {
      effective: settings?.pipelineWebhookUrl?.value ?? "",
      default: settings?.pipelineWebhookUrl?.default ?? "",
    },
    jobCompleteWebhook: {
      effective: settings?.jobCompleteWebhookUrl?.value ?? "",
      default: settings?.jobCompleteWebhookUrl?.default ?? "",
    },
    resumePdf: {
      pdfRenderer: {
        effective: settings?.pdfRenderer?.value ?? "typst",
        default: settings?.pdfRenderer?.default ?? "typst",
      },
      typstTheme: {
        effective: settings?.typstTheme?.value ?? "classic",
        default: settings?.typstTheme?.default ?? "classic",
      },
      pdfPaperSize: {
        effective: settings?.pdfPaperSize?.value ?? "auto",
        default: settings?.pdfPaperSize?.default ?? "auto",
      },
    },
    display: {
      renderMarkdownInJobDescriptions: {
        effective: settings?.renderMarkdownInJobDescriptions?.value ?? true,
        default: settings?.renderMarkdownInJobDescriptions?.default ?? true,
      },
      autoTailorOnManualImport: {
        effective: settings?.autoTailorOnManualImport?.value ?? true,
        default: settings?.autoTailorOnManualImport?.default ?? true,
      },
    },
    chat: {
      tone: {
        effective: settings?.chatStyleTone?.value ?? "professional",
        default: settings?.chatStyleTone?.default ?? "professional",
      },
      formality: {
        effective: settings?.chatStyleFormality?.value ?? "medium",
        default: settings?.chatStyleFormality?.default ?? "medium",
      },
      constraints: {
        effective: settings?.chatStyleConstraints?.value ?? "",
        default: settings?.chatStyleConstraints?.default ?? "",
      },
      doNotUse: {
        effective: settings?.chatStyleDoNotUse?.value ?? "",
        default: settings?.chatStyleDoNotUse?.default ?? "",
      },
      stopSlopEnabled: {
        effective: settings?.ghostwriterStopSlopEnabled?.value ?? false,
        default: settings?.ghostwriterStopSlopEnabled?.default ?? false,
      },
      languageMode: {
        effective: settings?.chatStyleLanguageMode?.value ?? "manual",
        default: settings?.chatStyleLanguageMode?.default ?? "manual",
      },
      manualLanguage: {
        effective: settings?.chatStyleManualLanguage?.value ?? "english",
        default: settings?.chatStyleManualLanguage?.default ?? "english",
      },
      summaryMaxWords: {
        effective: settings?.chatStyleSummaryMaxWords?.value ?? null,
        default: settings?.chatStyleSummaryMaxWords?.default ?? null,
      },
      maxKeywordsPerSkill: {
        effective: settings?.chatStyleMaxKeywordsPerSkill?.value ?? null,
        default: settings?.chatStyleMaxKeywordsPerSkill?.default ?? null,
      },
    },
    envSettings: {
      readable: {
        ukvisajobsEmail: settings?.ukvisajobsEmail ?? "",
        adzunaAppId: settings?.adzunaAppId ?? "",
      },
      private: {
        ukvisajobsPasswordHint: settings?.ukvisajobsPasswordHint ?? null,
        adzunaAppKeyHint: settings?.adzunaAppKeyHint ?? null,
        webhookSecretHint: settings?.webhookSecretHint ?? null,
      },
    },
    defaultResumeProjects: settings?.resumeProjects?.default ?? null,

    profileProjects,
    maxProjectsTotal: profileProjects.length,

    backup: {
      backupEnabled: {
        effective: settings?.backupEnabled?.value ?? false,
        default: settings?.backupEnabled?.default ?? false,
      },
      backupHour: {
        effective: settings?.backupHour?.value ?? 2,
        default: settings?.backupHour?.default ?? 2,
      },
      backupMaxCount: {
        effective: settings?.backupMaxCount?.value ?? 5,
        default: settings?.backupMaxCount?.default ?? 5,
      },
    },
    scoring: {
      penalizeMissingSalary: {
        effective: settings?.penalizeMissingSalary?.value ?? false,
        default: settings?.penalizeMissingSalary?.default ?? false,
      },
      missingSalaryPenalty: {
        effective: settings?.missingSalaryPenalty?.value ?? 10,
        default: settings?.missingSalaryPenalty?.default ?? 10,
      },
      autoSkipScoreThreshold: {
        effective: settings?.autoSkipScoreThreshold?.value ?? null,
        default: settings?.autoSkipScoreThreshold?.default ?? null,
      },
      blockedCompanyKeywords: {
        effective: settings?.blockedCompanyKeywords?.value ?? [],
        default: settings?.blockedCompanyKeywords?.default ?? [],
      },
    },
    promptTemplates: {
      ghostwriterSystemPromptTemplate: {
        effective: settings?.ghostwriterSystemPromptTemplate?.value ?? "",
        default: settings?.ghostwriterSystemPromptTemplate?.default ?? "",
      },
      resumeGenerationPromptTemplate: {
        effective: settings?.resumeGenerationPromptTemplate?.value ?? "",
        default: settings?.resumeGenerationPromptTemplate?.default ?? "",
      },
      tailoringPromptTemplate: {
        effective: settings?.tailoringPromptTemplate?.value ?? "",
        default: settings?.tailoringPromptTemplate?.default ?? "",
      },
      scoringPromptTemplate: {
        effective: settings?.scoringPromptTemplate?.value ?? "",
        default: settings?.scoringPromptTemplate?.default ?? "",
      },
    },
  };
};

export const SettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("model");
  const [openGroups, setOpenGroups] = useState<SettingsGroupId[]>([]);

  const [settingsSearch, setSettingsSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isBillingBusy, setIsBillingBusy] = useState(false);
  const [statusesToClear, setStatusesToClear] = useState<JobStatus[]>(["discovered"]);

  // Backup state
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isDeletingBackup, setIsDeletingBackup] = useState(false);

  const methods = useForm<UpdateSettingsInput>({
    resolver: zodResolver(updateSettingsSchema) as Resolver<UpdateSettingsInput>,
    mode: "onChange",
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const {
    handleSubmit,
    reset,
    control,
    formState: { isDirty, errors, isValid, dirtyFields },
  } = methods;

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.current(),
    queryFn: api.getSettings,
  });
  const appStatusQuery = useQuery({
    queryKey: queryKeys.app.status(),
    queryFn: api.getAppStatus,
  });
  const isHostedMode = appStatusQuery.data?.appMode === "hosted";
  const billingQuery = useQuery({
    queryKey: queryKeys.billing.status(),
    queryFn: api.getBillingStatus,
    enabled: isHostedMode,
  });
  const currentUserQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.getCurrentAuthUser,
    retry: false,
  });
  const backupsQuery = useQuery({
    queryKey: queryKeys.backups.list(),
    queryFn: api.getBackups,
    enabled: currentUserQuery.data?.isSystemAdmin === true,
  });
  const updateSettingsMutation = useUpdateSettingsMutation();
  const isLoading = settingsQuery.isLoading;
  const backups = backupsQuery.data?.backups ?? [];
  const nextScheduled = backupsQuery.data?.nextScheduled ?? null;
  const isLoadingBackups = backupsQuery.isLoading;
  const canEditLlmSettings = isHostedMode
    ? (billingQuery.data?.userEditableLlmSettings ?? false)
    : (appStatusQuery.data?.capabilities.userEditableLlmSettings ?? true);
  useQueryErrorToast(appStatusQuery.error, "Failed to load app status");
  useQueryErrorToast(backupsQuery.error, "Failed to load backups");
  useQueryErrorToast(billingQuery.error, "Failed to load billing status");

  const openStripe = async (createSession: () => Promise<{ url: string }>) => {
    setIsBillingBusy(true);
    try {
      const { url } = await createSession();
      window.location.assign(url);
    } catch (error) {
      showErrorToast(error, "Failed to open Stripe");
      setIsBillingBusy(false);
    }
  };

  const resumeProjectsValue = useWatch({
    control,
    name: "resumeProjects",
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setSettings(settingsQuery.data);
    reset(mapSettingsToForm(settingsQuery.data));
  }, [settingsQuery.data, reset]);

  useQueryErrorToast(settingsQuery.error, "Failed to load settings");

  const derived = getDerivedSettings(settings);
  const {
    model,
    pipelineWebhook,
    jobCompleteWebhook,
    resumePdf,
    display,
    chat,
    envSettings,
    defaultResumeProjects,
    profileProjects,
    backup,
    scoring,
    promptTemplates,
  } = derived;

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      await api.createManualBackup();
      toast.success("Backup created successfully");
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
    } catch (error) {
      showErrorToast(error, "Failed to create backup");
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    const confirmed = window.confirm(`Delete backup "${filename}"? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }
    setIsDeletingBackup(true);
    try {
      await api.deleteBackup(filename);
      toast.success("Backup deleted successfully");
      await queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
    } catch (error) {
      showErrorToast(error, "Failed to delete backup");
    } finally {
      setIsDeletingBackup(false);
    }
  };

  const effectiveProfileProjects = profileProjects;
  const effectiveMaxProjectsTotal = effectiveProfileProjects.length;

  const lockedCount = resumeProjectsValue?.lockedProjectIds.length ?? 0;

  const isSystemAdmin = currentUserQuery.data?.isSystemAdmin === true;
  const isAdminConsole = isSystemAdmin && !isHostedMode;
  const hasDefaultModelAccess = currentUserQuery.data?.permissions?.defaultModel === true;
  const canManageBackups = isSystemAdmin;
  const canUseWebhooks = isSystemAdmin || currentUserQuery.data?.permissions?.webhooks === true;

  const canSave = isDirty && isValid;

  const onSave = async (data: UpdateSettingsInput) => {
    if (!settings) return;
    try {
      setIsSaving(true);

      // Prepare payload: nullify if equal to default
      const resumeProjectsData = data.resumeProjects;
      const resumeProjectsOverride =
        resumeProjectsData &&
        defaultResumeProjects &&
        resumeProjectsEqual(resumeProjectsData, defaultResumeProjects)
          ? null
          : resumeProjectsData;

      const envPayload: Partial<UpdateSettingsInput> = {};

      if (isSystemAdmin && (dirtyFields.ukvisajobsEmail || dirtyFields.ukvisajobsPassword)) {
        envPayload.ukvisajobsEmail = normalizeString(data.ukvisajobsEmail);
      }

      if (isSystemAdmin && (dirtyFields.adzunaAppId || dirtyFields.adzunaAppKey)) {
        envPayload.adzunaAppId = normalizeString(data.adzunaAppId);
      }

      if (canEditLlmSettings && dirtyFields.llmProvider) {
        envPayload.llmProvider = data.llmProvider ?? null;
      }

      if (canEditLlmSettings && isSystemAdmin && !isHostedMode && dirtyFields.llmBaseUrl) {
        envPayload.llmBaseUrl = normalizeString(data.llmBaseUrl);
      }

      if (canEditLlmSettings && dirtyFields.llmApiKey) {
        const value = normalizePrivateInput(data.llmApiKey);
        if (value !== undefined) envPayload.llmApiKey = value;
      }

      if (isSystemAdmin && dirtyFields.ukvisajobsPassword) {
        const value = normalizePrivateInput(data.ukvisajobsPassword);
        if (value !== undefined) envPayload.ukvisajobsPassword = value;
      }

      if (isSystemAdmin && dirtyFields.adzunaAppKey) {
        const value = normalizePrivateInput(data.adzunaAppKey);
        if (value !== undefined) envPayload.adzunaAppKey = value;
      }

      if (canUseWebhooks && dirtyFields.webhookSecret) {
        const value = normalizePrivateInput(data.webhookSecret);
        if (value !== undefined) envPayload.webhookSecret = value;
      }

      const llmPayload: Partial<UpdateSettingsInput> = canEditLlmSettings
        ? {
            model: dirtyFields.llmProvider
              ? dirtyFields.model
                ? normalizeString(data.model)
                : null
              : normalizeString(data.model),
            ...(dirtyFields.llmProvider
              ? {
                  modelScorer: null,
                  modelTailoring: null,
                  modelProjectSelection: null,
                  llmPurposeOverrides: normalizePurposeOverrides(data.llmPurposeOverrides, {
                    dropInheritedProviderOverrides: true,
                  }),
                }
              : {}),
            ...(dirtyFields.llmPurposeOverrides
              ? {
                  llmPurposeOverrides: normalizePurposeOverrides(data.llmPurposeOverrides),
                  modelScorer: null,
                  modelTailoring: null,
                  modelProjectSelection: null,
                }
              : {}),
            ...(dirtyFields.llmPurposeApiKeys
              ? {
                  llmPurposeApiKeys: normalizePurposeApiKeys(data.llmPurposeApiKeys),
                }
              : {}),
          }
        : {};

      const payload: Partial<UpdateSettingsInput> = {
        ...llmPayload,
        ...(canUseWebhooks
          ? {
              pipelineWebhookUrl: normalizeString(data.pipelineWebhookUrl),
              jobCompleteWebhookUrl: normalizeString(data.jobCompleteWebhookUrl),
            }
          : {}),
        resumeProjects: resumeProjectsOverride,
        pdfRenderer: nullIfSame(data.pdfRenderer, resumePdf.pdfRenderer.default),
        typstTheme: nullIfSame(data.typstTheme, resumePdf.typstTheme.default),
        pdfPaperSize: nullIfSame(data.pdfPaperSize, resumePdf.pdfPaperSize.default),
        renderMarkdownInJobDescriptions: nullIfSame(
          data.renderMarkdownInJobDescriptions,
          display.renderMarkdownInJobDescriptions.default,
        ),
        autoTailorOnManualImport: nullIfSame(
          data.autoTailorOnManualImport,
          display.autoTailorOnManualImport.default,
        ),
        chatStyleTone: normalizeString(data.chatStyleTone),
        chatStyleFormality: normalizeString(data.chatStyleFormality),
        chatStyleConstraints: normalizeString(data.chatStyleConstraints),
        chatStyleDoNotUse: normalizeString(data.chatStyleDoNotUse),
        ghostwriterStopSlopEnabled: nullIfSame(
          data.ghostwriterStopSlopEnabled,
          chat.stopSlopEnabled.default,
        ),
        chatStyleSummaryMaxWords: Number.isNaN(data.chatStyleSummaryMaxWords)
          ? null
          : (data.chatStyleSummaryMaxWords ?? null),
        chatStyleMaxKeywordsPerSkill: Number.isNaN(data.chatStyleMaxKeywordsPerSkill)
          ? null
          : (data.chatStyleMaxKeywordsPerSkill ?? null),
        chatStyleLanguageMode: data.chatStyleLanguageMode ?? null,
        chatStyleManualLanguage: data.chatStyleManualLanguage ?? null,
        pipelineScheduleEnabled: data.pipelineScheduleEnabled ?? null,
        pipelineScheduleHour: data.pipelineScheduleHour ?? null,
        ...(canManageBackups
          ? {
              backupEnabled: nullIfSame(data.backupEnabled, backup.backupEnabled.default),
              backupHour: nullIfSame(data.backupHour, backup.backupHour.default),
              backupMaxCount: nullIfSame(data.backupMaxCount, backup.backupMaxCount.default),
            }
          : {}),
        penalizeMissingSalary: nullIfSame(
          data.penalizeMissingSalary,
          scoring.penalizeMissingSalary.default,
        ),
        missingSalaryPenalty: nullIfSame(
          data.missingSalaryPenalty,
          scoring.missingSalaryPenalty.default,
        ),
        autoSkipScoreThreshold: nullIfSame(
          data.autoSkipScoreThreshold,
          scoring.autoSkipScoreThreshold.default,
        ),
        blockedCompanyKeywords: (() => {
          const normalized = normalizeStringArray(data.blockedCompanyKeywords);
          const normalizedDefault = normalizeStringArray(scoring.blockedCompanyKeywords.default);
          return stringArraysEqual(normalized, normalizedDefault) ? null : normalized;
        })(),
        ghostwriterSystemPromptTemplate: nullIfSame(
          normalizeString(data.ghostwriterSystemPromptTemplate),
          promptTemplates.ghostwriterSystemPromptTemplate.default,
        ),
        resumeGenerationPromptTemplate: nullIfSame(
          normalizeString(data.resumeGenerationPromptTemplate),
          promptTemplates.resumeGenerationPromptTemplate.default,
        ),
        tailoringPromptTemplate: nullIfSame(
          normalizeString(data.tailoringPromptTemplate),
          promptTemplates.tailoringPromptTemplate.default,
        ),
        scoringPromptTemplate: nullIfSame(
          normalizeString(data.scoringPromptTemplate),
          promptTemplates.scoringPromptTemplate.default,
        ),
        ...envPayload,
      };

      const updated = await updateSettingsMutation.mutateAsync(payload);
      setSettings(updated);
      reset(mapSettingsToForm(updated));
      toast.success("Settings saved");
    } catch (error) {
      showErrorToast(error, "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearDatabase = async () => {
    try {
      setIsSaving(true);
      const result = await api.clearDatabase();
      toast.success("Database cleared", {
        description: `Deleted ${result.jobsDeleted} jobs.`,
      });
    } catch (error) {
      showErrorToast(error, "Failed to clear database");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearByStatuses = async () => {
    if (statusesToClear.length === 0) {
      toast.error("No statuses selected");
      return;
    }
    try {
      setIsSaving(true);
      let totalDeleted = 0;
      const results: string[] = [];

      for (const status of statusesToClear) {
        const result = await api.deleteJobsByStatus(status);
        totalDeleted += result.count;
        if (result.count > 0) {
          results.push(`${result.count} ${status}`);
        }
      }

      if (totalDeleted > 0) {
        toast.success("Jobs cleared", {
          description: `Deleted ${totalDeleted} jobs: ${results.join(", ")}`,
        });
      } else {
        toast.info("No jobs found", {
          description: `No jobs with selected statuses found`,
        });
      }
    } catch (error) {
      showErrorToast(error, "Failed to clear jobs");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearByScore = async (threshold: number) => {
    try {
      setIsSaving(true);
      const result = await api.deleteJobsBelowScore(threshold);

      if (result.count > 0) {
        toast.success("Jobs cleared", {
          description: `Deleted ${result.count} jobs with score below ${threshold}. Applied jobs were preserved.`,
        });
      } else {
        toast.info("No jobs found", {
          description: `No jobs with score below ${threshold} found`,
        });
      }
    } catch (error) {
      showErrorToast(error, "Failed to clear jobs by score");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatusToClear = (status: JobStatus) => {
    setStatusesToClear((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  };
  const handleReset = async () => {
    try {
      setIsSaving(true);
      const updated = await updateSettingsMutation.mutateAsync(
        getResetSettingsPayload({ canEditLlmSettings, isSystemAdmin, canUseWebhooks }),
      );
      setSettings(updated);
      reset(mapSettingsToForm(updated));
      toast.success("Reset to default");
    } catch (error) {
      showErrorToast(error, "Failed to reset settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardChanges = () => {
    if (!settings) return;
    reset(mapSettingsToForm(settings));
    toast.success("Discarded unsaved changes");
  };

  const visibleNavGroups = useMemo(
    () =>
      SETTINGS_NAV_GROUPS.map((group) => ({
        ...group,
        label: group.id === "backups" && !canManageBackups ? "Schedule" : group.label,
        items: group.items
          .filter(
            (item) =>
              (item.id !== "billing" || isHostedMode) &&
              (item.id !== "webhooks" || canUseWebhooks) &&
              (item.id !== "environment" || isSystemAdmin) &&
              (item.id !== "danger-zone" || isSystemAdmin) &&
              (!isAdminConsole || ADMIN_SETTINGS_SECTION_IDS.has(item.id)) &&
              (canEditLlmSettings || item.id !== "model"),
          )
          .map((item) =>
            item.id === "backup" && !canManageBackups
              ? {
                  ...item,
                  label: "Daily search",
                  description: "Run your job search automatically every day.",
                }
              : item,
          ),
      })).filter((group) => group.items.length > 0),
    [
      canEditLlmSettings,
      canManageBackups,
      canUseWebhooks,
      isAdminConsole,
      isHostedMode,
      isSystemAdmin,
    ],
  );

  const filteredNavGroups = useMemo(
    () =>
      visibleNavGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => matchesSettingsSearch(settingsSearch, item)),
        }))
        .filter((group) => group.items.length > 0),
    [settingsSearch, visibleNavGroups],
  );

  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    const allSectionIds = visibleNavGroups.flatMap((g) => g.items.map((i) => i.id));
    if (hash && allSectionIds.includes(hash as SettingsSectionId)) {
      setActiveSection(hash as SettingsSectionId);
      const parentGroup = visibleNavGroups.find((g) => g.items.some((i) => i.id === hash));
      if (parentGroup) {
        setOpenGroups((prev) => (prev.includes(parentGroup.id) ? prev : [...prev, parentGroup.id]));
      }
    }
  }, [location.hash, visibleNavGroups]);

  const visibleSectionIds = useMemo(
    () => filteredNavGroups.flatMap((group) => group.items.map((item) => item.id)),
    [filteredNavGroups],
  );

  useEffect(() => {
    if (visibleSectionIds.length === 0) return;
    if (!visibleSectionIds.includes(activeSection)) {
      setActiveSection(visibleSectionIds[0]);
    }
  }, [activeSection, visibleSectionIds]);

  const firstVisibleGroup = visibleNavGroups[0] ?? SETTINGS_NAV_GROUPS[0];
  const firstVisibleSection = firstVisibleGroup.items[0];
  const activeSectionMeta =
    visibleNavGroups.flatMap((group) => group.items).find((item) => item.id === activeSection) ??
    firstVisibleSection;
  const activeGroup =
    visibleNavGroups.find((group) => group.items.some((item) => item.id === activeSection)) ??
    firstVisibleGroup;

  const sectionHasDirtyState = (sectionId: SettingsSectionId) =>
    SECTION_FIELD_MAP[sectionId].some((field) => Boolean(dirtyFields[field]));
  const sectionHasErrors = (sectionId: SettingsSectionId) =>
    SECTION_FIELD_MAP[sectionId].some((field) => Boolean(errors[field]));

  const getSectionBadge = (sectionId: SettingsSectionId): SectionWorkspaceBadge | null => {
    if (sectionId === "danger-zone") {
      return { label: "Sensitive", variant: "destructive" as const };
    }
    if (sectionHasErrors(sectionId)) {
      return { label: "Needs attention", variant: "destructive" as const };
    }
    if (sectionHasDirtyState(sectionId)) {
      return { label: "Unsaved", variant: "secondary" as const };
    }

    switch (sectionId) {
      case "billing":
        return billingQuery.data
          ? {
              label: billingQuery.data.plan === "pro" ? "Pro" : "Free",
              variant:
                billingQuery.data.plan === "pro" ? ("outline" as const) : ("secondary" as const),
            }
          : null;
      case "model":
        return model.llmProvider
          ? { label: "Configured", variant: "outline" as const }
          : { label: "Using defaults", variant: "secondary" as const };
      case "chat":
        return chat.tone.effective || chat.constraints.effective
          ? { label: "Ready", variant: "outline" as const }
          : { label: "Using defaults", variant: "secondary" as const };
      case "prompt-templates":
        return promptTemplates.ghostwriterSystemPromptTemplate.effective !==
          promptTemplates.ghostwriterSystemPromptTemplate.default ||
          promptTemplates.resumeGenerationPromptTemplate.effective !==
            promptTemplates.resumeGenerationPromptTemplate.default ||
          promptTemplates.tailoringPromptTemplate.effective !==
            promptTemplates.tailoringPromptTemplate.default ||
          promptTemplates.scoringPromptTemplate.effective !==
            promptTemplates.scoringPromptTemplate.default
          ? { label: "Customized", variant: "outline" as const }
          : { label: "Using defaults", variant: "secondary" as const };
      case "scoring":
        return scoring.autoSkipScoreThreshold.effective != null ||
          scoring.blockedCompanyKeywords.effective.length > 0
          ? { label: "Customized", variant: "outline" as const }
          : { label: "Default rules", variant: "secondary" as const };
      case "webhooks":
        return pipelineWebhook.effective || jobCompleteWebhook.effective
          ? { label: "Configured", variant: "outline" as const }
          : { label: "Optional", variant: "secondary" as const };
      case "environment":
        return envSettings.readable.ukvisajobsEmail || envSettings.readable.adzunaAppId
          ? { label: "Configured", variant: "outline" as const }
          : null;
      case "display":
        return { label: "Active", variant: "secondary" as const };
      case "backup":
        return backup.backupEnabled.effective
          ? { label: "Scheduled", variant: "outline" as const }
          : { label: "Manual only", variant: "secondary" as const };
      default:
        return { label: "Ready", variant: "outline" as const };
    }
  };

  const selectedSectionBadge = getSectionBadge(activeSection);
  const dirtySectionCount = visibleNavGroups
    .flatMap((group) => group.items)
    .filter((item) => sectionHasDirtyState(item.id)).length;
  const activeSectionIsDirty = sectionHasDirtyState(activeSection);

  let activeSectionContent: React.ReactNode;
  switch (activeSection) {
    case "billing":
      activeSectionContent = (
        <BillingSettingsSection
          status={billingQuery.data}
          isLoading={billingQuery.isLoading}
          isBusy={isBillingBusy}
          onUpgrade={() => void openStripe(api.createBillingCheckout)}
          onManage={() => void openStripe(api.createBillingPortal)}
        />
      );
      break;
    case "model":
      activeSectionContent = (
        <ModelSettingsSection
          values={model}
          isLoading={isLoading}
          isSaving={isSaving}
          restrictProviders={isHostedMode || !isSystemAdmin}
          defaultModelStatus={
            !isHostedMode && !isSystemAdmin
              ? hasDefaultModelAccess
                ? "granted"
                : "required"
              : null
          }
          layoutMode="panel"
        />
      );
      break;
    case "chat":
      activeSectionContent = (
        <ChatSettingsSection
          values={chat}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      );
      break;
    case "prompt-templates":
      activeSectionContent = (
        <PromptTemplatesSection
          values={promptTemplates}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      );
      break;
    case "scoring":
      activeSectionContent = (
        <ScoringSettingsSection
          values={scoring}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      );
      break;
    case "resume-pdf":
      activeSectionContent = (
        <ResumePdfSection
          profileProjects={effectiveProfileProjects}
          lockedCount={lockedCount}
          maxProjectsTotal={effectiveMaxProjectsTotal}
          isProjectsLoading={false}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      );
      break;
    case "webhooks":
      activeSectionContent = (
        <WebhooksSection
          pipelineWebhook={pipelineWebhook}
          jobCompleteWebhook={jobCompleteWebhook}
          webhookSecretHint={envSettings.private.webhookSecretHint}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      );
      break;
    case "environment":
      activeSectionContent = isSystemAdmin ? (
        <EnvironmentSettingsSection
          values={envSettings}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      ) : null;
      break;
    case "display":
      activeSectionContent = (
        <DisplaySettingsSection
          values={display}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      );
      break;
    case "backup":
      activeSectionContent = (
        <BackupSettingsSection
          values={backup}
          backups={backups}
          nextScheduled={nextScheduled}
          isLoading={isLoading || isLoadingBackups}
          isSaving={isSaving}
          onCreateBackup={handleCreateBackup}
          onDeleteBackup={handleDeleteBackup}
          isCreatingBackup={isCreatingBackup}
          isDeletingBackup={isDeletingBackup}
          canManageBackups={canManageBackups}
          layoutMode="panel"
        />
      );
      break;
    case "danger-zone":
      activeSectionContent = isSystemAdmin ? (
        <DangerZoneSection
          statusesToClear={statusesToClear}
          toggleStatusToClear={toggleStatusToClear}
          handleClearByStatuses={handleClearByStatuses}
          handleClearDatabase={handleClearDatabase}
          handleClearByScore={handleClearByScore}
          isLoading={isLoading}
          isSaving={isSaving}
          layoutMode="panel"
        />
      ) : null;
      break;
    default:
      activeSectionContent = null;
  }

  return (
    <FormProvider {...methods}>
      <PageHeader
        icon={Settings}
        title="Settings"
        subtitle="Configure AI, scoring, integrations, and recovery from one focused workspace."
      />

      <main className="container mx-auto px-4 py-6 pb-12">
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <SectionWorkspaceNav
            groups={filteredNavGroups}
            activeSectionId={activeSection}
            openGroupIds={openGroups}
            onOpenGroupIdsChange={setOpenGroups}
            onSectionSelect={setActiveSection}
            searchValue={settingsSearch}
            onSearchValueChange={setSettingsSearch}
            searchPlaceholder="Search settings"
            searchEmptyLabel="No settings matched"
          />

          <SectionWorkspacePanel
            groupLabel={activeGroup.label}
            sectionLabel={activeSectionMeta.label}
            sectionDescription={activeSectionMeta.description}
            badge={selectedSectionBadge}
            secondaryBadge={
              dirtySectionCount > 0
                ? {
                    label: `${dirtySectionCount} unsaved section${dirtySectionCount !== 1 ? "s" : ""}`,
                    variant: "secondary",
                  }
                : null
            }
            actions={
              activeSection === "billing" ? null : (
                <>
                  {activeSectionIsDirty ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="whitespace-nowrap"
                      onClick={handleDiscardChanges}
                      disabled={isLoading || isSaving || !isDirty}
                    >
                      Discard changes
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="whitespace-nowrap"
                    onClick={handleReset}
                    disabled={isLoading || isSaving || !settings}
                  >
                    Reset to defaults
                  </Button>
                  <Button
                    type="button"
                    className="whitespace-nowrap"
                    onClick={handleSubmit(onSave)}
                    disabled={isLoading || isSaving || !canSave}
                  >
                    {isSaving ? "Saving..." : "Save changes"}
                  </Button>
                </>
              )
            }
            footer={
              Object.keys(errors).length > 0 ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/[0.03] px-4 py-3 text-sm text-destructive">
                  Please fix the highlighted errors before saving.
                </div>
              ) : null
            }
          >
            {activeSectionContent}
          </SectionWorkspacePanel>
        </div>
      </main>
    </FormProvider>
  );
};
