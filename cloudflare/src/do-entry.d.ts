declare module "*do-entry.mjs" {
  export interface DurableObjectExpressServerOptions {
    storage: DurableObjectStorage;
    r2Bucket?: R2Bucket | null;
    backupR2Bucket?: R2Bucket | null;
    env?: Record<string, unknown>;
    port?: number;
    remoteRenderPdf?: (body: string, requestId?: string) => Promise<Uint8Array>;
    remoteWarmPdf?: () => Promise<void>;
    remoteCareersSite?: {
      readCrawl?: (key: string, host: string) => Promise<unknown>;
      enqueueCrawl?: (
        input: import("../../orchestrator/src/server/watchlist/careers-site/scan-task").CareersCrawlRequest,
      ) => Promise<
        import("../../orchestrator/src/server/watchlist/careers-site/scan-task").CareersCrawlStatus
      >;
      enqueueScan?: (
        input: import("../../orchestrator/src/server/watchlist/careers-site/scan-task").CareersScanRequest,
      ) => Promise<
        import("../../orchestrator/src/server/watchlist/careers-site/scan-task").CareersScanStatus
      >;
      scanStatus?: (
        url: string,
      ) => Promise<
        | import("../../orchestrator/src/server/watchlist/careers-site/scan-task").CareersScanStatus
        | null
      >;
      facets?: (input: {
        careersUrl: string;
        filtered: boolean;
        signal?: AbortSignal;
      }) => Promise<{ kind: string; [key: string]: unknown }>;
      run(input: {
        recipe: unknown;
        sourceUrl?: string;
        limit: number;
        budgetMs: number;
        signal?: AbortSignal;
      }): Promise<{ kind: string; [key: string]: unknown }>;
      learn(input: {
        careersUrl: string;
        requestId?: string;
        llm: {
          provider: string | null;
          model: string;
          baseUrl: string | null;
          apiKey: string | null;
        };
        signal?: AbortSignal;
      }): Promise<{ kind: string; [key: string]: unknown }>;
    };
    remoteRunContainerExtractor?: (request: RemoteContainerExtractorRequest) => Promise<{
      success: boolean;
      jobs: unknown[];
      sourceErrors?: string[];
      error?: string;
      challengeRequired?: string;
      resumeState?: unknown;
    }>;
  }

  export interface RemoteContainerExtractorRequest {
    manifestId: string;
    source: string;
    selectedSources: string[];
    searchTerms: string[];
    selectedCountry: string;
    settings: Record<string, string>;
    locationIntent?: unknown;
    sourceLocationPlan?: unknown;
    requestId?: string;
  }

  export interface OnTaskDonePosting {
    postingId?: string;
    jobUrl: string;
    title: string;
    employer: string;
    location?: string | null;
    salary?: string | null;
    datePosted?: string | null;
    description?: string | null;
    extractedJson?: string | null;
  }

  export interface OnTaskDonePayload {
    taskId: string;
    tenantId: string;
    userId?: string | null;
    pipelineRunId?: string | null;
    source: string;
    outcome: "completed" | "failed" | "cached";
    postings?: OnTaskDonePosting[];
  }

  export interface OnTaskDoneResult {
    inserted: number;
    skipped: number;
    tenantId: string;
    pipelineRunId: string | null;
  }

  export interface PortableMigrationResult {
    applied: string[];
    skipped: string[];
    total: number;
  }

  export function createDurableObjectExpressServer(options: DurableObjectExpressServerOptions): {
    app: unknown;
    server: unknown;
  };

  export function runDurableObjectMigrations(
    storage: DurableObjectStorage,
  ): PortableMigrationResult;

  export function handleDurableObjectTaskDone(
    storage: DurableObjectStorage,
    payload: OnTaskDonePayload,
  ): OnTaskDoneResult;

  export function executeCareersScan(
    input: import("../../orchestrator/src/server/watchlist/careers-site/scan-task").CareersScanRequest,
  ): Promise<import("../../shared/src/types/watchlist-scan").WatchlistScanOutcome>;
  export function getSiteRecipe(host: string): Promise<{ recipe: unknown } | null>;
  export function recordQueuedCareersCrawl(
    host: string,
    filtered: boolean,
    result: { kind: string; jobs?: unknown; reason?: unknown },
  ): Promise<void>;
}
