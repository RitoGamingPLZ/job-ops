import { randomUUID } from "node:crypto";
import { badRequest, notFound } from "@infra/errors";
import { foldedLibraryText, parseLibraryData } from "@shared/candidate-library-schema";
import { splitDescription } from "@shared/resume-bullets";
import {
  applyLibraryUpdate,
  isContactOnResume,
  isOnResume,
  removeFromResume,
  setContactOnResume,
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
import { getPrivateDataScope, privateDataScopeFilter } from "../tenancy/private-scope";

const table = schema.experienceBullets;
function library(): ExperienceBullet[] {
  return db
    .select()
    .from(table)
    .where(privateDataScopeFilter(table))
    .orderBy(asc(table.position), asc(table.createdAt), asc(table.id))
    .all()
    .map(({ tenantId: _t, userId: _u, ...item }) => item);
}
function resumes() {
  return db
    .select({ resume: schema.jobResumes, status: schema.jobs.status })
    .from(schema.jobResumes)
    .innerJoin(
      schema.jobs,
      and(eq(schema.jobs.id, schema.jobResumes.jobId), privateDataScopeFilter(schema.jobs)),
    )
    .where(privateDataScopeFilter(schema.jobResumes))
    .all();
}
const frozen = (status: string) => status === "applied" || status === "in_progress";
function save(row: typeof schema.jobResumes.$inferSelect, document: ReactiveResumeV5Document) {
  if (document === row.document) return false;
  const saved = db
    .update(schema.jobResumes)
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
  return saved.changes > 0;
}
function validate(input: ExperienceBulletInput, all: ExperienceBullet[], id?: string) {
  const kind = input.kind ?? "bullet";
  if (kind === "contact") {
    const data = input.data;
    if (
      !data ||
      !["email", "phone", "location", "website", "profile"].includes(String(data.type)) ||
      typeof data.value !== "string" ||
      !data.value.trim() ||
      ["label", "network", "username", "url"].some(
        (field) => data[field] !== undefined && typeof data[field] !== "string",
      )
    )
      throw badRequest("Invalid contact data");
  }
  const parentKind = kind === "bullet" ? "role" : kind === "project_point" ? "project" : null;
  if (input.parentId) {
    const parent = all.find((item) => item.id === input.parentId);
    if (!parentKind || parent?.kind !== parentKind || parent.id === id)
      throw badRequest("Invalid library parent");
  } else if (kind === "project_point") throw badRequest("Project point requires a project parent");
  if (
    id &&
    all.some(
      (item) =>
        item.parentId === id && (item.kind === "bullet" ? kind !== "role" : kind !== "project"),
    )
  )
    throw badRequest("Item kind is incompatible with its children");
}
function parentFields(parent: ExperienceBullet | undefined) {
  const period = String(parent?.data?.period ?? "").split(
    /\s+[–—−-]\s+|\s*[–—−]\s*|(?<=\d{4})\s*-\s*(?=[A-Za-z]|\d{4}(?:$|\D))/,
  );
  return {
    company: parent ? String(parent.data?.company ?? "") : null,
    role: parent?.text ?? null,
    startDate: parent ? period[0] || null : null,
    endDate: parent ? period.slice(1).join(" – ") || null : null,
  };
}
function normalizeContact(input: ExperienceBulletInput): ExperienceBulletInput {
  if (input.kind !== "contact") return input;
  const data = Object.fromEntries(
    Object.entries(input.data ?? {}).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  );
  return { ...input, text: String(data.value ?? ""), data };
}
function insert(input: ExperienceBulletInput, all: ExperienceBullet[]) {
  const parent = all.find((item) => item.id === input.parentId);
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
      ...(input.kind === "bullet" || input.kind === undefined
        ? parent
          ? parentFields(parent)
          : {
              company: input.company,
              role: input.role,
              startDate: input.startDate,
              endDate: input.endDate,
            }
        : { company: null, role: null, startDate: null, endDate: null }),
      position:
        input.position ??
        all.filter(
          (item) =>
            item.kind === (input.kind ?? "bullet") && item.parentId === (input.parentId ?? null),
        ).length,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return item;
}
export function createLibraryItem(input: ExperienceBulletInput) {
  return db.transaction(() => {
    const all = library();
    input = normalizeStructured(input);
    validate(input, all);
    const normalized = normalizeContact({
      ...input,
      kind: input.kind ?? "bullet",
    });
    return all.find((item) => key(item) === key(normalized)) ?? insert(normalized, all);
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
    if (input.kind && input.kind !== before.kind)
      throw badRequest("Library item kind cannot change");
    if (input.data !== undefined) input = { ...input, data: { ...before.data, ...input.data } };
    input = {
      ...input,
      data: normalizeStructured({ ...before, ...input }).data,
    };
    validate({ ...before, ...input }, all, id);
    if (before.kind === "contact") input = normalizeContact({ ...before, ...input });
    if (before.kind !== "bullet") {
      input = {
        ...input,
        company: null,
        role: null,
        startDate: null,
        endDate: null,
      };
    } else if (input.parentId !== undefined) {
      input = {
        ...input,
        ...parentFields(all.find((item) => item.id === input.parentId)),
      };
    }
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
      db.update(table)
        .set(parentFields(after))
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
  return new Set([id, ...all.filter((item) => item.parentId === id).map((item) => item.id)]);
}
export function libraryItemUsage(id: string): LibraryItemUsage {
  const all = library();
  if (!all.some((item) => item.id === id)) throw notFound("Library item not found");
  const ids = relatedIds(id, all);
  const result: LibraryItemUsage = { jobIds: [], frozenJobIds: [] };
  for (const { resume, status } of resumes())
    if (
      [...ids].some((ref) => {
        const item = all.find((item) => item.id === ref);
        return item?.kind === "contact"
          ? isContactOnResume(resume.document, item)
          : isOnResume(resume.document, ref);
      })
    )
      result[frozen(status) ? "frozenJobIds" : "jobIds"].push(resume.jobId);
  return result;
}
export function deleteLibraryItem(id: string, skipJobId?: string) {
  return db.transaction(() => {
    const all = library();
    if (!all.some((item) => item.id === id)) throw notFound("Bullet not found");
    const ids = relatedIds(id, all);
    for (const { resume, status } of resumes()) {
      if (frozen(status) || resume.jobId === skipJobId) continue;
      let document = resume.document;
      for (const ref of ids) {
        const item = all.find((item) => item.id === ref);
        document =
          item?.kind === "contact"
            ? setContactOnResume(document, item, false)
            : removeFromResume(document, ref);
      }
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
function normalPeriod(value: unknown) {
  return String(value ?? "").replace(/\s*[\p{Dash_Punctuation}−]\s*/gu, " – ");
}
function key(input: ExperienceBulletInput) {
  // A role is identified by employer/title/dates, even when old duty rows
  // lack its location or website. Skill keywords are merged by label.
  const data = input.data ?? {};
  if (input.kind === "contact") return JSON.stringify(["contact", data.type, normal(data.value)]);
  const identity =
    input.kind === "role"
      ? [data.company, normalPeriod(data.period)]
      : input.kind === "skill"
        ? null
        : input.kind === "project"
          ? [normalPeriod(data.period)]
          : input.kind === "education"
            ? [data.school, normalPeriod(data.period)]
            : input.kind === "award"
              ? [data.date]
              : input.kind === "certification"
                ? [data.issuer, data.date]
                : input.kind === "bullet" && !input.parentId
                  ? [input.company, input.role, input.startDate, input.endDate]
                  : null;
  return JSON.stringify([
    input.kind,
    normal(
      ["education", "award", "certification"].includes(input.kind ?? "")
        ? foldedLibraryText(input.kind ?? "bullet", input.text, input.data ?? null)
        : input.text,
    ),
    input.parentId ?? null,
    normal(identity),
  ]);
}
function normalizeStructured(input: ExperienceBulletInput): ExperienceBulletInput {
  if (!["education", "award", "certification"].includes(input.kind ?? "")) return input;
  try {
    return {
      ...input,
      data: parseLibraryData(input.kind ?? "bullet", input.data),
    };
  } catch {
    throw badRequest("Invalid structured library data");
  }
}
const FIRST_BUILD_KEY = "candidateLibraryFirstBuild";
const FROZEN_IMPORT_KEY = "candidateLibraryFrozenResumesImported";
function hasImportMarker(key: string): boolean {
  return !!db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(and(privateDataScopeFilter(schema.settings), eq(schema.settings.key, key)))
    .get();
}
export function candidateLibraryNeedsFirstBuild(): boolean {
  return !hasImportMarker(FIRST_BUILD_KEY);
}
export function syncCandidateLibrary(
  base?: ReactiveResumeV5Document,
  revisions?: Map<string, { from: number; to: number }>,
): LibrarySyncResult {
  return db.transaction(() => {
    const firstBuild = candidateLibraryNeedsFirstBuild();
    // Older completed builds already imported frozen resumes. Keep that
    // guarantee while allowing a missing base resume to be imported later.
    const importFrozen = firstBuild && !hasImportMarker(FROZEN_IMPORT_KEY);
    const all = library();
    const result: LibrarySyncResult = { created: 0, skipped: 0, linked: 0 };
    function add(input: ExperienceBulletInput): ExperienceBullet {
      input = normalizeStructured(input);
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
              : Boolean(value && typeof value === "object" && "url" in value && value.url);
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
              .where(and(privateDataScopeFilter(table), eq(table.id, existing.id)))
              .run();
          }
        }
        if (input.kind === "skill") {
          const keywords = [
            ...(Array.isArray(existing.data?.keywords) ? (existing.data.keywords as string[]) : []),
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
            .where(and(privateDataScopeFilter(table), eq(table.id, existing.id)))
            .run();
        }
        return existing;
      }
      const item = insert(
        {
          ...normalizeContact(input),
          position: all.filter(
            (item) => item.kind === input.kind && item.parentId === (input.parentId ?? null),
          ).length,
        },
        all,
      );
      all.push(item);
      result.created++;
      return item;
    }
    if (base) {
      for (const type of ["email", "phone", "location", "website"] as const) {
        const value = type === "website" ? base.basics.website.url : base.basics[type];
        if (value.trim())
          add({
            kind: "contact",
            text: value,
            source: "resume",
            data: {
              type,
              value,
              ...(type === "website" ? { label: base.basics.website.label } : {}),
            },
          });
      }
      for (const profile of base.sections.profiles.items) {
        const value = profile.website.url || profile.username;
        if (value.trim())
          add({
            kind: "contact",
            text: value,
            source: "resume",
            data: {
              type: "profile",
              value,
              network: profile.network,
              username: profile.username,
              url: profile.website.url,
              label: profile.website.label,
            },
          });
      }
    }
    const baseParents = new Map<string, ExperienceBullet>();
    if (firstBuild && base) {
      for (const item of base.sections.experience.items) {
        for (const role of [item, ...(item.roles ?? [])]) {
          if (
            role === item &&
            item.roles?.length &&
            !item.position &&
            !splitDescription(item.description).bullets.length
          )
            continue;
          baseParents.set(
            role.id,
            add({
              kind: "role",
              text: role.position,
              data: {
                company: item.company,
                location: item.location,
                website: item.website,
                period: role.period,
              },
              source: "resume",
              sourceExperienceId: role.id,
            }),
          );
        }
      }
    }
    for (const item of all.slice())
      if (item.kind === "bullet" && !item.parentId) {
        const role =
          (item.sourceExperienceId ? baseParents.get(item.sourceExperienceId) : undefined) ??
          add({
            kind: "role",
            text: item.role ?? "",
            data: {
              company: item.company || "",
              location: "",
              website: { url: "", label: "" },
              period: [item.startDate, item.endDate].filter(Boolean).join(" – "),
            },
            source: "resume",
          });
        item.parentId = role.id;
        item.position = all.filter(
          (child) => child.id !== item.id && child.kind === "bullet" && child.parentId === role.id,
        ).length;
        Object.assign(item, parentFields(role));
        db.update(table)
          .set({
            parentId: role.id,
            position: item.position,
            ...parentFields(role),
          })
          .where(and(privateDataScopeFilter(table), eq(table.id, item.id)))
          .run();
      }
    const saved = resumes();
    const documents = [
      ...(firstBuild && base ? [{ document: base, source: "resume" as const }] : []),
      ...saved
        .filter(({ status }) => importFrozen || !frozen(status))
        .map(({ resume }) => ({
          document: resume.document,
          source: "job_resume" as const,
        })),
    ];
    // Any explicit ref, including a dangling ref left by deletion, prevents
    // importing that same fact again. Still collect unlinked children.
    function parentFor(item: Record<string, unknown>, input: ExperienceBulletInput) {
      if (typeof item.libraryId === "string" && item.libraryId)
        return all.find((row) => row.id === item.libraryId);
      return add(input);
    }
    for (const { document, source } of documents) {
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
          const parent =
            (source === "resume" ? baseParents.get(role.id) : undefined) ??
            parentFor(role, {
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
          if (!parent) continue;
          const refs =
            "bulletRefs" in role && Array.isArray(role.bulletRefs) ? role.bulletRefs : [];
          for (const [index, text] of splitDescription(role.description).bullets.entries()) {
            if (refs[index]) continue;
            add({
              kind: "bullet",
              text,
              parentId: parent.id,
              source,
              sourceExperienceId: role.id,
            });
          }
        }
      }
      for (const item of document.sections.projects.items) {
        const parent = parentFor(item, {
          kind: "project",
          text: item.name,
          data: { period: item.period, website: item.website },
          source,
        });
        if (!parent) continue;
        for (const [index, text] of splitDescription(item.description).bullets.entries()) {
          if (Array.isArray(item.bulletRefs) && item.bulletRefs[index]) continue;
          add({ kind: "project_point", text, parentId: parent.id, source });
        }
      }
      for (const item of document.sections.skills.items)
        if (!item.libraryId)
          add({
            kind: "skill",
            text: item.name,
            data: { keywords: item.keywords },
            source,
          });
      for (const item of document.sections.education.items)
        if (!item.libraryId)
          add({
            kind: "education",
            text: item.degree,
            data: {
              schemaVersion: 2,
              area: item.area,
              grade: item.grade,
              description: item.description,
              website: item.website,
              school: item.school,
              location: item.location,
              period: item.period,
            },
            source,
          });
      for (const item of document.sections.awards.items)
        if (!item.libraryId)
          add({
            kind: "award",
            text: item.title,
            data: {
              schemaVersion: 2,
              date: item.date,
              awarder: item.awarder,
              description: item.description,
              website: item.website,
            },
            source,
          });
      for (const item of document.sections.certifications.items)
        if (!item.libraryId)
          add({
            kind: "certification",
            text: item.title,
            data: {
              schemaVersion: 2,
              description: item.description,
              issuer: item.issuer,
              website: item.website,
              date: item.date,
            },
            source,
          });
    }
    for (const { resume, status } of saved) {
      if (frozen(status)) continue;
      const stamped = stampLibraryRefs(resume.document, all);
      result.linked += stamped.linked;
      if (save(resume, stamped.doc))
        revisions?.set(resume.jobId, {
          from: resume.revision,
          to: resume.revision + 1,
        });
    }
    const { tenantId, userId } = getPrivateDataScope();
    if (importFrozen)
      db.insert(schema.settings)
        .values({ tenantId, userId, key: FROZEN_IMPORT_KEY, value: "1" })
        .run();
    if (firstBuild && base) {
      db.insert(schema.settings)
        .values({ tenantId, userId, key: FIRST_BUILD_KEY, value: "1" })
        .run();
    }
    return result;
  });
}
