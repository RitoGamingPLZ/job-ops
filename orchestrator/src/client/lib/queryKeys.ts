import type { JobStatus, PostApplicationProvider } from "@shared/types";

export const queryKeys = {
  app: {
    all: ["app"] as const,
    status: () => [...queryKeys.app.all, "status"] as const,
  },
  auth: {
    all: ["auth"] as const,
    currentUser: () => [...queryKeys.auth.all, "me"] as const,
    ssoProviders: () => [...queryKeys.auth.all, "sso-providers"] as const,
    ssoIdentities: () => [...queryKeys.auth.all, "sso-identities"] as const,
  },
  billing: {
    all: ["billing"] as const,
    status: () => [...queryKeys.billing.all, "status"] as const,
  },
  designResume: {
    all: ["design-resume"] as const,
    current: () => [...queryKeys.designResume.all, "current"] as const,
    status: () => [...queryKeys.designResume.all, "status"] as const,
  },
  settings: {
    all: ["settings"] as const,
    current: () => [...queryKeys.settings.all, "current"] as const,
  },
  profile: {
    all: ["profile"] as const,
    current: () => [...queryKeys.profile.all, "current"] as const,
  },
  demo: {
    all: ["demo"] as const,
    info: () => [...queryKeys.demo.all, "info"] as const,
  },
  onboarding: {
    all: ["onboarding"] as const,
    status: () => [...queryKeys.onboarding.all, "status"] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    inProgressBoard: () =>
      [...queryKeys.jobs.all, "in-progress-board"] as const,
    list: (options?: { statuses?: JobStatus[]; view?: "list" | "full" }) =>
      [...queryKeys.jobs.all, "list", options ?? {}] as const,
    revision: (options?: { statuses?: JobStatus[] }) =>
      [...queryKeys.jobs.all, "revision", options ?? {}] as const,
    detail: (id: string) => [...queryKeys.jobs.all, "detail", id] as const,
    stageEvents: (id: string) =>
      [...queryKeys.jobs.all, "stage-events", id] as const,
    tasks: (id: string) => [...queryKeys.jobs.all, "tasks", id] as const,
    notes: (id: string) => [...queryKeys.jobs.all, "notes", id] as const,
    documents: (id: string) =>
      [...queryKeys.jobs.all, "documents", id] as const,
    emails: (id: string, limit: number) =>
      [...queryKeys.jobs.all, "emails", id, { limit }] as const,
  },
  pipeline: {
    all: ["pipeline"] as const,
    status: () => [...queryKeys.pipeline.all, "status"] as const,
    runs: () => [...queryKeys.pipeline.all, "runs"] as const,
    searchPresets: () => [...queryKeys.pipeline.all, "search-presets"] as const,
    runInsights: (id: string) =>
      [...queryKeys.pipeline.all, "run-insights", id] as const,
  },
  watchlist: {
    all: ["watchlist"] as const,
    sources: () => [...queryKeys.watchlist.all, "sources"] as const,
    results: () => [...queryKeys.watchlist.all, "results"] as const,
    states: () => [...queryKeys.watchlist.all, "states"] as const,
  },
  postApplication: {
    all: ["post-application"] as const,
    providerStatus: (provider: PostApplicationProvider, accountKey: string) =>
      [
        ...queryKeys.postApplication.all,
        "provider-status",
        { provider, accountKey },
      ] as const,
    inbox: (
      provider: PostApplicationProvider,
      accountKey: string,
      limit: number,
    ) =>
      [
        ...queryKeys.postApplication.all,
        "inbox",
        { provider, accountKey, limit },
      ] as const,
    runs: (
      provider: PostApplicationProvider,
      accountKey: string,
      limit: number,
    ) =>
      [
        ...queryKeys.postApplication.all,
        "runs",
        { provider, accountKey, limit },
      ] as const,
    runMessages: (
      runId: string,
      provider: PostApplicationProvider,
      accountKey: string,
    ) =>
      [
        ...queryKeys.postApplication.all,
        "run-messages",
        { runId, provider, accountKey },
      ] as const,
  },
  backups: {
    all: ["backups"] as const,
    list: () => [...queryKeys.backups.all, "list"] as const,
  },
} as const;
