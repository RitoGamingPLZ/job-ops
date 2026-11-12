import {
  foldedLibraryText,
  parseLibraryData,
} from "@shared/candidate-library-schema";
import type { CandidateItemKind } from "@shared/types/cowork";
import type Database from "better-sqlite3";

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
function identity(
  kind: CandidateItemKind,
  data: Record<string, unknown>,
): string {
  return JSON.stringify(
    (kind === "education"
      ? [data.school, data.period]
      : kind === "award"
        ? [data.date]
        : [data.issuer, data.date]
    ).map((value) => string(value).trim().replace(/\s+/g, " ")),
  );
}
function sourceItems(raw: string, section: string): Record<string, unknown>[] {
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
      return [];
    const items = doc.sections[section]?.items;
    return Array.isArray(items)
      ? items.filter((item) => item && typeof item === "object")
      : [];
  } catch {
    return [];
  }
}
/** Startup-only, atomic, scoped data migration. Saved resume documents are read-only. */
export function backfillStructuredLibrary(sqlite: Database.Database): void {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS app_data_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  sqlite.transaction(() => {
    if (
      sqlite
        .prepare("SELECT 1 FROM app_data_migrations WHERE id = ?")
        .get(migrationId)
    )
      return;
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
    for (const row of rows) {
      // Invalid JSON or scalar/array data aborts the transaction, retaining the original bytes.
      let data: unknown;
      try {
        data = row.data === null ? {} : JSON.parse(row.data);
      } catch {
        throw new Error("Invalid structured library migration data");
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Invalid structured library migration data");
      const known = data as Record<string, unknown>;
      if (known.schemaVersion === 2) {
        parseLibraryData(row.kind, known);
        continue;
      }
      const candidates = (
        sources.all(row.tenant_id, row.user_id, row.tenant_id, row.user_id) as {
          document: string;
        }[]
      )
        .flatMap((source) => sourceItems(source.document, sections[row.kind]))
        .filter((item) => {
          const title = string(
            row.kind === "education" ? item.degree : item.title,
          );
          return (
            (!item.libraryId || item.libraryId === row.id) &&
            identity(row.kind, item) === identity(row.kind, known) &&
            foldedLibraryText(row.kind, title, item) === row.text
          );
        });
      const explicit = candidates.filter((item) => item.libraryId === row.id);
      const preferred = explicit.length ? explicit : candidates;
      const recovered = preferred.map((item) => ({
        text: string(row.kind === "education" ? item.degree : item.title),
        data: parseLibraryData(
          row.kind,
          Object.fromEntries(
            Object.keys(parseLibraryData(row.kind, {})).map((key) => [
              key,
              key === "schemaVersion" ? 2 : item[key],
            ]),
          ),
        ),
      }));
      const unique = new Map(
        recovered.map((item) => [JSON.stringify(item), item]),
      );
      let text = row.text;
      let next = parseLibraryData(row.kind, known);
      if (unique.size === 1) {
        const source = [...unique.values()][0];
        text = source.text;
        // Canonical nonempty fields win over source resume edits.
        next = parseLibraryData(row.kind, {
          ...source.data,
          ...known,
          schemaVersion: 2,
        });
        for (const [key, value] of Object.entries(source.data)) {
          if (key === "website") {
            const canonical = next.website as Record<string, unknown>;
            next.website = {
              ...(value as Record<string, unknown>),
              ...Object.fromEntries(
                Object.entries(canonical).filter(
                  ([, field]) => field !== "" && field !== undefined,
                ),
              ),
            };
          } else if (
            known[key] === undefined ||
            known[key] === "" ||
            known[key] === null
          )
            next[key] = value;
        }
      }
      const json = JSON.stringify(next);
      if (text !== row.text || json !== row.data)
        update.run(text, json, row.id, row.tenant_id, row.user_id);
    }
    sqlite
      .prepare("INSERT INTO app_data_migrations(id) VALUES (?)")
      .run(migrationId);
  })();
}
