import { logger } from "@infra/logger";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { backfillStructuredLibrary } from "./structured-library-backfill";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE experience_bullets(id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, kind TEXT, text TEXT, data TEXT, updated_at TEXT DEFAULT 'original');
    CREATE TABLE job_resumes(tenant_id TEXT, user_id TEXT, document TEXT);
    CREATE TABLE design_resume_documents(tenant_id TEXT, user_id TEXT, resume_json TEXT, source_mode TEXT);`);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
function row(
  id: string,
  tenant = "a",
  user: string | null = "one",
  data = '{"date":"2024","legacy":"keep"}',
) {
  db.prepare(
    "INSERT INTO experience_bullets(id,tenant_id,user_id,kind,text,data) VALUES (?,?,?,'award','Prize · Guild · First',?)",
  ).run(id, tenant, user, data);
}
function source(tenant = "a", user: string | null = "one", extra = {}) {
  const item = {
    title: "Prize",
    date: "2024",
    awarder: "Guild",
    description: "<p>First</p>",
    website: { url: "https://example.com", label: "Prize", inlineLink: true },
    ...extra,
  };
  const doc = JSON.stringify({
    basics: {},
    customSections: [],
    sections: { awards: { items: [item] } },
  });
  db.prepare("INSERT INTO job_resumes VALUES (?,?,?)").run(tenant, user, doc);
  return doc;
}
const get = (id: string) =>
  db.prepare("SELECT * FROM experience_bullets WHERE id = ?").get(id) as {
    text: string;
    data: string;
    updated_at: string;
  };
it("marks fresh databases and repeats without touching later rows", () => {
  backfillStructuredLibrary(db);
  row("later");
  backfillStructuredLibrary(db);
  expect(JSON.parse(get("later").data)).not.toHaveProperty("schemaVersion");
  expect(db.prepare("SELECT count(*) AS n FROM app_data_migrations").get()).toEqual({ n: 1 });
});
it("recovers only in the same tenant and user, preserves provenance and never changes resumes", () => {
  row("a1");
  row("a2", "a", "two");
  row("b1", "b");
  row("null", "a", null);
  const original = source();
  backfillStructuredLibrary(db);
  expect(get("a1").text).toBe("Prize");
  expect(JSON.parse(get("a1").data)).toMatchObject({
    schemaVersion: 2,
    legacy: "keep",
    awarder: "Guild",
    description: "<p>First</p>",
    website: { label: "Prize", inlineLink: true },
  });
  for (const id of ["a2", "b1", "null"]) expect(get(id).text).toBe("Prize · Guild · First");
  expect(get("a1").updated_at).toBe("original");
  expect(db.prepare("SELECT document FROM job_resumes").get()).toEqual({
    document: original,
  });
  const once = get("a1");
  backfillStructuredLibrary(db);
  expect(get("a1")).toEqual(once);
});
it("keeps the whole title on ambiguity and prefers explicit links", () => {
  row("ambiguous");
  source();
  source("a", "one", { website: { url: "other", label: "" } });
  row("explicit");
  source("a", "one", { libraryId: "explicit" });
  backfillStructuredLibrary(db);
  expect(get("ambiguous").text).toBe("Prize · Guild · First");
  expect(get("explicit").text).toBe("Prize");
});
it("does not split separators or overwrite nonempty structured fields", () => {
  row(
    "literal",
    "a",
    "one",
    '{"date":"2024","awarder":"Canonical","description":"<p>Canonical</p>"}',
  );
  source();
  backfillStructuredLibrary(db);
  expect(JSON.parse(get("literal").data)).toMatchObject({
    awarder: "Canonical",
    description: "<p>Canonical</p>",
  });
  expect(get("literal").text).toBe("Prize · Guild · First");
});
it.each([
  "{broken",
  "[]",
  '"scalar"',
  "null",
  '{"date":2024}',
  '{"website":{"url":"x","label":"","icon":"y"}}',
])("preserves malformed data and commits the marker: %s", (malformed) => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  row("valid");
  row("bad", "a", "one", malformed);
  const before = get("bad");
  expect(() => backfillStructuredLibrary(db)).not.toThrow();
  expect(get("bad")).toEqual(before);
  expect(JSON.parse(get("valid").data)).toHaveProperty("schemaVersion", 2);
  expect(warn).toHaveBeenCalledWith(
    "Structured library migration skipped invalid row",
    expect.objectContaining({
      libraryItemId: "bad",
      kind: "award",
      error: expect.anything(),
    }),
  );
  if (malformed === '{"date":2024}') {
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        error: {
          name: "ZodError",
          issues: [
            expect.objectContaining({
              path: ["date"],
              code: "invalid_type",
              message: expect.any(String),
            }),
          ],
        },
      }),
    );
  }
  expect(db.prepare("SELECT count(*) AS n FROM app_data_migrations").get()).toEqual({ n: 1 });
});
it("ignores malformed saved documents and source items while completing the migration", () => {
  row("recoverable");
  db.prepare("INSERT INTO job_resumes VALUES ('a','one',?)").run("{broken");
  source("a", "one", { website: { url: "x", label: "", icon: "invalid" } });
  source();
  expect(() => backfillStructuredLibrary(db)).not.toThrow();
  expect(get("recoverable").text).toBe("Prize");
  expect(db.prepare("SELECT count(*) AS n FROM app_data_migrations").get()).toEqual({ n: 1 });
});
it("falls back when the only matching source has invalid structured fields", () => {
  row("fallback");
  source("a", "one", { website: { url: "x", label: "", icon: "invalid" } });
  expect(() => backfillStructuredLibrary(db)).not.toThrow();
  expect(get("fallback").text).toBe("Prize · Guild · First");
  expect(JSON.parse(get("fallback").data)).toHaveProperty("schemaVersion", 2);
});
it("drops old derived linked copies before selecting informative recovery sources", () => {
  row("prize");
  db.prepare("UPDATE experience_bullets SET text = 'Prize · Guild' WHERE id = 'prize'").run();
  source("a", "one", {
    title: "Prize",
    awarder: "Guild",
    description: "",
    libraryId: "prize",
    website: { url: "", label: "" },
  });
  source("a", "one", {
    title: "Prize · Guild",
    awarder: "",
    description: "",
    libraryId: "prize",
    website: { url: "", label: "" },
  });
  backfillStructuredLibrary(db);
  expect(get("prize").text).toBe("Prize");
  expect(JSON.parse(get("prize").data)).toMatchObject({ awarder: "Guild" });
});
it("loads saved sources only once for rows sharing a tenant/user scope", () => {
  row("one");
  row("two");
  row("other", "a", "two");
  source();
  const original = db.prepare.bind(db);
  const prepare = vi.spyOn(db, "prepare");
  const load = vi.fn();
  prepare.mockImplementation((sql: string) => {
    const statement = original(sql);
    if (sql.startsWith("SELECT document AS document")) {
      const all = statement.all.bind(statement);
      vi.spyOn(statement, "all").mockImplementation((...params: unknown[]) => {
        load(...params);
        return all(...params);
      });
    }
    return statement;
  });
  backfillStructuredLibrary(db);
  expect(load).toHaveBeenCalledTimes(2);
});
