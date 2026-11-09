import type { ExperienceBullet } from "@shared/types";
import { beforeEach, expect, it, vi } from "vitest";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@server/repositories/experience-bullets", () => ({
  listExperienceBullets: list,
}));

import { buildCandidateExperienceContext } from "./candidate-experience";

const bullet = (
  id: string,
  extra: Partial<ExperienceBullet> = {},
): ExperienceBullet => ({
  id,
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
beforeEach(() => vi.clearAllMocks());
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
  expect(result?.match(/Acme/g)).toHaveLength(1);
  expect(result).toContain(
    "Engineer (2024 – Present)\n- Duty a [TypeScript, typescript, React]\n- Duty b [TypeScript]",
  );
  expect(result).toContain("Lead (2024 – Present)");
  expect(result).toContain("Skills: React (2), TypeScript (2)");
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
  expect(giant).toContain("Skills: TypeScript (1)");
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
