import type { WatchlistScanOutcome } from "../../../../../shared/src/types/watchlist-scan";

/** AppStore resolves credentials at execution using this authenticated scope. */
export interface CareersScanRequest {
  careersUrl: string;
  tenantId: string;
  userId: string;
  requestId: string;
  pipelineRunId?: string;
  repair?: boolean;
}

export type CareersScanStatus =
  | { state: "queued"; taskId?: string }
  | { state: "finished"; outcome: WatchlistScanOutcome; finishedAt: number };

export interface CareersCrawlRequest {
  /** Opaque key for this board, filter variant and visibility scope. */
  key: string;
  host: string;
  payload: Record<string, unknown>;
  requestId?: string;
  scanTaskId?: string;
}

export type CareersCrawlStatus = { state: "queued" } | { state: "finished"; result: unknown };

export class CareersWorkPending extends Error {}

export interface CareersTaskQueue {
  enqueueScan(input: CareersScanRequest): Promise<CareersScanStatus>;
  scanStatus(url: string): Promise<CareersScanStatus | null>;
  enqueueCrawl(input: CareersCrawlRequest): Promise<CareersCrawlStatus>;
  readCrawl(key: string, host: string): Promise<unknown>;
}

let localQueue: CareersTaskQueue | undefined;
export function setLocalCareersTaskQueue(queue: CareersTaskQueue): void {
  localQueue = queue;
}
export function getLocalCareersTaskQueue(): CareersTaskQueue | undefined {
  return localQueue;
}
