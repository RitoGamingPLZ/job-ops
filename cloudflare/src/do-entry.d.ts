declare module "*do-entry.mjs" {
  export interface DurableObjectExpressServerOptions {
    storage: DurableObjectStorage;
    r2Bucket?: R2Bucket | null;
    env?: Record<string, unknown>;
    port?: number;
    remoteRenderPdf?: (body: string, requestId?: string) => Promise<Uint8Array>;
    browserLauncher?: () => Promise<never>;
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
}
