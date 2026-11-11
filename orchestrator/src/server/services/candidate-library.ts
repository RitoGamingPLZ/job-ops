import { randomUUID } from "node:crypto";
import { badRequest, notFound } from "@infra/errors";
import { htmlToPlainText, splitDescription } from "@shared/resume-bullets";
import {
  applyLibraryUpdate,
  isOnResume,
  removeFromResume,
  stampLibraryRefs,
} from "@shared/resume-links";
import type {
  ExperienceBullet,
  ExperienceBulletInput,
  LibraryItemUsage,
  LibrarySyncResult,
  ReactiveResumeV5Document,
} from "@shared/types";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { normalizeBulletText } from "../repositories/experience-bullets";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const table = schema.experienceBullets;
function library(): ExperienceBullet[] {
  return db
    .select()
    .from(table)
    .where(privateDataScopeFilter(table))
    .orderBy(asc(table.position), asc(table.id))
    .all()
    .map(({ tenantId: _t, userId: _u, ...item }) => item);
}
function resumes() {
  return db
    .select({ resume: schema.jobResumes, status: schema.jobs.status })
    .from(schema.jobResumes)
    .innerJoin(
      schema.jobs,
      and(
        eq(schema.jobs.id, schema.jobResumes.jobId),
        privateDataScopeFilter(schema.jobs),
      ),
    )
    .where(privateDataScopeFilter(schema.jobResumes))
    .all();
}
const frozen = (status: string) =>
  status === "applied" || status === "in_progress";
