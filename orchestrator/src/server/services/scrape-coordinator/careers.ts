import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { db } from "@server/db";
import { scrapeTasks } from "@server/db/schema";
import { getSiteRecipe } from "@server/repositories/site-recipes";
import {
  executeCareersScan,
  recordQueuedCareersCrawl,
} from "@server/watchlist/adapters/careers-site";
import { runRecipe } from "@server/watchlist/careers-site/run-recipe";
import { createBudgetSignal } from "@server/watchlist/adapters/http";
import {
  type CareersScanRequest,
  type CareersCrawlRequest,
  type CareersScanStatus,
  type CareersTaskQueue,
  setLocalCareersTaskQueue,
} from "@server/watchlist/careers-site/scan-task";
import { recipeSchema, SiteBlockedError } from "@server/watchlist/careers-site/types";
import { and, desc, eq, inArray, like, lt, or } from "drizzle-orm";

const scanPrefix = "careers-scan:";
const crawlPrefix = "careers-crawl:";
const careersOnly = or(
  like(scrapeTasks.source, `${scanPrefix}%`),
  like(scrapeTasks.source, `${crawlPrefix}%`),
);
type Task = typeof scrapeTasks.$inferSelect;

function latest(source: string, key: string) {
  return db
    .select()
    .from(scrapeTasks)
    .where(and(eq(scrapeTasks.source, source), eq(scrapeTasks.scrapeKey, key)))
    .orderBy(desc(scrapeTasks.createdAt))
    .limit(1)
    .get();
}

function scanTarget(value: string) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return { source: scanPrefix + url.hostname, key: url.href };
}

function status(task: Task | undefined): CareersScanStatus | null {
  if (!task) return null;
  if (task.status === "pending" || task.status === "running")
    return { state: "queued", taskId: task.id };
  const outcome =
    task.error === "found" || task.error === "none" || task.error === "blocked"
      ? task.error
      : "failed";
  return { state: "finished", outcome: { outcome }, finishedAt: Date.parse(task.updatedAt) };
}

