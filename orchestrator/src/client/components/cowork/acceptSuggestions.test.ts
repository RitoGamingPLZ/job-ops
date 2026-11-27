import { librarySaveInput } from "@shared/library-save-input";
import type { ExperienceBullet, ResumeV5Document, ResumeSuggestionV2 } from "@shared/types";
import { expect, it } from "vitest";
import { applyResumeEdits } from "./acceptSuggestions";

const row = (id: string, kind: ExperienceBullet["kind"], extra: Partial<ExperienceBullet> = {}) =>
  ({
    id,
    kind,
    text: id,
    parentId: null,
    data: {},
    ...extra,
  }) as ExperienceBullet;
const fixture = () =>
  ({
    basics: { headline: "Engineer" },
    summary: { content: "Summary" },
    customSections: [],
    sections: {
      experience: {
        items: [
          {
            id: "role-entry",
            hidden: false,
            libraryId: "role",
            position: "Engineer",
            company: "Acme",
            description: "<ul><li>Job wording</li></ul>",
            bulletRefs: ["line"],
          },
        ],
      },
      projects: { items: [] },
      skills: { items: [] },
      education: { items: [] },
      awards: { items: [] },
      certifications: { items: [] },
    },
  }) as unknown as ResumeV5Document;
const state = () => ({
  jobId: "job",
  baseRevision: 7,
  document: fixture(),
  library: [row("role", "role"), row("line", "bullet", { parentId: "role", text: "Canonical" })],
});
const save: ResumeSuggestionV2 = {
  id: "save",
  reason: "Explicit write",
  op: "save_to_library",
  target: {
    kind: "line",
    libraryId: "line",
    target: {
      section: "experience",
      itemId: "role-entry",
      bulletIndex: 0,
      previousText: "Job wording",
    },
  },
};
const headline: ResumeSuggestionV2 = {
  id: "headline",
  reason: "Specific",
  op: "replace_headline",
  previousText: "Engineer",
  text: "Senior Engineer",
};

it("checks the reviewed line and its current link before promotion", () => {
  const original = state();
  const read = () => librarySaveInput(original.document, save.target, original.library);
  expect(read()).toMatchObject({ input: { text: "Job wording" } });
  original.document.sections.experience.items[0].description = "<ul><li>Changed</li></ul>";
  expect(read()).toEqual({ code: "STALE" });
  original.document.sections.experience.items[0].bulletRefs = ["other"];
  expect(read()).toEqual({ code: "INVALID_TARGET" });
});
it("applies only current resume rewrites", () => {
  const original = state();
  expect(applyResumeEdits(original.document, [headline], original.library).applied).toEqual([
    "headline",
  ]);
});
it("reports stale guarded text separately from invalid targets and permutations", async () => {
  const original = state();
  const result = applyResumeEdits(
    original.document,
    [
      {
        id: "exclude",
        reason: "Review",
        op: "exclude_library_item",
        libraryId: "line",
      },
      {
        id: "stale-line",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "role-entry",
        bulletIndex: 0,
        previousText: "Old wording",
        text: "New",
      },
      {
        id: "missing",
        reason: "Review",
        op: "replace_bullet",
        section: "experience",
        itemId: "missing",
        bulletIndex: 0,
        previousText: "Old",
        text: "New",
      },
      {
        id: "bad-order",
        reason: "Review",
        op: "reorder_bullets",
        section: "experience",
        itemId: "role-entry",
        previousTexts: [],
        order: [0],
      },
    ],
    original.library,
  );
  expect(result.rejected).toEqual(
    expect.arrayContaining([
      { id: "stale-line", code: "STALE" },
      { id: "missing", code: "INVALID_TARGET" },
      { id: "bad-order", code: "INVALID_TARGET" },
    ]),
  );
});

it("excludes a derived company placeholder and keeps the reviewed title", () => {
  const original = state();
  original.document.sections.experience.items[0].company = "?";
  original.library[0].data = { company: "" };
  expect(
    librarySaveInput(
      original.document,
      { kind: "entry", section: "experience", itemId: "role-entry", libraryId: "role" },
      original.library,
    ),
  ).toMatchObject({ input: { text: "Engineer" } });
});
