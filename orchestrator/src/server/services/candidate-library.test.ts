import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactiveResumeV5Document } from "@shared/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@shared/resume-links", async (importOriginal) => {
  const real = await importOriginal<typeof import("@shared/resume-links")>();
  return {
    ...real,
    applyLibraryUpdate: vi.fn((doc, before, after) =>
      before.kind === "contact"
        ? real.applyLibraryUpdate(doc, before, after)
        : {
            ...doc,
            summary: { ...doc.summary, content: "updated" },
          },
    ),
    removeFromResume: vi.fn((doc) => ({
      ...doc,
      summary: { ...doc.summary, content: "removed" },
    })),
    isOnResume: vi.fn((doc, id) =>
      Object.values(doc.sections).some((section: unknown) => {
        const items = (
          section as { items?: { libraryId?: string; bulletRefs?: string[] }[] }
        ).items;
        return items?.some(
          (item) => item.libraryId === id || item.bulletRefs?.includes(id),
        );
      }),
    ),
    stampLibraryRefs: vi.fn((doc) =>
      doc.basics.headline === "stamped"
        ? { doc, linked: 0 }
        : {
            doc: { ...doc, basics: { ...doc.basics, headline: "stamped" } },
            linked: 1,
          },
    ),
  };
});
let dir: string;
let api: typeof import("./candidate-library");
let database: typeof import("../db");
let run: typeof import("@infra/request-context").runWithRequestContext;
let document: ReactiveResumeV5Document;
const scope = <T>(tenantId: string, fn: () => T) =>
  run({ requestId: "library-test", tenantId }, fn);
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), "candidate-library-"));
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("JOBOPS_APP_MODE", "local");
  await import("../db/migrate");
  database = await import("../db");
  ({ runWithRequestContext: run } = await import("@infra/request-context"));
  api = await import("./candidate-library");
  const { buildDefaultReactiveResumeDocument } = await import(
    "./rxresume/document"
  );
  document = buildDefaultReactiveResumeDocument() as ReactiveResumeV5Document;
  database.db
    .insert(database.schema.tenants)
    .values([
      { id: "tenant-a", name: "A", slug: "a" },
      { id: "tenant-b", name: "B", slug: "b" },
    ])
    .run();
});
afterEach(async () => {
  database?.closeDb();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
function job(
  id: string,
  status: "ready" | "applied" | "in_progress" = "ready",
  tenantId = "tenant-a",
  doc = document,
) {
  database.db
    .insert(database.schema.jobs)
    .values({
      id,
      tenantId,
      title: id,
      employer: "Acme",
      jobUrl: `https://example.com/${id}`,
      status,
    })
    .run();
  database.db
    .insert(database.schema.jobResumes)
    .values({ jobId: id, tenantId, document: doc, revision: 3 })
    .run();
}
const rows = () => database.db.select().from(database.schema.jobResumes).all();
it("unions base and job resumes, merges keywords, folds extras and is idempotent", async () => {
  document.sections.experience.items = [
    {
      id: "exp",
      hidden: false,
      company: "Acme",
      position: "Engineer",
      period: "2020 – Present",
      location: "",
      website: { url: "", label: "" },
      description: "<ul><li>Built APIs</li><li> built   APIs </li></ul>",
      roles: [],
    },
  ];
  document.sections.skills.items = [
    {
      id: "skill",
      hidden: false,
      name: "Languages",
      icon: "",
      keywords: ["TS"],
      proficiency: "",
      level: 0,
    },
  ];
  document.sections.education.items = [
    {
      id: "edu",
      hidden: false,
      school: "School",
      degree: "BSc",
      area: "CS",
      grade: "First",
      location: "Town",
      period: "2020",
      website: { url: "", label: "" },
      description: "<p>Thesis</p><p>research</p>",
    },
  ];
  const copy = structuredClone(document);
  copy.sections.skills.items[0].keywords = ["ts", "Go"];
  copy.sections.experience.items[0].description =
    "<ul><li>Shipped tools</li></ul>";
  job("job", "ready", "tenant-a", copy);
  await scope("tenant-a", async () => {
    expect(api.syncCandidateLibrary(document)).toMatchObject({
      created: 5,
      linked: 1,
    });
    const repo = await import("../repositories/experience-bullets");
    const all = await repo.listExperienceBullets(true);
    expect(all.find((item) => item.kind === "skill")?.data).toEqual({
      keywords: ["TS", "Go"],
    });
    expect(all.find((item) => item.kind === "education")).toMatchObject({
      text: "BSc · CS · First · Thesis research",
      data: { location: "Town", school: "School" },
    });
    expect(await repo.listExperienceBullets()).toHaveLength(2);
    expect(api.syncCandidateLibrary(document)).toMatchObject({
      created: 0,
      linked: 0,
    });
  });
  expect(rows()[0]).toMatchObject({
    revision: 4,
    document: { basics: { headline: "stamped" } },
  });
});
it("attaches legacy bullets to roles and preserves their ids", async () => {
  await scope("tenant-a", async () => {
    const legacy = api.createLibraryItem({
      text: "Built",
      company: "Acme",
      role: "Engineer",
      startDate: "2020",
      endDate: "Present",
    });
    api.syncCandidateLibrary(document);
    const all = await (
      await import("../repositories/experience-bullets")
    ).listExperienceBullets(true);
    expect(all.find((item) => item.id === legacy.id)?.parentId).toBe(
      all.find((item) => item.kind === "role")?.id,
    );
    expect(api.syncCandidateLibrary(document).created).toBe(0);
  });
});
it("propagates updates except frozen, skipped and other tenant resumes", async () => {
  job("ready");
  job("skip");
  job("applied", "applied");
  job("progress", "in_progress");
  job("other", "ready", "tenant-b");
  const { applyLibraryUpdate } = await import("@shared/resume-links");
  scope("tenant-a", () => {
    const item = api.createLibraryItem({ text: "Built" });
    api.updateLibraryItem(item.id, { text: "Shipped" }, "skip");
  });
  expect(applyLibraryUpdate).toHaveBeenCalledTimes(1);
  expect(
    rows()
      .filter((row) => row.revision === 4)
      .map((row) => row.jobId),
  ).toEqual(["ready"]);
});
it("counts children in usage, deletes children, leaves frozen resumes and their refs untouched", async () => {
  const { role, child } = scope("tenant-a", () => {
    const role = api.createLibraryItem({
      kind: "role",
      text: "Engineer",
      data: { company: "Acme" },
    });
    const child = api.createLibraryItem({ text: "Built", parentId: role.id });
    return { role, child };
  });
  document.sections.experience.items = [
    {
      id: "e",
      hidden: false,
      company: "Acme",
      position: "Engineer",
      location: "",
      period: "",
      website: { url: "", label: "" },
      roles: [],
      description: "<ul><li>My rewording</li></ul>",
      libraryId: role.id,
      bulletRefs: [child.id],
    },
  ];
  job("ready");
  job("skip");
  job("frozen", "applied");
  job("other", "ready", "tenant-b");
  await scope("tenant-a", async () => {
    expect(api.libraryItemUsage(role.id)).toEqual({
      jobIds: ["ready", "skip"],
      frozenJobIds: ["frozen"],
    });
    api.deleteLibraryItem(role.id, "skip");
    expect(
      await (
        await import("../repositories/experience-bullets")
      ).listExperienceBullets(true),
    ).toEqual([]);
  });
  const frozen = rows().find((row) => row.jobId === "frozen");
  expect(frozen?.document.sections.experience.items[0]).toMatchObject({
    description: document.sections.experience.items[0].description,
    bulletRefs: [child.id],
  });
  expect(frozen?.revision).toBe(3);
  expect(frozen?.document.sections.experience.items[0].libraryId).toBe(role.id);
  expect(rows().find((row) => row.jobId === "skip")?.revision).toBe(3);
  expect(rows().find((row) => row.jobId === "other")?.revision).toBe(3);
});
it("isolates reads, mutations, parents, sync and usage across tenants", async () => {
  const item = scope("tenant-a", () =>
    api.createLibraryItem({ kind: "role", text: "Private role" }),
  );
  await scope("tenant-b", async () => {
    expect(() =>
      api.createLibraryItem({ text: "Duty", parentId: item.id }),
    ).toThrow("Invalid library parent");
    expect(() => api.updateLibraryItem(item.id, { text: "Changed" })).toThrow(
      "Bullet not found",
    );
    expect(() => api.deleteLibraryItem(item.id)).toThrow("Bullet not found");
    expect(() => api.libraryItemUsage(item.id)).toThrow(
      "Library item not found",
    );
    api.syncCandidateLibrary(document);
    expect(
      await (
        await import("../repositories/experience-bullets")
      ).listExperienceBullets(true),
    ).toEqual([]);
  });
});

it("syncs projects and points, folds awards and certificates without duplicates", async () => {
  const website = { url: "https://example.com", label: "Link" };
  document.sections.projects.items = [
    {
      id: "p",
      hidden: false,
      name: "Tool",
      period: "2024",
      website,
      description: "<ul><li>Shipped it</li></ul>",
    },
  ];
  document.sections.awards.items = [
    {
      id: "a",
      hidden: false,
      title: "Prize",
      awarder: "Guild",
      date: "2024",
      website,
      description: "<p>First place</p>",
    },
  ];
  document.sections.certifications.items = [
    {
      id: "c",
      hidden: false,
      title: "Certified",
      issuer: "Institute",
      date: "2024",
      website,
      description: "<p>Advanced</p>",
    },
  ];
  await scope("tenant-a", async () => {
    expect(api.syncCandidateLibrary(document).created).toBe(4);
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    const all = await (
      await import("../repositories/experience-bullets")
    ).listExperienceBullets(true);
    expect(all.find((item) => item.kind === "award")?.text).toBe(
      "Prize · Guild · First place",
    );
    expect(all.find((item) => item.kind === "certification")).toMatchObject({
      text: "Certified · Advanced",
      data: { issuer: "Institute", website },
    });
    const project = all.find((item) => item.kind === "project");
    expect(all.find((item) => item.kind === "project_point")?.parentId).toBe(
      project?.id,
    );
  });
});
it("rolls back a library edit when propagation fails", async () => {
  job("ready");
  const { applyLibraryUpdate } = await import("@shared/resume-links");
  vi.mocked(applyLibraryUpdate).mockImplementationOnce(() => {
    throw new Error("Propagation failed");
  });
  await scope("tenant-a", async () => {
    const item = api.createLibraryItem({ text: "Before" });
    expect(() => api.updateLibraryItem(item.id, { text: "After" })).toThrow(
      "Propagation failed",
    );
    expect(
      (
        await (
          await import("../repositories/experience-bullets")
        ).listExperienceBullets()
      )[0].text,
    ).toBe("Before");
    expect(rows()[0].revision).toBe(3);
  });
});
it("isolates library and resume state by user in hosted workspaces", async () => {
  vi.stubEnv("JOBOPS_APP_MODE", "hosted");
  vi.stubEnv("JOBOPS_HOSTED_TENANT_ID", "tenant-a");
  database.db
    .insert(database.schema.users)
    .values([
      { id: "alice", username: "alice" },
      { id: "bob", username: "bob" },
    ])
    .run();
  const asUser = <T>(userId: string, fn: () => T) =>
    run({ tenantId: "tenant-a", userId, requestId: "hosted-library" }, fn);
  const item = asUser("alice", () => {
    expect(api.candidateLibraryNeedsFirstBuild()).toBe(true);
    api.syncCandidateLibrary(document);
    expect(api.candidateLibraryNeedsFirstBuild()).toBe(false);
    return api.createLibraryItem({ kind: "role", text: "Alice role" });
  });
  await asUser("bob", async () => {
    expect(api.candidateLibraryNeedsFirstBuild()).toBe(true);
    api.syncCandidateLibrary(document);
    expect(api.candidateLibraryNeedsFirstBuild()).toBe(false);
    expect(
      await (
        await import("../repositories/experience-bullets")
      ).listExperienceBullets(true),
    ).toEqual([]);
    expect(() =>
      api.createLibraryItem({ text: "Bob duty", parentId: item.id }),
    ).toThrow("Invalid library parent");
    expect(() => api.libraryItemUsage(item.id)).toThrow(
      "Library item not found",
    );
    expect(() => api.updateLibraryItem(item.id, { text: "Changed" })).toThrow(
      "Bullet not found",
    );
    expect(() => api.deleteLibraryItem(item.id)).toThrow("Bullet not found");
  });
});
it.each([
  "2020 – Present",
  "2020 - Present",
  "2020-Present",
  "2020—Present",
  "2020‑Present",
])("dedupes legacy role identity without source ids (%s) and restores missing metadata", async (period) => {
  document.sections.experience.items = [
    {
      id: "e",
      hidden: false,
      company: "Acme",
      position: "Engineer",
      period,
      location: "Toronto",
      website: { url: "https://example.com", label: "Acme" },
      description: "<ul><li>Built</li></ul>",
      roles: [],
    },
  ];
  await scope("tenant-a", async () => {
    api.createLibraryItem({
      text: "Built",
      company: "Acme",
      role: "Engineer",
      startDate: "2020",
      endDate: "Present",
    });
    api.syncCandidateLibrary(document);
    const all = await (
      await import("../repositories/experience-bullets")
    ).listExperienceBullets(true);
    expect(all).toHaveLength(2);
    expect(all.find((item) => item.kind === "role")?.data).toMatchObject({
      location: "Toronto",
      website: document.sections.experience.items[0].website,
    });
  });
});
it("preserves blank role titles and duties alongside nested roles during sync", async () => {
  document.sections.experience.items = [
    {
      id: "e",
      hidden: false,
      company: "Acme",
      position: "",
      period: "2020",
      location: "",
      website: { url: "", label: "" },
      description: "<ul><li>Outer duty</li></ul>",
      roles: [
        {
          id: "r",
          position: "Specialist",
          period: "2021",
          description: "<ul><li>Inner duty</li></ul>",
        },
      ],
    },
  ];
  await scope("tenant-a", async () => {
    expect(api.syncCandidateLibrary(document).created).toBe(4);
    const all = await (
      await import("../repositories/experience-bullets")
    ).listExperienceBullets(true);
    expect(
      all.filter((item) => item.kind === "role").map((item) => item.text),
    ).toContain("");
    expect(
      all
        .filter((item) => item.kind === "bullet")
        .map((item) => item.text)
        .sort(),
    ).toEqual(["Inner duty", "Outer duty"]);
  });
});

const experience = (period = "2020 - Present") => ({
  id: "base-exp",
  hidden: false,
  company: "Acme",
  position: "Engineer",
  period,
  location: "Toronto",
  website: { url: "", label: "" },
  description: "<ul><li>Built APIs</li></ul>",
  roles: [],
});
it.each([
  "2020-Present",
  "2020—Present",
  "2020 – Present",
])("normalises legacy periods (%s) and attaches by source id before text dedupe", async (period) => {
  document.sections.experience.items = [experience(period)];
  await scope("tenant-a", async () => {
    const legacy = api.createLibraryItem({
      text: "Built APIs",
      company: "Old company",
      role: "Old title",
      startDate: "2020",
      endDate: "Present",
      sourceExperienceId: "base-exp",
    });
    api.syncCandidateLibrary(document);
    const all = await (
      await import("../repositories/experience-bullets")
    ).listExperienceBullets(true);
    expect(all).toHaveLength(2);
    expect(all.find((item) => item.id === legacy.id)?.parentId).toBe(
      all.find((item) => item.kind === "role")?.id,
    );
  });
});
it("uses a per-scope first-build marker even after the last role is deleted", async () => {
  document.sections.experience.items = [experience()];
  await scope("tenant-a", async () => {
    api.syncCandidateLibrary(document);
    const all = await (
      await import("../repositories/experience-bullets")
    ).listExperienceBullets(true);
    const role = all.find((item) => item.kind === "role");
    if (!role) throw new Error("Expected role");
    api.deleteLibraryItem(role.id);
    expect(api.syncCandidateLibrary(document).created).toBe(0);
  });
  expect(
    scope("tenant-b", () => api.syncCandidateLibrary(document).created),
  ).toBe(2);
});
it("appends siblings, rejects kind changes and refreshes duty columns on reparent", async () => {
  scope("tenant-a", () => {
    const a = api.createLibraryItem({
      kind: "role",
      text: "A",
      data: { company: "Alpha", period: "2020–2021" },
    });
    const b = api.createLibraryItem({
      kind: "role",
      text: "B",
      data: { company: "Beta", period: "2022–Now" },
    });
    expect(b.position).toBe(a.position + 1);
    expect(() => api.updateLibraryItem(a.id, { kind: "skill" })).toThrow();
    const first = api.createLibraryItem({ text: "First", parentId: a.id });
    const second = api.createLibraryItem({ text: "Second", parentId: a.id });
    expect(second.position).toBe(first.position + 1);
    expect(api.updateLibraryItem(first.id, { parentId: b.id })).toMatchObject({
      company: "Beta",
      role: "B",
      startDate: "2022",
      endDate: "Now",
    });
    const project = api.createLibraryItem({ kind: "project", text: "Tool" });
    const point = api.createLibraryItem({
      kind: "project_point",
      text: "Point",
      parentId: project.id,
    });
    expect(point).toMatchObject({ company: null, role: null });
    expect(
      api.updateLibraryItem(point.id, { company: "Wrong", role: "Wrong" }),
    ).toMatchObject({ company: null, role: null });
  });
});
it.each([
  "role",
  "project",
  "certification",
] as const)("keeps a synced %s website when ticking it onto a resume and editing another field with real helpers", async (kind) => {
  database.closeDb();
  vi.doUnmock("@shared/resume-links");
  vi.resetModules();
  database = await import("../db");
  ({ runWithRequestContext: run } = await import("@infra/request-context"));
  api = await import("./candidate-library");
  const { addToResume, KIND_SECTION } = await import("@shared/resume-links");
  const website = { url: "https://example.com", label: "Site" };
  const section = KIND_SECTION[kind] as
    | "experience"
    | "projects"
    | "certifications";
  const source = {
    role: { ...experience(), website },
    project: {
      id: "project",
      hidden: false,
      name: "Project",
      period: "2024",
      description: "",
      website,
    },
    certification: {
      id: "cert",
      hidden: false,
      title: "Certificate",
      issuer: "Institute",
      date: "2024",
      description: "",
      website,
    },
  }[kind];
  (document.sections[section].items as unknown[]) = [source];
  await scope("tenant-a", async () => {
    api.syncCandidateLibrary(document);
    const repo = await import("../repositories/experience-bullets");
    const library = await repo.listExperienceBullets(true);
    const item = library.find((entry) => entry.kind === kind);
    if (!item) throw new Error("Expected synced item");
    expect(item.data?.website).toEqual(website);
    const empty = structuredClone(document);
    empty.sections[section].items = [];
    const ticked = addToResume(empty, item.id, library);
    expect(ticked.sections[section].items[0].website).toEqual(website);
    job("ticked", "ready", "tenant-a", ticked);
    api.updateLibraryItem(item.id, { text: "Edited name" });
    const updated = rows().find((entry) => entry.jobId === "ticked");
    expect(updated?.document.sections[section].items[0].website).toEqual(
      website,
    );
    expect(updated?.revision).toBe(4);
  });
});
it("syncs, stamps, propagates and deletes with the real shared links, preserving reworded and frozen resumes", async () => {
  // Re-import the service with no shared-link mock at all.
  database.closeDb();
  vi.doUnmock("@shared/resume-links");
  vi.resetModules();
  database = await import("../db");
  ({ runWithRequestContext: run } = await import("@infra/request-context"));
  api = await import("./candidate-library");
  document.sections.experience.items = [experience()];
  job("ready");
  job("frozen", "applied");
  job("skip");
  job("linked");
  job("untouched", "ready", "tenant-a", {
    ...document,
    sections: {
      ...document.sections,
      experience: { ...document.sections.experience, items: [] },
    },
  });
  await scope("tenant-a", async () => {
    expect(api.syncCandidateLibrary(document).linked).toBe(8);
    const repo = await import("../repositories/experience-bullets");
    const all = await repo.listExperienceBullets(true);
    const duty = all.find((item) => item.kind === "bullet");
    const parent = all.find((item) => item.kind === "role");
    const ready = rows().find((row) => row.jobId === "ready");
    if (!duty || !parent || !ready) throw new Error("Expected linked fixture");
    const frozenBefore = rows().find((row) => row.jobId === "frozen");
    const reworded = structuredClone(ready.document);
    reworded.sections.experience.items[0].description =
      "<ul><li>My wording</li></ul>";
    const { eq } = await import("drizzle-orm");
    database.db
      .update(database.schema.jobResumes)
      .set({ document: reworded })
      .where(eq(database.schema.jobResumes.jobId, "ready"))
      .run();
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    api.updateLibraryItem(duty.id, { text: "Built cloud APIs" }, "skip");
    expect(rows().find((row) => row.jobId === "ready")?.revision).toBe(4);
    expect(rows().find((row) => row.jobId === "frozen")?.revision).toBe(4);
    expect(rows().find((row) => row.jobId === "skip")?.revision).toBe(4);
    expect(rows().find((row) => row.jobId === "untouched")?.revision).toBe(3);
    expect(
      rows().find((row) => row.jobId === "linked")?.document.sections.experience
        .items[0].description,
    ).toContain("Built cloud APIs");
    expect(rows().find((row) => row.jobId === "linked")?.revision).toBe(5);
    api.updateLibraryItem(parent.id, {
      text: "Senior Engineer",
      data: { company: "New Acme", period: "2024" },
    });
    expect(
      rows().find((row) => row.jobId === "ready")?.document.sections.experience
        .items[0],
    ).toMatchObject({
      company: "New Acme",
      position: "Senior Engineer",
      period: "2024",
      description: "<ul><li>My wording</li></ul>",
    });
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    api.deleteLibraryItem(parent.id);
    expect(
      rows().find((row) => row.jobId === "ready")?.document.sections.experience
        .items,
    ).toEqual([]);
    expect(rows().find((row) => row.jobId === "frozen")).toEqual(frozenBefore);
    expect(
      rows().find((row) => row.jobId === "frozen")?.document.sections.experience
        .items[0],
    ).toMatchObject({
      libraryId: parent.id,
      bulletRefs: [duty.id],
      description: experience().description,
    });
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    expect(await repo.listExperienceBullets(true)).toEqual([]);
  });
});

it("validates contact data and imports missing base contacts per tenant without duplicates", async () => {
  document.basics.email = "me@example.com";
  document.basics.phone = "123";
  document.basics.location = "London";
  document.basics.website = { url: "https://example.com", label: "Portfolio" };
  const profile = {
    id: "p1",
    hidden: false,
    icon: "",
    network: "GitHub",
    username: "me",
    website: { url: "https://github.com/me", label: "Code" },
  };
  document.sections.profiles.items = [profile, { ...profile, id: "p2" }];
  await scope("tenant-a", async () => {
    expect(() =>
      api.createLibraryItem({
        kind: "contact",
        text: "bad",
        data: { type: "fax", value: "123" },
      }),
    ).toThrow("Invalid contact data");
    expect(() =>
      api.createLibraryItem({
        kind: "contact",
        text: "bad",
        data: { type: "email", value: "" },
      }),
    ).toThrow("Invalid contact data");
    api.createLibraryItem({
      kind: "contact",
      text: "Personal",
      data: { type: "email", value: "me@example.com" },
      tags: ["Personal"],
    });
    expect(api.syncCandidateLibrary(document).created).toBe(4);
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    const repo = await import("../repositories/experience-bullets");
    expect(
      (await repo.listExperienceBullets(true)).filter(
        (item) => item.kind === "contact",
      ),
    ).toHaveLength(5);
  });
  await scope("tenant-b", async () => {
    expect(api.candidateLibraryNeedsFirstBuild()).toBe(true);
    expect(api.syncCandidateLibrary(document).created).toBe(5);
    const repo = await import("../repositories/experience-bullets");
    expect(
      (await repo.listExperienceBullets(true)).filter(
        (item) => item.kind === "contact",
      ),
    ).toHaveLength(5);
  });
});

it("scopes contact usage, propagation and deletion by tenant and preserves frozen resumes", async () => {
  document.basics.email = "me@example.com";
  job("ready-a");
  job("frozen-a", "applied");
  job("ready-b", "ready", "tenant-b");
  await scope("tenant-a", async () => {
    const item = api.createLibraryItem({
      kind: "contact",
      text: "Email",
      data: { type: "email", value: "me@example.com" },
    });
    expect(api.libraryItemUsage(item.id)).toEqual({
      jobIds: ["ready-a"],
      frozenJobIds: ["frozen-a"],
    });
    api.updateLibraryItem(item.id, {
      data: { type: "email", value: "new@example.com" },
    });
    expect(
      rows().find((row) => row.jobId === "ready-a")?.document.basics.email,
    ).toBe("new@example.com");
    expect(
      rows().find((row) => row.jobId === "frozen-a")?.document.basics.email,
    ).toBe("me@example.com");
    expect(
      rows().find((row) => row.jobId === "ready-b")?.document.basics.email,
    ).toBe("me@example.com");
    api.deleteLibraryItem(item.id);
    expect(
      rows().find((row) => row.jobId === "ready-a")?.document.basics.email,
    ).toBe("");
    expect(
      rows().find((row) => row.jobId === "frozen-a")?.document.basics.email,
    ).toBe("me@example.com");
    expect(
      rows().find((row) => row.jobId === "ready-b")?.document.basics.email,
    ).toBe("me@example.com");
  });
});

it("sync imports missing base contacts into existing libraries without editing or removing contacts", async () => {
  await scope("tenant-a", async () => {
    api.syncCandidateLibrary(document);
    expect(api.candidateLibraryNeedsFirstBuild()).toBe(false);
    const existing = api.createLibraryItem({
      kind: "contact",
      text: "Display",
      tags: ["Personal"],
      data: { type: "email", value: "  me@example.com  " },
    });
    expect(existing).toMatchObject({
      text: "me@example.com",
      data: { value: "me@example.com" },
    });
    document.basics.email = " ME@example.com ";
    document.basics.phone = " 123 ";
    expect(api.syncCandidateLibrary(document).created).toBe(1);
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    const repo = await import("../repositories/experience-bullets");
    const contacts = (await repo.listExperienceBullets(true)).filter(
      (item) => item.kind === "contact",
    );
    expect(contacts).toHaveLength(2);
    expect(contacts.find((item) => item.id === existing.id)).toEqual(existing);
    expect(contacts.find((item) => item.data?.type === "phone")).toMatchObject({
      text: "123",
      data: { value: "123" },
    });
    const updated = api.updateLibraryItem(existing.id, {
      data: { type: "email", value: " new@example.com " },
    });
    expect(updated).toMatchObject({
      text: "new@example.com",
      data: { value: "new@example.com" },
    });
    document.basics.email = "";
    document.basics.phone = "";
    expect(api.syncCandidateLibrary(document).created).toBe(0);
    expect(
      (await repo.listExperienceBullets(true)).filter(
        (item) => item.kind === "contact",
      ),
    ).toHaveLength(2);
  });
  await scope("tenant-b", async () => {
    const repo = await import("../repositories/experience-bullets");
    expect(
      (await repo.listExperienceBullets(true)).filter(
        (item) => item.kind === "contact",
      ),
    ).toHaveLength(0);
  });
});