function addTask(
  source: string,
  key: string,
  input: CareersScanRequest | CareersCrawlRequest,
  dependency?: string,
) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db.insert(scrapeTasks)
    .values({
      id,
      scrapeKey: key,
      windowStart: timestamp,
      source,
      titleNorm: "",
      runtime: "container",
      careersPayload: JSON.stringify(input),
      careersDependency: dependency,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return id;
}

const queue: CareersTaskQueue = {
  async enqueueScan(input) {
    const { source, key } = scanTarget(input.careersUrl);
    const existing = status(latest(source, key));
    if (existing?.state === "queued") return existing;
    if (existing?.state === "finished") {
      const cooldown =
        existing.outcome.outcome === "failed" ? 1_800_000 : input.repair ? 0 : 21_600_000;
      if (Date.now() - existing.finishedAt < cooldown) return existing;
    }
    return { state: "queued", taskId: addTask(source, key, { ...input, careersUrl: key }) };
  },
  async scanStatus(value) {
    const { source, key } = scanTarget(value);
    return status(latest(source, key));
  },
  async enqueueCrawl(input) {
    const source = crawlPrefix + input.host;
    const task = latest(source, input.key);
    if (task?.status === "pending" || task?.status === "running") return { state: "queued" };
    if (task && Date.now() - Date.parse(task.updatedAt) < 300_000)
      return { state: "finished", result: JSON.parse(task.careersPayload ?? '{"kind":"failed"}') };
    addTask(source, input.key, input, input.scanTaskId);
    return { state: "queued" };
  },
  async readCrawl(key, host) {
    const rows = db
      .select({ payload: scrapeTasks.careersPayload })
      .from(scrapeTasks)
      .where(
        and(
          eq(scrapeTasks.source, crawlPrefix + host),
          eq(scrapeTasks.scrapeKey, key),
          eq(scrapeTasks.status, "done"),
        ),
      )
      .orderBy(desc(scrapeTasks.completedAt))
      .limit(5)
      .all();
    return (
      rows
        .map(({ payload }) => JSON.parse(payload ?? "null"))
        .find((item) => item?.kind === "jobs") ?? null
    );
  },
};

async function runCrawl(input: CareersCrawlRequest) {
  const { payload } = input;
  try {
    const sourceUrl =
      typeof payload.sourceUrl === "string"
        ? payload.sourceUrl
        : typeof payload.careersUrl === "string" && new URL(payload.careersUrl).search
          ? payload.careersUrl
          : undefined;
    const recipe = recipeSchema.parse(payload.recipe ?? (await getSiteRecipe(input.host))?.recipe);
    const jobs = await runRecipe(recipe, {
      signal: createBudgetSignal(undefined, 25_000),
      stopAt: Date.now() + 20_000,
      limit: typeof payload.limit === "number" ? payload.limit : 4,
      sourceUrl,
    });
    return { kind: "jobs", jobs };
  } catch (error) {
    if (error instanceof SiteBlockedError) return { kind: "blocked", reason: error.reason };
    return { kind: "failed" };
  }
}

async function execute(task: Task, leaseUntil: string) {
  const scan = task.source.startsWith(scanPrefix);
  let result: unknown;
  let error: string | null = null;
  try {
    if (scan) error = (await executeCareersScan(JSON.parse(task.careersPayload ?? "{}"))).outcome;
    else {
      const input = JSON.parse(task.careersPayload ?? "{}") as CareersCrawlRequest;
      const crawled = await runCrawl(input);
      const value = input.payload.sourceUrl ?? input.payload.careersUrl;
      await recordQueuedCareersCrawl(
        input.host,
        typeof value === "string" && Boolean(new URL(value).search),
        crawled,
      );
      result = crawled;
    }
  } catch {
    error = "failed";
    logger.warn("Queued careers task failed", { taskId: task.id });
  }
  const timestamp = new Date().toISOString();
  db.update(scrapeTasks)
    .set({
      status: error && error !== "found" && error !== "none" ? "failed" : "done",
      error,
      careersPayload: result === undefined ? null : JSON.stringify(result),
      leaseUntil: null,
      completedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(and(eq(scrapeTasks.id, task.id), eq(scrapeTasks.leaseUntil, leaseUntil)))
    .run();
}

function dispatchCareersTasks(): void {
  const now = new Date();
  const timestamp = now.toISOString();
  const lease = new Date(now.getTime() + 300_000).toISOString();
  db.update(scrapeTasks)
    .set({ status: "pending", leaseUntil: null })
    .where(
      and(careersOnly, eq(scrapeTasks.status, "running"), lt(scrapeTasks.leaseUntil, timestamp)),
    )
    .run();
  const tasks = db
    .select()
    .from(scrapeTasks)
    .where(and(careersOnly, inArray(scrapeTasks.status, ["pending", "running"])))
    .orderBy(scrapeTasks.createdAt)
    .all();
  const running = tasks.filter((task) => task.status === "running");
  for (const task of tasks) {
    if (task.status !== "pending") continue;
    const scan = task.source.startsWith(scanPrefix);
    const kind = scan ? scanPrefix : crawlPrefix;
    const host = task.source.slice(kind.length);
    if (
      running.some(
        (item) => item.source === scanPrefix + host || item.source === crawlPrefix + host,
      )
    )
      continue;
    if (running.filter((item) => item.source.startsWith(kind)).length >= (scan ? 2 : 4)) continue;
    const dependency = task.careersDependency
      ? db
          .select({ status: scrapeTasks.status })
          .from(scrapeTasks)
          .where(eq(scrapeTasks.id, task.careersDependency))
          .get()
      : undefined;
    if (dependency?.status === "pending" || dependency?.status === "running") continue;
    if (task.attempts >= 3 || (task.careersDependency && dependency?.status !== "done")) {
      db.update(scrapeTasks)
        .set({ status: "failed", careersPayload: null, updatedAt: timestamp })
        .where(and(eq(scrapeTasks.id, task.id), eq(scrapeTasks.status, "pending")))
        .run();
      continue;
    }
    const claim = db
      .update(scrapeTasks)
      .set({ status: "running", leaseUntil: lease, attempts: task.attempts + 1 })
      .where(and(eq(scrapeTasks.id, task.id), eq(scrapeTasks.status, "pending")))
      .run();
    if (!claim.changes) continue;
    running.push(task);
    void execute(task, lease).catch(() =>
      logger.warn("Could not finish queued careers task", { taskId: task.id }),
    );
  }
}

export function startLocalCareersQueue(): void {
  setLocalCareersTaskQueue(queue);
  setInterval(() => {
    try {
      dispatchCareersTasks();
    } catch (error) {
      logger.warn("Could not dispatch queued careers tasks", { error });
    }
  }, 2_000).unref();
}