function save(
  row: typeof schema.jobResumes.$inferSelect,
  document: ReactiveResumeV5Document,
) {
  if (document === row.document) return;
  db.update(schema.jobResumes)
    .set({
      document,
      revision: row.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        privateDataScopeFilter(schema.jobResumes),
        eq(schema.jobResumes.jobId, row.jobId),
        eq(schema.jobResumes.revision, row.revision),
      ),
    )
    .run();
}
function validate(
  input: ExperienceBulletInput,
  all: ExperienceBullet[],
  id?: string,
) {
  const kind = input.kind ?? "bullet";
  const parentKind =
    kind === "bullet" ? "role" : kind === "project_point" ? "project" : null;
  if (input.parentId) {
    const parent = all.find((item) => item.id === input.parentId);
    if (!parentKind || parent?.kind !== parentKind || parent.id === id)
      throw badRequest("Invalid library parent");
  } else if (kind === "project_point")
    throw badRequest("Project point requires a project parent");
  if (
    id &&
    all.some(
      (item) =>
        item.parentId === id &&
        (item.kind === "bullet" ? kind !== "role" : kind !== "project"),
    )
  )
    throw badRequest("Item kind is incompatible with its children");
}
function insert(input: ExperienceBulletInput, all: ExperienceBullet[]) {
  const parent = all.find((item) => item.id === input.parentId);
  const period = String(parent?.data?.period ?? "").split(
    /\s+[–—−-]\s+|\s*[–—−]\s*/,
  );
  const { tenantId, userId } = getPrivateDataScope();
  const {
    tenantId: _t,
    userId: _u,
    ...item
  } = db
    .insert(table)
    .values({
      ...input,
      tenantId,
      userId,
      id: randomUUID(),
      company: parent ? String(parent.data?.company ?? "") : input.company,
      role: parent?.text ?? input.role,
      startDate: parent ? period[0] || null : input.startDate,
      endDate: parent ? period.slice(1).join(" – ") || null : input.endDate,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return item;
}
export function createLibraryItem(input: ExperienceBulletInput) {
  return db.transaction(() => {
    const all = library();
    validate(input, all);
    return insert(input, all);
  });
}
export function updateLibraryItem(
  id: string,
  input: Partial<ExperienceBulletInput>,
  skipJobId?: string,
) {
  return db.transaction(() => {
    const all = library();
    const before = all.find((item) => item.id === id);
    if (!before) throw notFound("Bullet not found");
    validate({ ...before, ...input }, all, id);
    const {
      tenantId: _t,
      userId: _u,
      ...after
    } = db
      .update(table)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(and(privateDataScopeFilter(table), eq(table.id, id)))
      .returning()
      .get();
    if (after.kind === "role") {
      const period = String(after.data?.period ?? "").split(
        /\s+[–—−-]\s+|\s*[–—−]\s*/,
      );
      db.update(table)
        .set({
          company: String(after.data?.company ?? ""),
          role: after.text,
          startDate: period[0] || null,
          endDate: period.slice(1).join(" – ") || null,
        })
        .where(and(privateDataScopeFilter(table), eq(table.parentId, id)))
        .run();
    }
    for (const { resume, status } of resumes())
      if (!frozen(status) && resume.jobId !== skipJobId)
        save(resume, applyLibraryUpdate(resume.document, before, after));
    return after;
  });
}
function relatedIds(id: string, all: ExperienceBullet[]) {
  return new Set([
    id,
    ...all.filter((item) => item.parentId === id).map((item) => item.id),
  ]);
}
export function libraryItemUsage(id: string): LibraryItemUsage {
  const all = library();
  if (!all.some((item) => item.id === id))
    throw notFound("Library item not found");
  const ids = relatedIds(id, all);
  const result: LibraryItemUsage = { jobIds: [], frozenJobIds: [] };
  for (const { resume, status } of resumes())
    if ([...ids].some((ref) => isOnResume(resume.document, ref)))
      result[frozen(status) ? "frozenJobIds" : "jobIds"].push(resume.jobId);
  return result;
}
/** Frozen resumes retain every field and line; only references are detached. */
function stripRefs(document: ReactiveResumeV5Document, ids: Set<string>) {
  const doc = structuredClone(document);
  let changed = false;
  for (const section of Object.values(doc.sections)) {
    if (
      !section ||
      typeof section !== "object" ||
      !("items" in section) ||
      !Array.isArray(section.items)
    )
      continue;
    for (const item of section.items as Record<string, unknown>[]) {
      if (typeof item.libraryId === "string" && ids.has(item.libraryId)) {
        delete item.libraryId;
        changed = true;
      }
      if (Array.isArray(item.bulletRefs))
        item.bulletRefs = item.bulletRefs.map((ref) => {
          if (ids.has(ref)) {
            changed = true;
            return null;
          }
          return ref;
        });
    }
  }
  return changed ? doc : document;
}
export function deleteLibraryItem(id: string, skipJobId?: string) {
  return db.transaction(() => {
    const all = library();
    if (!all.some((item) => item.id === id)) throw notFound("Bullet not found");
    const ids = relatedIds(id, all);
    for (const { resume, status } of resumes()) {
      if (!frozen(status) && resume.jobId === skipJobId) continue;
      let document = resume.document;
      if (frozen(status)) document = stripRefs(document, ids);
      else for (const ref of ids) document = removeFromResume(document, ref);
      save(resume, document);
    }
    for (const ref of ids)
      db.delete(table)
        .where(and(privateDataScopeFilter(table), eq(table.id, ref)))
        .run();
  });
}
function normal(value: unknown): string {
  if (typeof value === "string") return normalizeBulletText(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(normal));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normal(v)]),
    );
  return String(value ?? "");
}
function key(input: ExperienceBulletInput) {
  // A role is identified by employer/title/dates, even when old duty rows
  // lack its location or website. Skill keywords are merged by label.
  const data = input.data ?? {};
  const identity =
    input.kind === "role"
      ? [data.company, data.period]
      : input.kind === "skill"
        ? null
        : input.kind === "project"
          ? [data.period]
          : input.kind === "education"
            ? [data.school, data.period]
            : input.kind === "award"
              ? [data.date]
              : input.kind === "certification"
                ? [data.issuer, data.date]
                : null;
  return JSON.stringify([
    input.kind,
    normal(input.text),
    input.parentId ?? null,
    normal(identity),
  ]);
}
const plain = (value: unknown) =>
  htmlToPlainText(typeof value === "string" ? value : "")
    .replace(/\s+/g, " ")
    .trim();
const fold = (...parts: unknown[]) =>
  parts.map(plain).filter(Boolean).join(" · ");
