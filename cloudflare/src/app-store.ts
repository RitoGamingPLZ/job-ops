import { DurableObject } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import type {
  OnTaskDonePayload,
  OnTaskDonePosting,
  OnTaskDoneResult,
} from "../../orchestrator/dist/do/do-entry.mjs";
import { sanitizeUnknown } from "../../orchestrator/src/server/infra/sanitize";
import type {
  CareersCrawlRequest,
  CareersScanRequest,
} from "../../orchestrator/src/server/watchlist/careers-site/scan-task";
import type { Env } from "./types";
import {
  computeTableChecksum,
  jsonError,
  quoteIdent,
  resolveInternalContainerSecret,
} from "./utils";

type DoEntryModule = typeof import("../../orchestrator/dist/do/do-entry.mjs");

let doEntryPromise: Promise<DoEntryModule> | null = null;

function loadDoEntry(): Promise<DoEntryModule> {
  if (!doEntryPromise) {
    doEntryPromise = import("../../orchestrator/dist/do/do-entry.mjs");
  }
  return doEntryPromise;
}

const DO_EXPRESS_PORT = 3001;
const IMPORT_BATCH_SIZE = 500;
// Browser-driven extractors (Hiring Cafe) can take several minutes per run.
const EXTRACTOR_RUN_TIMEOUT_MS = 10 * 60_000;
// A careers crawl has a 25 s budget; learning a new site can take up to ~3 minutes.
const CAREERS_RUN_TIMEOUT_MS = 40_000;
const CAREERS_LEARN_TIMEOUT_MS = 200_000;

async function readBoundedErrorBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(2048);
  let length = 0;
  try {
    while (length < bytes.length) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, bytes.length - length);
      bytes.set(chunk, length);
      length += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(bytes.subarray(0, length));
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Plain-text or truncated responses still provide a bounded diagnostic.
  }
  return sanitizeUnknown(body, { maxString: 2048 });
}

export type { OnTaskDonePayload, OnTaskDonePosting, OnTaskDoneResult };

interface ImportRequestBody {
  tables?: Record<string, Record<string, unknown>[]>;
  append?: boolean;
  clearFirst?: boolean;
  checksums?: Record<string, string>;
  ddl?: Record<string, string>;
}

function toSqlValue(value: unknown): SqlStorageValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || value instanceof ArrayBuffer) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  return JSON.stringify(value);
}

