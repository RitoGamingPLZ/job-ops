import { DurableObject } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import type {
  OnTaskDonePayload,
  OnTaskDonePosting,
  OnTaskDoneResult,
} from "../../orchestrator/dist/do/do-entry.mjs";
import { sanitizeUnknown } from "../../orchestrator/src/server/infra/sanitize";
import type { Env } from "./types";
import { computeTableChecksum, quoteIdent } from "./utils";

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

async function readRenderError(response: Response): Promise<unknown> {
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

  private async launchBrowser(): Promise<never> {
    const binding = this.env.BROWSER;
    if (!binding) throw new Error("Browser Run binding is not configured.");
    // Lazy: keep the Playwright client out of the cold-start path of every request.
    const { launch } = await import("@cloudflare/playwright");
    return (await launch(binding)) as never;
  }

  private async ensureExpressServer(): Promise<void> {
    if (this.expressInitialized) {
      return;
    }
    const { createDurableObjectExpressServer } = await loadDoEntry();
    createDurableObjectExpressServer({
      storage: this.ctx.storage,
      r2Bucket: this.env.DATA_BUCKET ?? null,
      env: this.env as unknown as Record<string, unknown>,
      port: DO_EXPRESS_PORT,
      // Cloudflare Browser Run replaces the local Chromium that careers-site crawling needs.
      browserLauncher: this.env.BROWSER ? () => this.launchBrowser() : undefined,
      remoteRenderPdf: async (body, requestId) => {
        const namespace = this.env.SCRAPER_CONTAINER;
        const secret = (this.env.INTERNAL_SYNC_SECRET || this.env.CRON_SECRET)?.trim();
        if (!namespace || !secret) {
          throw new Error("PDF render container or internal secret is not configured.");
        }
        const signal = AbortSignal.timeout(150_000);
        try {
          const response = await namespace
            .getByName("pdf-render")
            .fetch("http://scraper/internal/render-pdf", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-internal-sync-secret": secret,
                ...(requestId ? { "x-request-id": requestId } : {}),
              },
              body,
              signal,
            });
          if (!response.ok) {
            const responseError = await readRenderError(response).catch(() => "[unavailable]");
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
    });
    this.expressInitialized = true;
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
      return this.handleExport(url);
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

  private async handleExport(url: URL): Promise<Response> {
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
      return Response.json(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: `Table not found: ${targetTable}`,
          },
        },
        { status: 404 },
      );
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
      return Response.json(
        {
          ok: false,
          error: { code: "INVALID_REQUEST", message: "Invalid JSON body" },
        },
        { status: 400 },
      );
    }

    const tables = body.tables ?? {};
    const append = Boolean(body.append);
    const clearFirst = body.clearFirst ?? !append;
    const ddl = body.ddl ?? {};
    const importedCounts: Record<string, number> = {};

    for (const [tableName, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "INVALID_REQUEST",
              message: `Expected array of rows for table ${tableName}`,
            },
          },
          { status: 400 },
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
      return Response.json(
        {
          ok: false,
          error: {
            code: "UNPROCESSABLE_ENTITY",
            message: "Table SHA-256 checksum verification failed after import.",
            details: {
              expected: body.checksums,
              actual: actualChecksums,
              rowCounts: actualCounts,
            },
          },
        },
        { status: 422 },
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
}