export function syncCandidateLibrary(
  base: ReactiveResumeV5Document,
): LibrarySyncResult {
  return db.transaction(() => {
    const all = library();
    const result: LibrarySyncResult = { created: 0, skipped: 0, linked: 0 };
    function add(input: ExperienceBulletInput): ExperienceBullet {
      const existing = all.find((item) => key(item) === key(input));
      if (existing) {
        result.skipped++;
        // Legacy duties have no location/website. Enrich their generated role
        // from resume facts, while preserving facts already in the library.
        if (input.kind === "role") {
          const data = { ...existing.data };
          const hasValue = (value: unknown) =>
            typeof value === "string"
              ? Boolean(value.trim())
              : Boolean(
                  value &&
                    typeof value === "object" &&
                    "url" in value &&
                    value.url,
                );
          let changed = false;
          for (const field of ["location", "website"]) {
            if (!hasValue(data[field]) && hasValue(input.data?.[field])) {
              data[field] = input.data?.[field];
              changed = true;
            }
          }
          if (changed) {
            existing.data = data;
            db.update(table)
              .set({ data, updatedAt: new Date().toISOString() })
              .where(
                and(privateDataScopeFilter(table), eq(table.id, existing.id)),
              )
              .run();
          }
        }
        if (input.kind === "skill") {
          const keywords = [
            ...(Array.isArray(existing.data?.keywords)
              ? (existing.data.keywords as string[])
              : []),
          ];
          const seen = new Set(keywords.map(normal));
          for (const word of (input.data?.keywords ?? []) as string[])
            if (!seen.has(normal(word))) {
              keywords.push(word);
              seen.add(normal(word));
            }
          existing.data = { ...existing.data, keywords };
          db.update(table)
            .set({ data: existing.data })
            .where(
              and(privateDataScopeFilter(table), eq(table.id, existing.id)),
            )
            .run();
        }
        return existing;
      }
      const item = insert(
        {
          ...input,
          position: all.filter(
            (item) =>
              item.kind === input.kind &&
              item.parentId === (input.parentId ?? null),
          ).length,
        },
        all,
      );
      all.push(item);
      result.created++;
      return item;
    }
    for (const item of all.slice())
      if (item.kind === "bullet" && !item.parentId) {
        const period = [item.startDate, item.endDate]
          .filter(Boolean)
          .join(" – ");
        const role = add({
          kind: "role",
          text: item.role ?? "",
          data: {
            company: item.company || "",
            location: "",
            website: { url: "", label: "" },
            period,
          },
          source: "resume",
        });
        item.parentId = role.id;
        db.update(table)
          .set({ parentId: role.id })
          .where(and(privateDataScopeFilter(table), eq(table.id, item.id)))
          .run();
      }
    const saved = resumes();
    for (const { document, source } of [
      { document: base, source: "resume" as const },
      ...saved.map(({ resume }) => ({
        document: resume.document,
        source: "job_resume" as const,
      })),
    ]) {
      for (const item of document.sections.experience.items) {
        const roles = [
          ...(!item.roles?.length ||
          item.position ||
          splitDescription(item.description).bullets.length
            ? [item]
            : []),
          ...(item.roles ?? []),
        ];
        for (const role of roles) {
          const parent = add({
            kind: "role",
            text: role.position,
            data: {
              company: item.company,
              location: item.location,
              website: item.website,
              period: role.period,
            },
            source,
            sourceExperienceId: role.id,
          });
          for (const text of splitDescription(role.description).bullets)
            add({
              kind: "bullet",
              text,
              parentId: parent.id,
              source,
              sourceExperienceId: role.id,
            });
        }
      }
      for (const item of document.sections.projects.items) {
        const parent = add({
          kind: "project",
          text: item.name,
          data: { period: item.period, website: item.website },
          source,
        });
        for (const text of splitDescription(item.description).bullets)
          add({ kind: "project_point", text, parentId: parent.id, source });
      }
      for (const item of document.sections.skills.items)
        add({
          kind: "skill",
          text: item.name,
          data: { keywords: item.keywords },
          source,
        });
      for (const item of document.sections.education.items)
        add({
          kind: "education",
          text: fold(item.degree, item.area, item.grade, item.description),
          data: {
            school: item.school,
            location: item.location,
            period: item.period,
          },
          source,
        });
      for (const item of document.sections.awards.items)
        add({
          kind: "award",
          text: fold(item.title, item.awarder, item.description),
          data: { date: item.date },
          source,
        });
      for (const item of document.sections.certifications.items)
        add({
          kind: "certification",
          text: fold(item.title, item.description),
          data: { issuer: item.issuer, website: item.website, date: item.date },
          source,
        });
    }
    for (const { resume } of saved) {
      const stamped = stampLibraryRefs(resume.document, all);
      result.linked += stamped.linked;
      save(resume, stamped.doc);
    }
    return result;
  });
}
