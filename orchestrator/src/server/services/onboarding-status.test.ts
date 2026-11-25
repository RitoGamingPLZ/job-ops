import { isSystemAdmin } from "@infra/request-context";
import { getOriginalEnvValue } from "@server/services/envSettings";
import { LlmService } from "@server/services/llm/service";
import { buildDefaultResumeDocument } from "@server/services/resume-document/document";
import type { DesignResumeJson } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applySettingsUpdates: vi.fn(),
  canUseDefaultModel: vi.fn(() => true),
  getCurrentDesignResume: vi.fn(),
  getDesignResumeStatus: vi.fn(),
  getJobOpsAppStatus: vi.fn(),
  getCurrentAccountEntitlements: vi.fn(),
  getSetting: vi.fn(),
  isDemoMode: vi.fn(),
  syncCandidateLibrary: vi.fn(),
  validateLlmCredentials: vi.fn(),
}));

vi.mock("@server/services/server-credentials", () => ({
  canUseDefaultModel: mocks.canUseDefaultModel,
}));

vi.mock("@server/config/app-mode", () => ({
  getJobOpsAppStatus: mocks.getJobOpsAppStatus,
}));

vi.mock("@server/services/account-entitlements", () => ({
  getCurrentAccountEntitlements: mocks.getCurrentAccountEntitlements,
}));

vi.mock("@server/config/demo", () => ({
  isDemoMode: mocks.isDemoMode,
}));

vi.mock("@server/repositories/settings", () => ({
  getSetting: mocks.getSetting,
}));

vi.mock("@server/services/auto-pdf-regeneration", () => ({
  enqueueAutoPdfRegenerationForSettingsChanges: vi.fn().mockResolvedValue(null),
}));

vi.mock("@server/services/candidate-library", () => ({
  syncCandidateLibrary: mocks.syncCandidateLibrary,
}));

vi.mock("@server/services/design-resume", () => ({
  getCurrentDesignResume: mocks.getCurrentDesignResume,
  getDesignResumeStatus: mocks.getDesignResumeStatus,
}));

vi.mock("@server/services/envSettings", () => ({
  getOriginalEnvValue: vi.fn(() => null),
}));

vi.mock("@server/services/llm/credentials", () => ({
  resolveLlmApiKey: vi.fn(({ storedApiKey }) => storedApiKey ?? null),
}));

vi.mock("@server/services/llm/service", () => ({
  LlmService: vi.fn().mockImplementation(function LlmServiceMock() {
    return {
      validateCredentials: mocks.validateLlmCredentials,
    };
  }),
}));

vi.mock("@server/services/profile", () => ({
  clearProfileCache: vi.fn(),
}));

vi.mock("@server/services/settings-update", () => ({
  applySettingsUpdates: mocks.applySettingsUpdates,
}));

vi.mock("@infra/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@infra/request-context", () => ({
  getRequestId: vi.fn(() => "req-1"),
  getTenantId: vi.fn(() => undefined),
  getUserId: vi.fn(() => undefined),
  isSystemAdmin: vi.fn(() => true),
}));

import {
  confirmOnboardingResumeAction,
  getOnboardingStatus,
  saveOnboardingModelAction,
  saveOnboardingProfileAction,
  validateLlm,
} from "./onboarding-status";