export class AppStore extends DurableObject<Env> {
  private expressInitialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      await this.ensureSchema();
      await this.ensureExpressServer();
    });
  }

  private async ensureExpressServer(): Promise<void> {
    if (this.expressInitialized) {
      return;
    }
    const { createDurableObjectExpressServer } = await loadDoEntry();
    createDurableObjectExpressServer({
      storage: this.ctx.storage,
      r2Bucket: this.env.DATA_BUCKET ?? null,
      backupR2Bucket: this.env.BACKUP_BUCKET ?? null,
      env: this.env as unknown as Record<string, unknown>,
      port: DO_EXPRESS_PORT,
      remoteRunContainerExtractor: async (request) => {
        const namespace = this.env.SCRAPER_CONTAINER;
        const secret = resolveInternalContainerSecret(this.env);
        if (!namespace || !secret) {
          throw new Error("Scraper container or internal secret is not configured.");
        }
        const signal = AbortSignal.timeout(EXTRACTOR_RUN_TIMEOUT_MS);
        try {
          const response = await this.postToScraperContainer({
            namespace,
            name: `extractor-${request.manifestId}`,
            path: "/scrape",
            secret,
            requestId: request.requestId,
            body: JSON.stringify({
              source: request.source,
              params: {
                selectedSources: request.selectedSources,
                searchTerms: request.searchTerms,
                selectedCountry: request.selectedCountry,
                settings: request.settings,
                locationIntent: request.locationIntent,
                sourceLocationPlan: request.sourceLocationPlan,
              },
            }),
            signal,
          });
          if (!response.ok) {
            const responseError = await readBoundedErrorBody(response).catch(() => "[unavailable]");
            throw Object.assign(
              new Error(`Scraper container failed with HTTP ${response.status}.`),
              { details: { status: response.status, response: responseError } },
            );
          }
          const body = (await response.json()) as {
            ok?: boolean;
            data?: {
              extractorSucceeded?: boolean;
              jobs?: unknown[];
              sourceErrors?: string[];
              error?: string;
              challengeRequired?: string;
              resumeState?: unknown;
            };
          };
          const data = body.data;
          if (!body.ok || !data) {
            throw new Error("Scraper container returned an invalid response.");
          }
          return {
            success: data.extractorSucceeded === true,
            jobs: (data.jobs ?? []) as never[],
            ...(data.sourceErrors ? { sourceErrors: data.sourceErrors } : {}),
            ...(data.error ? { error: data.error } : {}),
            ...(data.challengeRequired ? { challengeRequired: data.challengeRequired } : {}),
            ...(data.resumeState !== undefined ? { resumeState: data.resumeState } : {}),
          };
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof Error &&
              (error.name === "AbortError" || error.name === "TimeoutError"))
          ) {
            throw new Error("Scraper container timed out.");
          }
          throw error;
        }
      },
      // Careers sites need a browser, which only the scraper container has. It is stateless: the
      // recipe and LLM connection travel with each request and the result comes straight back.
      remoteCareersSite: {
        ...(this.env.SCRAPE_COORDINATOR
          ? {
              readCrawl: (key, host) =>
                this.env.SCRAPE_COORDINATOR!.getByName("primary").readCareersCrawl(key, host),
              enqueueCrawl: (input) =>
                this.env.SCRAPE_COORDINATOR!.getByName("primary").enqueueCareersCrawl(input),
              enqueueScan: (input) =>
                this.env.SCRAPE_COORDINATOR!.getByName("primary").enqueueCareersScan(input),
              scanStatus: (url) =>
                this.env.SCRAPE_COORDINATOR!.getByName("primary").careersScanStatus(url),
            }
          : {}),
        run: (input) =>
          this.callCareersSiteContainer(
            "run",
            {
              recipe: input.recipe,
              ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
              limit: input.limit,
              budgetMs: input.budgetMs,
            },
            CAREERS_RUN_TIMEOUT_MS,
            input.signal,
          ),
        learn: (input) =>
          this.callCareersSiteContainer(
            "learn",
            { careersUrl: input.careersUrl, llm: input.llm },
            CAREERS_LEARN_TIMEOUT_MS,
            input.signal,
            input.requestId,
          ),
      },
      remoteRenderPdf: async (body, requestId) => {
        const namespace = this.env.SCRAPER_CONTAINER;
        const secret = resolveInternalContainerSecret(this.env);
        if (!namespace || !secret) {
          throw new Error("PDF render container or internal secret is not configured.");
        }
        const signal = AbortSignal.timeout(150_000);
        try {
          const response = await this.postToScraperContainer({
            namespace,
            name: "pdf-render",
            path: "/internal/render-pdf",
            secret,
            requestId,
            body,
            signal,
          });
          if (!response.ok) {
            const responseError = await readBoundedErrorBody(response).catch(() => "[unavailable]");
            // The service logs sanitized details; only the message reaches the user.
            throw Object.assign(
              new Error(`PDF render container failed with HTTP ${response.status}.`),
              {
                details: { status: response.status, response: responseError },
              },
            );
          }
          return new Uint8Array(await response.arrayBuffer());
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof Error &&
              (error.name === "AbortError" || error.name === "TimeoutError"))
          ) {
            throw new Error("PDF render container timed out.");
          }
          throw error;
        }
      },
      remoteWarmPdf: async () => {
        const namespace = this.env.SCRAPER_CONTAINER;
        const secret = resolveInternalContainerSecret(this.env);
        if (!namespace || !secret) return;
        const response = await this.postToScraperContainer({
          namespace,
          name: "pdf-render",
          path: "/internal/render-pdf/warm",
          secret,
          signal: AbortSignal.timeout(150_000),
        });
        await response.body?.cancel();
        if (!response.ok) {
          throw new Error(`PDF render container warm-up failed with HTTP ${response.status}.`);
        }
      },
    });
    this.expressInitialized = true;
  }

  private postToScraperContainer(args: {
    namespace: NonNullable<Env["SCRAPER_CONTAINER"]>;
    name: string;
    path: string;
    secret: string;
    signal: AbortSignal;
    body?: string;
    requestId?: string;
  }): Promise<Response> {
    return args.namespace.getByName(args.name).fetch(`http://scraper${args.path}`, {
      method: "POST",
      headers: {
        "x-internal-sync-secret": args.secret,
        ...(args.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(args.requestId ? { "x-request-id": args.requestId } : {}),
      },
      body: args.body,
      signal: args.signal,
    });
  }

  private async callCareersSiteContainer(
    action: "run" | "learn",
    body: unknown,
    timeoutMs: number,
    callerSignal?: AbortSignal,
    requestId?: string,
  ): Promise<{ kind: string; [key: string]: unknown }> {
    const namespace = this.env.SCRAPER_CONTAINER;
    const secret = resolveInternalContainerSecret(this.env);
    if (!namespace || !secret) {
      return {
        kind: "unavailable",
        message: "The careers-site browser is not configured on this deployment.",
      };
    }
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      const response = await this.postToScraperContainer({
        namespace,
        name: "careers-site",
        path: `/internal/careers-site/${action}`,
        secret,
        body: JSON.stringify(body),
        signal,
        requestId,
      });
      if (!response.ok) {
        // A cold container answers 503 until it is ready; either way nothing is known about the site.
        await response.body?.cancel();
        return {
          kind: "unavailable",
          message:
            response.status === 503
              ? "The careers-site browser is starting. Check again in a minute."
              : `The careers-site browser failed (HTTP ${response.status}).`,
        };
      }
      const parsed = (await response.json()) as {
        ok?: boolean;
        data?: { kind: string; [key: string]: unknown };
      };
      if (!parsed.ok || !parsed.data) {
        return {
          kind: "unavailable",
          message: "The careers-site browser returned an invalid response.",
        };
      }
      return parsed.data;
    } catch (error) {
      // A caller abort (its own timeout) is the caller's to handle, not a container outage.
      if (callerSignal?.aborted) throw callerSignal.reason ?? error;
      // Say what failed. This text reaches the scan status shown to users, so only the error
      // class and a short clipped message, never a stack or request body.
      // Errors that cross a Durable Object boundary are often not `Error` instances, so read the
      // fields rather than rely on `instanceof`.
      const thrown = error as { name?: unknown; message?: unknown } | null;
      const detail = (
        error instanceof Error || typeof thrown?.message === "string"
          ? `${typeof thrown?.name === "string" ? thrown.name : "Error"}: ${thrown?.message}`
          : String(error)
      )
        .replace(/\s+/g, " ")
        .slice(0, 140);
      console.error(
        JSON.stringify({
          msg: "careers-site-container-call-failed",
          action,
          detail: detail || String(error).slice(0, 140),
        }),
      );
      return {
        kind: "unavailable",
        message:
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "The careers-site browser timed out. Check again in a minute."
            : `The careers-site browser could not be reached${detail ? ` (${detail})` : ""}.`,
      };
    }
  }

  private async ensureSchema(): Promise<void> {
    const { runDurableObjectMigrations } = await loadDoEntry();
    runDurableObjectMigrations(this.ctx.storage);
  }

  private listUserTables(): string[] {
    const cursor = this.ctx.storage.sql.exec<{ name: string }>(
      `SELECT name FROM sqlite_master
			 WHERE type = 'table'
			   AND name NOT LIKE 'sqlite_%'
			   AND name NOT LIKE '_cf_%'
			 ORDER BY name ASC`,
    );
    return cursor.toArray().map((row) => row.name);
  }

  private getTableColumns(tableName: string): string[] {
    const rows = this.ctx.storage.sql
      .exec<{ name: string }>(`PRAGMA table_info(${quoteIdent(tableName)})`)
      .toArray();
    return rows.map((r) => r.name);
  }

  private readTableRows(
    tableName: string,
    limit?: number,
    offset?: number,
  ): Record<string, unknown>[] {
    const quoted = quoteIdent(tableName);
    if (typeof limit === "number" && limit > 0) {
      return this.ctx.storage.sql
        .exec<Record<string, SqlStorageValue>>(
          `SELECT * FROM ${quoted} ORDER BY rowid ASC LIMIT ? OFFSET ?`,
          limit,
          offset ?? 0,
        )
        .toArray();
    }
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(`SELECT * FROM ${quoted} ORDER BY rowid ASC`)
      .toArray();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_cf/do/export" && request.method === "GET") {
      return this.handleExport(request, url);
    }

    if (url.pathname === "/_cf/do/import" && request.method === "POST") {
      return this.handleImport(request);
    }

    if (url.pathname === "/_cf/do/status" && request.method === "GET") {
      const userCount =
        this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM users").one()
          ?.count ?? 0;
      const jobCount =
        this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM jobs").one()
          ?.count ?? 0;
      const migratedFromD1 = (await this.ctx.storage.get<boolean>("migratedFromD1")) ?? false;
      const migratedFromD1At = (await this.ctx.storage.get<string>("migratedFromD1At")) ?? null;
      return Response.json({
        ok: true,
        data: {
          userCount,
          jobCount,
          migratedFromD1,
          migratedFromD1At,
          tablesCount: this.listUserTables().length,
        },
      });
    }

    if (url.pathname === "/_cf/do/on-task-done" && request.method === "POST") {
      const payload = (await request.json()) as OnTaskDonePayload;
      const result = await this.onTaskDone(payload);
      return Response.json({ ok: true, data: result });
    }

    await this.ensureExpressServer();
    return handleAsNodeRequest(DO_EXPRESS_PORT, request, this.env);
  }

  private async handleExport(request: Request, url: URL): Promise<Response> {
    const targetTable = url.searchParams.get("table");
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    const availableTables = this.listUserTables();
    const tableNames = targetTable
      ? availableTables.filter((t) => t === targetTable)
      : availableTables;

    if (targetTable && tableNames.length === 0) {
      return jsonError(request, "NOT_FOUND", `Table not found: ${targetTable}`, { status: 404 });
    }

    const tables: Record<string, Record<string, unknown>[]> = {};
    const rowCounts: Record<string, number> = {};
    const checksums: Record<string, string> = {};

    for (const tableName of tableNames) {
      const rows = this.readTableRows(tableName, limit, offset);
      tables[tableName] = rows;
      rowCounts[tableName] = rows.length;
      checksums[tableName] = await computeTableChecksum(rows);
    }

    return Response.json({
      ok: true,
      data: { tables, rowCounts, checksums },
    });
  }

  private async handleImport(request: Request): Promise<Response> {
    let body: ImportRequestBody;
    try {
      body = (await request.json()) as ImportRequestBody;
    } catch {
      return jsonError(request, "INVALID_REQUEST", "Invalid JSON body", { status: 400 });
    }

    const tables = body.tables ?? {};
    const append = Boolean(body.append);
    const clearFirst = body.clearFirst ?? !append;
    const ddl = body.ddl ?? {};
    const importedCounts: Record<string, number> = {};

    for (const [tableName, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows)) {
        return jsonError(
          request,
          "INVALID_REQUEST",
          `Expected array of rows for table ${tableName}`,
          {
            status: 400,
          },
        );
      }

      if (ddl[tableName]) {
        this.ctx.storage.sql.exec(ddl[tableName]);
      }

      const existingCols = this.getTableColumns(tableName);
      if (existingCols.length === 0) {
        if (rows.length === 0) {
          importedCounts[tableName] = 0;
          continue;
        }
        const inferredCols = Object.keys(rows[0] ?? {});
        if (inferredCols.length === 0) {
          importedCounts[tableName] = 0;
          continue;
        }
        const colDefs = inferredCols.map((col) => `${quoteIdent(col)} TEXT`).join(", ");
        this.ctx.storage.sql.exec(
          `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (${colDefs})`,
        );
      }

      if (clearFirst) {
        this.ctx.storage.sql.exec(`DELETE FROM ${quoteIdent(tableName)}`);
      }

      if (rows.length === 0) {
        importedCounts[tableName] = 0;
        continue;
      }

      const tableCols = new Set(this.getTableColumns(tableName));
      let inserted = 0;

      for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(i, i + IMPORT_BATCH_SIZE);
        this.ctx.storage.transactionSync(() => {
          for (const row of batch) {
            const cols = Object.keys(row).filter((c) => tableCols.has(c));
            if (cols.length === 0) continue;
            const colList = cols.map(quoteIdent).join(", ");
            const placeholders = cols.map(() => "?").join(", ");
            const values = cols.map((c) => toSqlValue(row[c]));
            this.ctx.storage.sql.exec(
              `INSERT OR REPLACE INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders})`,
              ...values,
            );
            inserted++;
          }
        });
      }

      importedCounts[tableName] = inserted;
    }

    const actualChecksums: Record<string, string> = {};
    const actualCounts: Record<string, number> = {};
    let verified = true;

    for (const tableName of Object.keys(tables)) {
      const storedRows = this.readTableRows(tableName);
      actualCounts[tableName] = storedRows.length;
      actualChecksums[tableName] = await computeTableChecksum(storedRows);
      if (body.checksums?.[tableName] && body.checksums[tableName] !== actualChecksums[tableName]) {
        verified = false;
      }
    }

    if (body.checksums && !verified) {
      return jsonError(
        request,
        "UNPROCESSABLE_ENTITY",
        "Table SHA-256 checksum verification failed after import.",
        {
          status: 422,
          details: {
            expected: body.checksums,
            actual: actualChecksums,
            rowCounts: actualCounts,
          },
        },
      );
    }

    return Response.json({
      ok: true,
      data: {
        imported: importedCounts,
        rowCounts: actualCounts,
        checksums: actualChecksums,
        verified,
      },
    });
  }

  async onTaskDone(payload: OnTaskDonePayload): Promise<OnTaskDoneResult> {
    const { handleDurableObjectTaskDone } = await loadDoEntry();
    return handleDurableObjectTaskDone(this.ctx.storage, payload);
  }

  async executeCareersScan(input: CareersScanRequest) {
    await this.ensureExpressServer();
    const { executeCareersScan } = await loadDoEntry();
    return executeCareersScan(input);
  }

  async executeCareersCrawl(input: Pick<CareersCrawlRequest, "host" | "payload" | "requestId">) {
    let payload = input.payload;
    if (!payload.recipe && typeof payload.careersUrl === "string") {
      await this.ensureExpressServer();
      const { getSiteRecipe } = await loadDoEntry();
      const url = new URL(payload.careersUrl);
      const stored = await getSiteRecipe(url.hostname);
      if (!stored?.recipe) return { kind: "failed" };
      payload = {
        recipe: stored.recipe,
        ...(url.search ? { sourceUrl: url.href } : {}),
        limit: 4,
        budgetMs: 20_000,
      };
    }
    const result = await this.callCareersSiteContainer(
      "run",
      payload,
      CAREERS_RUN_TIMEOUT_MS,
      undefined,
      input.requestId,
    );
    await this.ensureExpressServer();
    const { recordQueuedCareersCrawl } = await loadDoEntry();
    await recordQueuedCareersCrawl(input.host, Boolean(payload.sourceUrl), result);
    return result;
  }
}
