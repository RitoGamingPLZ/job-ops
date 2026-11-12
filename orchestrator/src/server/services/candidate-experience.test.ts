import type { ExperienceBullet } from "@shared/types";
import { beforeEach, expect, it, vi } from "vitest";

const { list, needsFirstBuild } = vi.hoisted(() => ({
  list: vi.fn(),
  needsFirstBuild: vi.fn(),
}));
vi.mock("./candidate-library", () => ({
  candidateLibraryNeedsFirstBuild: needsFirstBuild,
}));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: list,
}));

import {
  buildCandidateExperienceContext,
  buildCandidateTailoringContext,
} from "./candidate-experience";

const bullet = (
  id: string,
  extra: Partial<ExperienceBullet> = {},
): ExperienceBullet => ({
  id,
  kind: "bullet" as const,
  data: null,
  parentId: null,
  position: 0,
  text: `Duty ${id}`,
  company: "Acme",
  role: "Engineer",
  startDate: "2024",
  endDate: "Present",
  tags: ["TypeScript"],
  source: "manual",
  sourceExperienceId: null,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  needsFirstBuild.mockReturnValue(true);
});
it("returns null for an empty scoped library", async () => {
  list.mockResolvedValue([]);
  expect(await buildCandidateExperienceContext()).toBeNull();
});
it("groups company, role and dates and counts each skill once per duty", async () => {
  list.mockResolvedValue([
    bullet("a", { tags: ["TypeScript", "typescript", "React"] }),
    bullet("b"),
    bullet("c", { role: "Lead", tags: ["React"] }),
  ]);
  const result = await buildCandidateExperienceContext();
  expect(result?.match(/Acme/g)).toHaveLength(2);
  expect(result).toContain(
    "Engineer (2024 – Present)\n- Duty a [TypeScript, typescript, React]\n- Duty b [TypeScript]",
  );
  expect(result).toContain("Lead (2024 – Present)");
  expect(result).toContain("Duty tags: React (2), TypeScript (2)");
});
it("drops oldest groups first, caps a giant group and retains skills", async () => {
  list.mockResolvedValue([
    bullet("old", {
      company: "Old",
      endDate: "2001",
      text: "x".repeat(9000),
      tags: ["OldSkill"],
    }),
    bullet("new", { company: "New", text: "y".repeat(9000) }),
  ]);
  const result = await buildCandidateExperienceContext();
  expect(result).not.toContain("Old");
  expect(result).toContain("New");
  expect(result?.length).toBeLessThanOrEqual(12000);
  list.mockResolvedValue([bullet("giant", { text: "z".repeat(30000) })]);
  const giant = await buildCandidateExperienceContext();
  expect(giant?.length).toBe(12000);
  expect(giant).toContain("Duty tags: TypeScript (1)");
});
it("never caches across calls/private scopes", async () => {
  list
    .mockResolvedValueOnce([bullet("alice")])
    .mockResolvedValueOnce([bullet("bob", { company: "Bob" })]);
  expect(await buildCandidateExperienceContext()).toContain("Duty alice");
  const second = await buildCandidateExperienceContext();
  expect(second).toContain("Duty bob");
  expect(second).not.toContain("alice");
});

it("respects smaller budgets including a giant group and its skill summary", async () => {
  list.mockResolvedValue([bullet("giant", { text: "z".repeat(13000) })]);
  const result = await buildCandidateExperienceContext(4000);
  expect(result).toHaveLength(4000);
  expect(result).toContain("Duty tags: TypeScript (1)");
  expect(await buildCandidateExperienceContext()).toHaveLength(12000);
});
it("orders mixed date formats by year and month, current first and undated last", async () => {
  const dates = [
    "Mar 2019",
    "Jan 2024",
    "Dec 2023",
    "2024-06",
    "December 2024",
    "Present",
    "Current",
    null,
  ];
  list.mockResolvedValue(
    dates.map((endDate, i) =>
      bullet(String(i), {
        company: `Company${i}`,
        startDate: null,
        endDate,
        createdAt: endDate ? "2020-01-01" : "2099-01-01",
      }),
    ),
  );
  const result = await buildCandidateExperienceContext();
  expect(result?.match(/Company\d/g)).toEqual([
    "Company5",
    "Company6",
    "Company4",
    "Company3",
    "Company1",
    "Company2",
    "Company0",
    "Company7",
  ]);
});
it("drops undated imports and older mixed-format groups before recent work", async () => {
  list.mockResolvedValue([
    bullet("undated", {
      company: "Undated",
      startDate: null,
      endDate: null,
      createdAt: "2099-01-01",
      text: "u".repeat(2000),
    }),
    bullet("old", {
      company: "Old",
      startDate: null,
      endDate: "Dec 2023",
      text: "o".repeat(2000),
    }),
    bullet("recent", {
      company: "Recent",
      startDate: "2024-06",
      endDate: null,
      text: "r".repeat(2000),
    }),
  ]);
  const result = await buildCandidateExperienceContext(4000);
  expect(result).toContain("Recent");
  expect(result).not.toContain("Undated");
  expect(result).not.toContain("Old");
});

