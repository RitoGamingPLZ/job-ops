import { logger } from "@infra/logger";
import { foldedLibraryText, parseLibraryData } from "@shared/candidate-library-schema";
import type { CandidateItemKind } from "@shared/types/cowork";
import type Database from "better-sqlite3";
import type { ZodError } from "zod";

const migrationId = "candidate-library-structured-fields-v2";
const sections = {
  education: "education",
  award: "awards",
  certification: "certifications",
} as const;
type StructuredKind = keyof typeof sections;
type Row = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  kind: StructuredKind;
  text: string;
  data: string | null;
};
const string = (value: unknown) => (typeof value === "string" ? value : "");
function identity(kind: CandidateItemKind, data: Record<string, unknown>): string {
  return JSON.stringify(
    (kind === "education"
      ? [data.school, data.period]
      : kind === "award"
        ? [data.date]
        : [data.issuer, data.date]
    ).map((value) => string(value).trim().replace(/\s+/g, " ")),
  );
}
function sourceItems(raw: string): Record<string, Record<string, unknown>[]> {
  try {
    const doc = JSON.parse(raw);
    // Only stored v5 documents: its sections are an object, not the v4 array/layout.
    if (
      !doc ||
      !Array.isArray(doc.customSections) ||
      !doc.sections ||
      Array.isArray(doc.sections) ||
      !doc.basics
    )
      return {};
    return Object.fromEntries(
      Object.values(sections).map((section) => {
        const items = doc.sections[section]?.items;
        return [
          section,
          Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [],
        ];
      }),
    );
  } catch {
    return {};
  }
}
function hasValue(value: unknown): boolean {
  if (value && typeof value === "object") return Object.values(value).some(hasValue);
  return value !== undefined && value !== null && value !== "";
}
function conflicts(known: unknown, source: unknown): boolean {
  if (known && typeof known === "object") {
    const values = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
    return Object.entries(known).some(([key, value]) => conflicts(value, values[key]));
  }
  return hasValue(known) && known !== source;
}
/** Startup-only, atomic, scoped data migration. Saved resume documents are read-only. */
export function backfillStructuredLibrary(sqlite: Database.Database): void {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS app_data_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  sqlite.transaction(() => {
    if (sqlite.prepare("SELECT 1 FROM app_data_migrations WHERE id = ?").get(migrationId)) return;
    const rows = sqlite
      .prepare(
        "SELECT id, tenant_id, user_id, kind, text, data FROM experience_bullets WHERE kind IN ('education','award','certification')",
      )
      .all() as Row[];
    const sources = sqlite.prepare(
      "SELECT document AS document FROM job_resumes WHERE tenant_id = ? AND user_id IS ? UNION ALL SELECT resume_json AS document FROM design_resume_documents WHERE tenant_id = ? AND user_id IS ? AND source_mode = 'v5'",
    );
    const update = sqlite.prepare(
      "UPDATE experience_bullets SET text = ?, data = ? WHERE id = ? AND tenant_id = ? AND user_id IS ?",
    );
    const scopedSources = new Map<string, ReturnType<typeof sourceItems>[]>();
    for (const row of rows) {
      try {
        let data: unknown;
        try {
          data = row.data === null ? {} : JSON.parse(row.data);
        } catch {
          throw new Error("Invalid structured library JSON");
        }
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid structured library migration data");
        const known = data as Record<string, unknown>;
        const normalized = parseLibraryData(row.kind, known);
        if (known.schemaVersion === 2) continue;
        const scopeKey = JSON.stringify([row.tenant_id, row.user_id]);
        let documents = scopedSources.get(scopeKey);
        if (!documents) {
          documents = (
            sources.all(row.tenant_id, row.user_id, row.tenant_id, row.user_id) as {
              document: string;
            }[]
          ).map((source) => sourceItems(source.document));
          scopedSources.set(scopeKey, documents);
        }
        const candidates = documents
          .flatMap((doc) => doc[sections[row.kind]] ?? [])
          .flatMap((item) => {
            const text = string(row.kind === "education" ? item.degree : item.title);
            if (
              (item.libraryId && item.libraryId !== row.id) ||
              identity(row.kind, item) !== identity(row.kind, known) ||
              foldedLibraryText(row.kind, text, item) !== row.text
            )
              return [];
            try {
              const recovered = parseLibraryData(
                row.kind,
                Object.fromEntries(
                  Object.keys(parseLibraryData(row.kind, {}))
                    .filter((key) => key !== "schemaVersion")
                    .map((key) => [key, item[key]]),
                ),
              );
              // Old derived copies merely repeat the folded title and already-known fields.
              if (
                text === row.text &&
                !Object.entries(recovered).some(
                  ([key, value]) =>
                    key !== "schemaVersion" &&
                    hasValue(value) &&
                    JSON.stringify(value) !== JSON.stringify(normalized[key]),
                )
              )
                return [];
              return [{ text, data: recovered, libraryId: item.libraryId }];
            } catch {
              // Invalid saved items cannot supply recovery, but do not poison the row.
              return [];
            }
          });
        const explicit = candidates.filter((item) => item.libraryId === row.id);
        const preferred = explicit.length ? explicit : candidates;
        const unique = new Map(
          preferred.map(({ text, data }) => [JSON.stringify({ text, data }), { text, data }]),
        );
        let text = row.text;
        let next = normalized;
        if (unique.size === 1) {
          const source = [...unique.values()][0];
          const conflict = Object.keys(source.data).some(
            (key) => key !== "schemaVersion" && conflicts(normalized[key], source.data[key]),
          );
          if (!conflict) {
            text = source.text;
            next = { ...known, ...source.data };
          }
        }
        const json = JSON.stringify(next);
        if (text !== row.text || json !== row.data)
          update.run(text, json, row.id, row.tenant_id, row.user_id);
      } catch (error) {
        const validationError = error as ZodError | null;
        logger.warn("Structured library migration skipped invalid row", {
          libraryItemId: row.id,
          kind: row.kind,
          error:
            validationError?.name === "ZodError" && Array.isArray(validationError.issues)
              ? {
                  name: validationError.name,
                  issues: validationError.issues.map(({ code, path, message }) => ({
                    code,
                    path,
                    message,
                  })),
                }
              : error,
        });
      }
    }
    sqlite.prepare("INSERT INTO app_data_migrations(id) VALUES (?)").run(migrationId);
  })();
}