describe("onboarding status engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSystemAdmin).mockReturnValue(true);
    mocks.canUseDefaultModel.mockResolvedValue(true);
    vi.mocked(getOriginalEnvValue).mockReturnValue(undefined);
    mocks.getJobOpsAppStatus.mockReturnValue({
      appMode: "local",
      capabilities: {
        hostedSignups: false,
        platformLlm: false,
        quotas: false,
        userEditableLlmSettings: true,
      },
      hostedTenantConfigured: false,
    });
    mocks.getCurrentAccountEntitlements.mockResolvedValue({
      plan: "free",
      platformAiIncluded: false,
      userEditableLlmSettings: true,
      hostedLimits: {},
      subscription: null,
    });
    mocks.isDemoMode.mockReturnValue(false);
    mocks.getSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string | null> = {
        llmApiKey: "sk-test",
        llmProvider: "openrouter",
        llmBaseUrl: "",
        model: "gpt-4o",
        onboardingProfileCompleted: "1",
        onboardingLlmCompleted: "1",
        onboardingResumeConfirmedSource: "local:doc-1",
      };
      return values[key] ?? null;
    });
    mocks.getDesignResumeStatus.mockResolvedValue({
      exists: true,
      documentId: "doc-1",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    mocks.getCurrentDesignResume.mockResolvedValue(null);
    mocks.syncCandidateLibrary.mockReset();
    mocks.validateLlmCredentials.mockResolvedValue({
      valid: true,
      message: null,
    });
    mocks.applySettingsUpdates.mockResolvedValue({
      shouldRefreshBackupScheduler: false,
      updatedSettingKeys: [],
    });
  });

  it("preserves endpoint precedence without an implicit onboarding default", async () => {
    const cases = [
      [undefined, null, undefined, undefined],
      [null, "", undefined, undefined],
      [undefined, " http://stored.example ", undefined, "http://stored.example"],
      [null, "http://stored.example", "http://env.example", "http://stored.example"],
      ["", "http://stored.example", " http://env.example ", "http://env.example"],
      [" ", "http://stored.example", undefined, "http://localhost:4000"],
      [
        " http://override.example ",
        "http://stored.example",
        "http://env.example",
        "http://override.example",
      ],
      [undefined, "", " http://env.example ", "http://env.example"],
      [null, "", "", undefined],
    ] as const;
    for (const [override, stored, environment, expected] of cases) {
      mocks.getSetting.mockImplementation(async (key: string) =>
        key === "llmBaseUrl" ? stored : null,
      );
      vi.mocked(getOriginalEnvValue).mockReturnValue(environment);
      await validateLlm({ provider: "litellm", baseUrl: override });
      expect(LlmService).toHaveBeenLastCalledWith(
        expect.objectContaining({ provider: "litellm", baseUrl: expected }),
      );
    }
  });

  it("returns model as next when the connection has not been completed", async () => {
    mocks.getSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string | null> = {
        llmApiKey: "sk-test",
        llmProvider: "openrouter",
        llmBaseUrl: "",
        model: "gpt-4o",
        onboardingProfileCompleted: "1",
        onboardingLlmCompleted: null,
        onboardingResumeConfirmedSource: "local:doc-1",
      };
      return values[key] ?? null;
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(false);
    expect(status.nextRequirementId).toBe("model");
    expect(status.requirements[0]).toMatchObject({
      id: "model",
      status: "needs_action",
      primaryAction: "connect_model",
    });
    expect(mocks.applySettingsUpdates).not.toHaveBeenCalled();
  });

  it("validates and persists legacy onboarding state once", async () => {
    const values: Record<string, string | null> = {
      llmApiKey: "sk-test",
      llmProvider: "openrouter",
      llmBaseUrl: "",
      model: "gpt-4o",
      onboardingLegacyMigrationPending: "1",
      onboardingProfileCompleted: null,
      onboardingLlmCompleted: null,
      onboardingResumeConfirmedSource: null,
    };
    mocks.getSetting.mockImplementation(async (key: string) =>
      Object.hasOwn(values, key) ? values[key] : null,
    );
    mocks.applySettingsUpdates.mockImplementation(async (update) => {
      if (update.onboardingProfileCompleted !== undefined) {
        values.onboardingProfileCompleted = update.onboardingProfileCompleted ? "1" : "0";
      }
      if (update.onboardingLlmCompleted !== undefined) {
        values.onboardingLlmCompleted = update.onboardingLlmCompleted ? "1" : "0";
      }
      if (update.onboardingResumeConfirmedSource !== undefined) {
        values.onboardingResumeConfirmedSource = update.onboardingResumeConfirmedSource;
      }
      values.onboardingLegacyMigrationPending = "0";
      return {
        shouldRefreshBackupScheduler: false,
        updatedSettingKeys: [],
      };
    });

    const status = await getOnboardingStatus();

    expect(mocks.applySettingsUpdates).toHaveBeenCalledWith({
      onboardingProfileCompleted: true,
      onboardingLegacyMigrationPending: false,
      onboardingLlmCompleted: true,
      onboardingResumeConfirmedSource: "local:doc-1",
    });
    expect(status.complete).toBe(true);
  });

  it("does not trust a completed Codex marker when refreshed auth is invalid", async () => {
    mocks.getSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string | null> = {
        llmApiKey: null,
        llmProvider: "codex",
        llmBaseUrl: "",
        model: "gpt-5.4-mini",
        onboardingProfileCompleted: "1",
        onboardingLlmCompleted: "1",
        onboardingResumeConfirmedSource: "local:doc-1",
      };
      return values[key] ?? null;
    });
    mocks.validateLlmCredentials.mockResolvedValue({
      valid: false,
      message: "Access token expired. Please login again.",
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(false);
    expect(status.nextRequirementId).toBe("model");
    expect(status.requirements[0]).toMatchObject({
      id: "model",
      status: "needs_action",
      title: "Reconnect Codex",
      primaryAction: "connect_model",
    });
    expect(status.requirements[0]?.message).toMatch(/access token expired/i);
  });

  it("limits the system admin's setup to the server's AI connection", async () => {
    mocks.getDesignResumeStatus.mockResolvedValue({ exists: false });
    mocks.getSetting.mockImplementation(async (key: string) =>
      key === "llmProvider" ? "openrouter" : null,
    );

    const status = await getOnboardingStatus();

    expect(status.requirements.map((requirement) => requirement.id)).toEqual(["model"]);
    expect(status.nextRequirementId).toBe("model");
  });

  it("completes the system admin's setup once the AI connection is verified, without a resume", async () => {
    mocks.getDesignResumeStatus.mockResolvedValue({ exists: false });
    mocks.getSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string | null> = {
        llmProvider: "openrouter",
        model: "gpt-4o",
        onboardingLlmCompleted: "1",
      };
      return values[key] ?? null;
    });

    const status = await getOnboardingStatus();

    expect(status).toMatchObject({ complete: true, nextRequirementId: null });
  });

  it("returns resume as next when no resume is ready", async () => {
    vi.mocked(isSystemAdmin).mockReturnValue(false);
    mocks.canUseDefaultModel.mockResolvedValue(false);
    mocks.getDesignResumeStatus.mockResolvedValue({ exists: false });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(false);
    expect(status.nextRequirementId).toBe("resume");
    expect(status.requirements[2]).toMatchObject({
      id: "resume",
      status: "needs_action",
      primaryAction: "upload_resume",
    });
  });

  it("keeps Ollama onboarding on the model step until a model is selected", async () => {
    mocks.getSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string | null> = {
        llmApiKey: null,
        llmProvider: "ollama",
        llmBaseUrl: "http://localhost:11434",
        model: null,
        onboardingProfileCompleted: "1",
        onboardingLlmCompleted: "1",
        onboardingResumeConfirmedSource: "local:doc-1",
      };
      return values[key] ?? null;
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(false);
    expect(status.nextRequirementId).toBe("model");
    expect(status.requirements[0]).toMatchObject({
      id: "model",
      status: "needs_action",
      title: "Choose an Ollama model",
      primaryAction: "connect_model",
    });
  });

  it("keeps LiteLLM onboarding on the model step until a model is selected", async () => {
    mocks.getSetting.mockImplementation(async (key: string) => {
      const values: Record<string, string | null> = {
        llmApiKey: "sk-virtual",
        llmProvider: "litellm",
        llmBaseUrl: "http://localhost:4000",
        model: null,
        onboardingProfileCompleted: "1",
        onboardingLlmCompleted: "1",
        onboardingResumeConfirmedSource: "local:doc-1",
      };
      return values[key] ?? null;
    });

    const status = await getOnboardingStatus();

    expect(status.complete).toBe(false);
    expect(status.nextRequirementId).toBe("model");
    expect(status.requirements[0]).toMatchObject({
      id: "model",
      status: "needs_action",
      title: "Choose a LiteLLM model",
      primaryAction: "connect_model",
      details: { provider: "litellm", baseUrl: "http://localhost:4000" },
    });
  });

  it("is complete when all durable requirements are complete", async () => {
    const status = await getOnboardingStatus();

    expect(status).toMatchObject({
      complete: true,
      nextRequirementId: null,
    });
  });

  it("omits model onboarding for hosted Free when platform LLM manages model settings", async () => {
    mocks.getJobOpsAppStatus.mockReturnValue({
      appMode: "hosted",
      capabilities: {
        hostedSignups: true,
        platformLlm: true,
        quotas: true,
        userEditableLlmSettings: false,
      },
      hostedTenantConfigured: true,
    });
    mocks.getCurrentAccountEntitlements.mockResolvedValue({
      plan: "free",
      platformAiIncluded: true,
      userEditableLlmSettings: false,
      hostedLimits: {},
      subscription: null,
    });
    mocks.getDesignResumeStatus.mockResolvedValue({ exists: false });
    mocks.validateLlmCredentials.mockResolvedValue({
      valid: false,
      message: "LLM API key is missing.",
    });

    const status = await getOnboardingStatus();

    expect(mocks.validateLlmCredentials).not.toHaveBeenCalled();
    expect(status.complete).toBe(false);
    expect(status.nextRequirementId).toBe("resume");
    expect(status.requirements).toHaveLength(2);
    expect(status.requirements[1]).toMatchObject({
      id: "resume",
      status: "needs_action",
      title: "Upload your existing resume, PDF or DOCX",
    });
  });

  it("validates the model action before persisting and keeps secrets out of error details", async () => {
    mocks.validateLlmCredentials.mockResolvedValue({
      valid: false,
      message: "Invalid LLM API key. Check the key and try again.",
    });

    await expect(
      saveOnboardingModelAction({
        provider: "openrouter",
        apiKey: "sk-secret-value",
        model: "gpt-4o",
      }),
    ).rejects.toMatchObject({
      details: {
        provider: "openrouter",
        status: null,
      },
    });
    expect(mocks.applySettingsUpdates).not.toHaveBeenCalled();
  });

  it("persists profile run defaults and the durable completion marker", async () => {
    await saveOnboardingProfileAction({
      country: "United Kingdom",
      cities: ["London", "Manchester"],
      workplaceTypes: ["remote", "hybrid"],
    });

    expect(mocks.applySettingsUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        searchCities: "London|Manchester",
        workplaceTypes: ["remote", "hybrid"],
        jobspyCountryIndeed: "United Kingdom",
        onboardingProfileCompleted: true,
      }),
    );
  });

  it("allows country-wide or remote preferences without selected cities", async () => {
    await saveOnboardingProfileAction({
      country: "United Kingdom",
      cities: [],
      workplaceTypes: ["remote"],
    });

    expect(mocks.applySettingsUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        searchCities: "",
        workplaceTypes: ["remote"],
        onboardingProfileCompleted: true,
      }),
    );
  });

  it("persists the model completion marker only after validation", async () => {
    await saveOnboardingModelAction({
      provider: "openrouter",
      apiKey: "sk-valid",
      model: "gpt-4o",
    });

    expect(mocks.applySettingsUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        llmProvider: "openrouter",
        llmApiKey: "sk-valid",
        model: "gpt-4o",
        onboardingLlmCompleted: true,
      }),
    );
  });

  it("confirms only the currently available resume source", async () => {
    await confirmOnboardingResumeAction({ source: "local:doc-1" });
    expect(mocks.applySettingsUpdates).toHaveBeenCalledWith({
      onboardingResumeConfirmedSource: "local:doc-1",
    });

    await expect(
      confirmOnboardingResumeAction({ source: "local:stale-document" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a new LiteLLM model action without an explicit model", async () => {
    await expect(
      saveOnboardingModelAction({
        provider: "litellm",
        baseUrl: "http://localhost:4000",
        model: null,
      }),
    ).rejects.toMatchObject({
      details: {
        provider: "litellm",
        status: null,
      },
    });
    expect(mocks.validateLlmCredentials).not.toHaveBeenCalled();
    expect(mocks.applySettingsUpdates).not.toHaveBeenCalled();
  });

  it("rejects a new Ollama model action without an explicit model", async () => {
    await expect(
      saveOnboardingModelAction({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        model: null,
      }),
    ).rejects.toMatchObject({
      details: {
        provider: "ollama",
        status: null,
      },
    });
    expect(mocks.validateLlmCredentials).not.toHaveBeenCalled();
    expect(mocks.applySettingsUpdates).not.toHaveBeenCalled();
  });

  it("adds Ollama timeout guidance to model action failures", async () => {
    mocks.validateLlmCredentials.mockResolvedValue({
      valid: false,
      message: "The operation timed out.",
    });

    await expect(
      saveOnboardingModelAction({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        model: "llama3:latest",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Try a smaller or faster model"),
    });
    expect(mocks.applySettingsUpdates).not.toHaveBeenCalled();
  });

  it("syncs candidate library from local design resume when confirming onboarding resume", async () => {
    const resumeJson = buildDefaultResumeDocument() as DesignResumeJson;
    resumeJson.basics.name = "Test Candidate";
    resumeJson.sections.experience.items = [
      {
        id: "exp-1",
        hidden: false,
        company: "Acme Corp",
        position: "Backend Engineer",
        location: "London",
        period: "2022 - Present",
        website: { url: "", label: "" },
        description: "<ul><li>Built distributed APIs</li></ul>",
        roles: [],
      },
    ];
    mocks.getCurrentDesignResume.mockResolvedValue({
      id: "doc-1",
      resumeJson,
    });

    await confirmOnboardingResumeAction({ source: "local:doc-1" });

    expect(mocks.getCurrentDesignResume).toHaveBeenCalledTimes(1);
    expect(mocks.syncCandidateLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.syncCandidateLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        basics: expect.objectContaining({ name: "Test Candidate" }),
        sections: expect.objectContaining({
          experience: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({
                company: "Acme Corp",
                position: "Backend Engineer",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("treats candidate library sync failure during onboarding confirmation as non-fatal", async () => {
    const resumeJson = buildDefaultResumeDocument() as DesignResumeJson;
    resumeJson.basics.name = "Test Candidate";
    mocks.getCurrentDesignResume.mockResolvedValue({
      id: "doc-1",
      resumeJson,
    });
    mocks.syncCandidateLibrary.mockImplementation(() => {
      throw new Error("DB busy");
    });

    const status = await confirmOnboardingResumeAction({
      source: "local:doc-1",
    });

    expect(mocks.syncCandidateLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.applySettingsUpdates).toHaveBeenCalledWith({
      onboardingResumeConfirmedSource: "local:doc-1",
    });
    expect(status.complete).toBe(true);
  });

  it("omits model step for non-admin users granted defaultModel and requires BYOK otherwise", async () => {
    vi.mocked(isSystemAdmin).mockReturnValue(false);
    mocks.getSetting.mockResolvedValue(null);
    mocks.canUseDefaultModel.mockResolvedValueOnce(true);

    const grantedStatus = await getOnboardingStatus();
    expect(grantedStatus.requirements.find((req) => req.id === "model")).toBeUndefined();

    mocks.canUseDefaultModel.mockResolvedValueOnce(false);
    const byokStatus = await getOnboardingStatus();
    const modelReq = byokStatus.requirements.find((req) => req.id === "model");
    expect(modelReq?.status).toBe("needs_action");
  });

  it("blocks non-admin onboarding from selecting CLI, local, or custom baseUrl providers", async () => {
    vi.mocked(isSystemAdmin).mockReturnValue(false);
    const { saveOnboardingModelAction } = await import("./onboarding-status");

    await expect(saveOnboardingModelAction({ provider: "litellm" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(saveOnboardingModelAction({ provider: "codex" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      saveOnboardingModelAction({ provider: "openai", baseUrl: "https://custom.example/v1" }),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});