it("distinguishes an initialised empty library from a never-built one", async () => {
  list.mockResolvedValue([]);
  needsFirstBuild.mockReturnValue(false);
  expect(await buildCandidateExperienceContext()).toBe("");
  expect(list).toHaveBeenCalledWith(true);
});
it("groups duties by parent identity despite identical role labels and stale duty metadata", async () => {
  list.mockResolvedValue([
    bullet("r1", {
      kind: "role",
      text: "Consultant",
      data: { company: "Acme", period: "2024" },
    }),
    bullet("r2", {
      kind: "role",
      text: "Consultant",
      data: { company: "Acme", period: "2024" },
    }),
    bullet("a", { parentId: "r1", company: "Wrong", role: "Wrong" }),
    bullet("b", { parentId: "r2" }),
  ]);
  const result = await buildCandidateExperienceContext();
  expect(result?.match(/Consultant \(2024\)/g)).toHaveLength(2);
  expect(result).toContain("Consultant (2024)\n- Duty a");
  expect(result).toContain("Consultant (2024)\n- Duty b");
  expect(result).not.toContain("Wrong");
});
it("renders interleaved employers newest first, including roles with no duties", async () => {
  list.mockResolvedValue([
    bullet("old", {
      kind: "role",
      text: "Old role",
      data: { company: "Acme", period: "2019 – 2020" },
    }),
    bullet("new", {
      kind: "role",
      text: "New role",
      data: { company: "Acme", period: "2025 – Present" },
    }),
    bullet("middle", {
      kind: "role",
      text: "Middle role",
      data: { company: "Beta", period: "2023 – 2024" },
    }),
  ]);
  const result = await buildCandidateExperienceContext();
  expect(result?.match(/(?:New|Middle|Old) role/g)).toEqual([
    "New role",
    "Middle role",
    "Old role",
  ]);
});
it("includes library facts and project points, omitting all contact data and unknown fields", async () => {
  list.mockResolvedValue([
    bullet("contact", {
      kind: "contact",
      text: "private@example.com",
      data: { value: "secret" },
    }),
    bullet("skill", {
      kind: "skill",
      text: "Languages",
      data: { keywords: ["Rust", "Python", 123], secret: "secret" },
    }),
    bullet("project", {
      kind: "project",
      text: "Library API",
      data: { period: "2025" },
    }),
    bullet("point", {
      kind: "project_point",
      parentId: "project",
      text: "Built useful endpoints",
    }),
    bullet("education", {
      kind: "education",
      text: "BSc",
      data: {
        schemaVersion: 2,
        school: "University",
        period: "2020",
        area: "Computing",
        grade: "First",
        description: "<p>Thesis research</p>",
      },
    }),
    bullet("cert", {
      kind: "certification",
      text: "Cloud",
      data: {
        schemaVersion: 2,
        issuer: "Vendor",
        date: "2024",
        description: "<p>Practical exam</p>",
      },
    }),
    bullet("award", {
      kind: "award",
      text: "Prize",
      data: {
        schemaVersion: 2,
        date: "2023",
        awarder: "Society",
        description: "<p>Research award</p>",
      },
    }),
  ]);
  const result = await buildCandidateExperienceContext();
  for (const text of [
    "Skills:\n- Languages: Rust, Python",
    "Projects:\n- Library API: 2025\n  - Built useful endpoints",
    "BSc: University, 2020, Computing, First, Thesis research",
    "Cloud: Vendor, 2024, Practical exam",
    "Prize: 2023, Society, Research award",
  ])
    expect(result).toContain(text);
  expect(result).not.toContain("private@example.com");
  expect(result).not.toContain("secret");
  expect(
    (await buildCandidateExperienceContext(40))?.length,
  ).toBeLessThanOrEqual(40);
  expect(await buildCandidateExperienceContext(0)).toBe("");
});
it("does not use contacts-only libraries as a reason to resurrect legacy facts", async () => {
  list.mockResolvedValue([
    bullet("contact", { kind: "contact", text: "private@example.com" }),
  ]);
  expect(await buildCandidateExperienceContext()).toBe("");
});

it("orders compact year ranges by their end year without breaking ISO months", async () => {
  list.mockResolvedValue([
    bullet("older", {
      kind: "role",
      text: "Older",
      data: { company: "Acme", period: "2019-2020" },
    }),
    bullet("newer", {
      kind: "role",
      text: "Newer",
      data: { company: "Beta", period: "2015-2021" },
    }),
    bullet("iso", {
      kind: "role",
      text: "ISO",
      data: { company: "Gamma", period: "2021-03" },
    }),
  ]);
  expect(
    (await buildCandidateExperienceContext())?.match(/(?:Older|Newer|ISO) \(/g),
  ).toEqual(["ISO (", "Newer (", "Older ("]);
});
it("bounds non-role sections before they can displace a second role", async () => {
  list.mockResolvedValue([
    bullet("r1", {
      kind: "role",
      text: "Newest role",
      data: { company: "Acme", period: "2025" },
    }),
    bullet("r2", {
      kind: "role",
      text: "Second role",
      data: { company: "Beta", period: "2024" },
    }),
    bullet("a", { parentId: "r1", text: "Recent duty" }),
    bullet("b", { parentId: "r2", text: "Earlier duty" }),
    bullet("skill", {
      kind: "skill",
      text: "Languages",
      data: { keywords: ["Rust"] },
    }),
    bullet("project", { kind: "project", text: "Important project" }),
    bullet("point", {
      kind: "project_point",
      parentId: "project",
      text: "p".repeat(5000),
    }),
    bullet("education", { kind: "education", text: "Education".repeat(1000) }),
    bullet("cert", {
      kind: "certification",
      text: "Certification".repeat(1000),
    }),
    bullet("award", { kind: "award", text: "Award".repeat(1000) }),
  ]);
  const result = await buildCandidateExperienceContext(600);
  for (const fact of [
    "Newest role",
    "Second role",
    "Recent duty",
    "Earlier duty",
    "Skills:",
    "Languages",
  ])
    expect(result).toContain(fact);
  for (const heading of ["Education:", "Certifications:", "Awards:"])
    expect(result).not.toContain(heading);
  expect(result?.length).toBeLessThanOrEqual(600);
});
it("reads the library once for tailoring, excluding duplicated skills and unfiltered projects", async () => {
  list.mockResolvedValue([
    bullet("role", {
      kind: "role",
      text: "Engineer",
      data: { company: "Acme", period: "2025" },
    }),
    bullet("duty", { parentId: "role" }),
    bullet("skill", {
      kind: "skill",
      text: "Languages",
      data: { keywords: ["Rust", 42] },
    }),
    bullet("project", { kind: "project", text: "Excluded project" }),
    bullet("point", {
      kind: "project_point",
      parentId: "project",
      text: "Excluded point",
    }),
    bullet("contact", { kind: "contact", text: "private@example.com" }),
  ]);
  const result = await buildCandidateTailoringContext();
  expect(list).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledWith(true);
  expect(result.skills).toEqual({
    items: [{ name: "Languages", keywords: ["Rust"] }],
  });
  expect(result.experience).toContain("Duty duty");
  for (const fact of [
    "Skills:",
    "Projects:",
    "Rust",
    "Excluded project",
    "Excluded point",
    "private@example.com",
  ])
    expect(result.experience).not.toContain(fact);
});
it("keeps first-build and empty tailoring state scoped across consecutive callers", async () => {
  list.mockResolvedValue([]);
  needsFirstBuild.mockReturnValueOnce(true).mockReturnValueOnce(false);
  expect(await buildCandidateTailoringContext()).toEqual({
    experience: null,
    skills: null,
  });
  expect(await buildCandidateTailoringContext()).toEqual({
    experience: "",
    skills: { items: [] },
  });
});
