import { describe, expect, it } from "vitest";
import {
  defaultV5ResumeData,
  parseV5ResumeData,
} from "../../orchestrator/src/server/services/rxresume/schema/v5";
import {
  addToResume,
  applyLibraryUpdate,
  getItemLines,
  isOnResume,
  KIND_SECTION,
  libraryItemToResumeItem,
  type ResumeDoc,
  type ResumeItem,
  removeFromResume,
  resetLine,
  sameLineText,
  setItemLines,
  stampLibraryRefs,
} from "./resume-links";
import type { CandidateItemKind, ExperienceBullet } from "./types/cowork";

function row(
  id: string,
  kind: CandidateItemKind,
  text: string,
  extra: Partial<ExperienceBullet> = {},
): ExperienceBullet {
  return {
    id,
    kind,
    text,
    data: null,
    parentId: null,
    position: 0,
    company: null,
    role: null,
    startDate: null,
    endDate: null,
    tags: [],
    source: "manual",
    sourceExperienceId: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...extra,
  };
}
const role = row("role", "role", "Engineer", {
  data: {
    company: "Acme",
    location: "London",
    website: "https://example.com",
    period: "2020–2024",
  },
});
const duty = row("duty", "bullet", "Built APIs & tools", { parentId: role.id });
const otherDuty = row("other-duty", "bullet", "Led delivery", {
  parentId: role.id,
  position: 2,
});
const project = row("project", "project", "Widget", {
  data: { period: "2024", website: "https://example.com" },
});
const point = row("point", "project_point", "Shipped a widget", {
  parentId: project.id,
});
const skill = row("skill", "skill", "Languages", {
  data: { keywords: ["TypeScript", "Go"] },
});
const education = row("education", "education", "BSc · CS · First", {
  data: {
    school: "Example University",
    location: "Toronto",
    period: "2016–2020",
  },
});
const award = row("award", "award", "Prize · Society", {
  data: { date: "2020" },
});
const certification = row(
  "certification",
  "certification",
  "Certified Developer",
  {
    data: { issuer: "Institute", website: "https://example.com", date: "2024" },
  },
);
const library = [
  role,
  duty,
  otherDuty,
  project,
  point,
  skill,
  education,
  award,
  certification,
];
const parents = [role, project, skill, education, award, certification];
function document(): ResumeDoc {
  return structuredClone(defaultV5ResumeData);
}
function entries(doc: ResumeDoc, kind: CandidateItemKind): ResumeItem[] {
  return (
    doc.sections[KIND_SECTION[kind] ?? "experience"] as { items: ResumeItem[] }
  ).items;
}
function withEntry(doc: ResumeDoc, item: ResumeItem): ResumeDoc {
  return {
    ...doc,
    sections: {
      ...doc.sections,
      experience: {
        ...doc.sections.experience,
        items: [item] as ResumeDoc["sections"]["experience"]["items"],
      },
    },
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

describe("resume library lines", () => {
  it("compares trimmed and collapsed whitespace without ignoring wording or case", () => {
    expect(sameLineText("  Built\n APIs  ", "Built APIs")).toBe(true);
    expect(sameLineText("Built APIs", "built APIs")).toBe(false);
    expect(sameLineText("Built APIs", "Built tools")).toBe(false);
  });
  it("reads only list bullets and pads/truncates refs to match them", () => {
    expect(
      getItemLines({
        description: "<p>Intro</p><ol><li>A &amp; B</li><li>C</li></ol>",
        bulletRefs: ["a"],
      }),
    ).toEqual([
      { text: "A & B", ref: "a" },
      { text: "C", ref: null },
    ]);
    expect(
      getItemLines({
        description: "<ul><li>A</li></ul>",
        bulletRefs: [42, "extra"],
      }),
    ).toEqual([{ text: "A", ref: null }]);
    expect(getItemLines({ description: "<p>Prose only</p>" })).toEqual([]);
  });
  it("keeps prose before/between/after lists, escapes edits, and aligns reordered refs", () => {
    const item = {
      description:
        "<p>Intro</p><ol><li>A</li></ol><p>Between</p><ul><li>B</li></ul><p>After</p>",
      bulletRefs: ["a", "b"],
    };
    const next = setItemLines(item, [
      { text: "B <&>", ref: "b" },
      { text: "New", ref: null },
    ]);
    expect(next.description).toBe(
      "<p>Intro</p><ul><li>B &lt;&amp;&gt;</li><li>New</li></ul><p>Between</p><p>After</p>",
    );
    expect(next.bulletRefs).toEqual(["b", null]);
    expect(setItemLines(next, []).description).toBe(
      "<p>Intro</p><p>Between</p><p>After</p>",
    );
    expect(item.bulletRefs).toEqual(["a", "b"]);
  });
  it("preserves formatted HTML byte-for-byte when only refs change", () => {
    const item = {
      description: '<ol class="list"><li><b>A</b> &amp; B</li></ol>',
    };
    const next = setItemLines(item, [{ text: "A & B", ref: "a" }]);
    expect(next.description).toBe(item.description);
    expect(next.bulletRefs).toEqual(["a"]);
    expect(setItemLines(next, getItemLines(next))).toBe(next);
    expect(setItemLines(item, getItemLines(item))).toBe(item);
  });
});

describe("ticking library items", () => {
  it.each(parents)("builds schema-valid $kind items with fresh ids", (item) => {
    const first = libraryItemToResumeItem(item);
    expect(first).toMatchObject({ hidden: false, libraryId: item.id });
    expect(first.id).not.toBe(libraryItemToResumeItem(item).id);
    const doc = addToResume(document(), item.id, library);
    expect(() => parseV5ResumeData(doc)).not.toThrow();
    expect(entries(doc, item.kind)).toHaveLength(1);
    expect(isOnResume(doc, item.id)).toBe(true);
    expect(addToResume(doc, item.id, library)).toBe(doc);
    expect(entries(removeFromResume(doc, item.id), item.kind)).toEqual([]);
  });
  it.each([
    [role, duty],
    [project, point],
  ])("auto-adds only the missing parent for a $1.kind", (parent, child) => {
    const doc = addToResume(
      freeze(document()),
      child.id,
      freeze(structuredClone(library)),
    );
    const entry = entries(doc, parent.kind)[0];
    expect(entry.libraryId).toBe(parent.id);
    expect(getItemLines(entry)).toEqual([{ text: child.text, ref: child.id }]);
    expect(isOnResume(doc, child.id)).toBe(true);
    expect(addToResume(doc, child.id, library)).toBe(doc);
    const removed = removeFromResume(doc, child.id);
    expect(isOnResume(removed, child.id)).toBe(false);
    expect(isOnResume(removed, parent.id)).toBe(true);
    expect(getItemLines(entries(removed, parent.kind)[0])).toEqual([]);
    expect(isOnResume(removeFromResume(doc, parent.id), child.id)).toBe(false);
  });
  it("adds all children in library order for a parent, and appends new children", () => {
    let doc = addToResume(document(), role.id, [otherDuty, duty, role]);
    expect(
      getItemLines(entries(doc, "role")[0]).map((line) => line.ref),
    ).toEqual([duty.id, otherDuty.id]);
    const extra = row("extra", "bullet", "New", { parentId: role.id });
    doc = addToResume(doc, extra.id, [...library, extra]);
    expect(
      getItemLines(entries(doc, "role")[0]).map((line) => line.ref),
    ).toEqual([duty.id, otherDuty.id, extra.id]);
    const another = row("another", "role", "Manager");
    doc = addToResume(doc, another.id, [...library, another]);
    expect(entries(doc, "role").map((item) => item.libraryId)).toEqual([
      role.id,
      another.id,
    ]);
  });
  it("ignores missing items, missing parents, and parents of the wrong kind", () => {
    const doc = document();
    expect(addToResume(doc, "absent", library)).toBe(doc);
    expect(addToResume(doc, duty.id, [duty])).toBe(doc);
    expect(addToResume(doc, duty.id, [duty, { ...project, id: role.id }])).toBe(
      doc,
    );
    expect(removeFromResume(doc, "absent")).toBe(doc);
  });
  it("gives skills their own keyword array", () => {
    const item = libraryItemToResumeItem(skill);
    expect(item.keywords).toEqual(skill.data?.keywords);
    expect(item.keywords).not.toBe(skill.data?.keywords);
  });
});

describe("library updates and resets", () => {
  it("updates normalized linked text while leaving reworded and unlinked lines alone", () => {
    const item = {
      ...libraryItemToResumeItem(role),
      description:
        "<p>Intro</p><ul><li>Built  APIs &amp; tools</li><li>My rewording</li><li>Built APIs &amp; tools</li></ul><p>After</p>",
      bulletRefs: [duty.id, duty.id, null],
    };
    const doc = freeze(withEntry(document(), item));
    const next = applyLibraryUpdate(doc, duty, {
      ...duty,
      text: "Fixed <text>",
    });
    expect(getItemLines(entries(next, "role")[0])).toEqual([
      { text: "Fixed <text>", ref: duty.id },
      { text: "My rewording", ref: duty.id },
      { text: duty.text, ref: null },
    ]);
    expect(entries(next, "role")[0].description).toBe(
      "<p>Intro</p><ul><li>Fixed &lt;text&gt;</li><li>My rewording</li><li>Built APIs &amp; tools</li></ul><p>After</p>",
    );
    expect(next.sections.skills).toBe(doc.sections.skills);
    expect(
      applyLibraryUpdate(next, duty, { ...duty, text: "Another fix" }),
    ).toBe(next);
  });
  it.each(
    parents,
  )("re-derives $kind fields while retaining item identity and other resume fields", (original) => {
    const doc = addToResume(document(), original.id, library);
    const entry = entries(doc, original.kind)[0];
    const after = {
      ...original,
      text: "Updated",
      data: {
        company: "New Co",
        location: "New place",
        website: "https://new.example",
        period: "2025",
        school: "New school",
        issuer: "New issuer",
        date: "2025",
        keywords: ["Rust"],
      },
    };
    const next = applyLibraryUpdate(freeze(doc), original, after);
    const updated = entries(next, original.kind)[0];
    expect(updated.id).toBe(entry.id);
    const expected = libraryItemToResumeItem(after);
    for (const [key, value] of Object.entries(expected)) {
      if (
        ["id", "description", "bulletRefs", "keywords", "roles"].includes(key)
      )
        continue;
      expect(updated[key]).toEqual(value);
    }
    if (original.kind === "skill")
      expect(updated.keywords).toEqual(["TypeScript", "Go"]);
    if (original.kind === "role" || original.kind === "project")
      expect(getItemLines(updated)).toEqual(getItemLines(entry));
    expect(applyLibraryUpdate(next, after, after)).toBe(next);
  });
  it("leaves freezing policy to the caller and does not inspect job status", () => {
    const doc = {
      ...addToResume(document(), duty.id, library),
      status: "applied",
    };
    expect(
      getItemLines(
        entries(
          applyLibraryUpdate(doc, duty, { ...duty, text: "Fixed" }),
          "role",
        )[0],
      )[0].text,
    ).toBe("Fixed");
  });
  it("resets only the specified linked line, and returns identity for no-ops", () => {
    const entry = setItemLines(libraryItemToResumeItem(role), [
      { text: "Reworded", ref: duty.id },
      { text: "Unlinked", ref: null },
    ]);
    const doc = withEntry(document(), entry);
    const next = resetLine(doc, String(entry.id), 0, library);
    expect(getItemLines(entries(next, "role")[0])).toEqual([
      { text: duty.text, ref: duty.id },
      { text: "Unlinked", ref: null },
    ]);
    expect(resetLine(next, String(entry.id), 0, library)).toBe(next);
    expect(resetLine(doc, "missing", 0, library)).toBe(doc);
    expect(resetLine(doc, String(entry.id), 1, library)).toBe(doc);
    expect(resetLine(doc, String(entry.id), -1, library)).toBe(doc);
    expect(resetLine(doc, String(entry.id), 20, library)).toBe(doc);
    expect(resetLine(doc, String(entry.id), 0, [])).toBe(doc);
  });
});

describe("stamping existing resumes", () => {
  it("stamps all kinds and their lines without changing text or HTML", () => {
    let doc = document();
    for (const item of parents) doc = addToResume(doc, item.id, library);
    for (const section of Object.values(doc.sections)) {
      if (
        !section ||
        typeof section !== "object" ||
        !Array.isArray(section.items)
      )
        continue;
      for (const item of section.items) {
        delete item.libraryId;
        delete item.bulletRefs;
      }
    }
    doc.sections.experience.items[0].description =
      '<p>Intro</p><ol class="kept"><li>Built <b>APIs</b> &amp; tools</li><li>Led delivery</li></ol><p>After</p>';
    const original = structuredClone(doc);
    const stamped = stampLibraryRefs(freeze(doc), library);
    expect(stamped.linked).toBe(9);
    expect(stamped.doc.sections.experience.items[0].description).toBe(
      original.sections.experience.items[0].description,
    );
    for (const item of library)
      expect(isOnResume(stamped.doc, item.id)).toBe(true);
    const stripped = structuredClone(stamped.doc);
    for (const section of Object.values(stripped.sections)) {
      if (
        !section ||
        typeof section !== "object" ||
        !Array.isArray(section.items)
      )
        continue;
      for (const item of section.items) {
        delete item.libraryId;
        delete item.bulletRefs;
      }
    }
    expect(stripped).toEqual(original);
    expect(stampLibraryRefs(stamped.doc, library)).toEqual({
      doc: stamped.doc,
      linked: 0,
    });
    expect(stampLibraryRefs(stamped.doc, library).doc).toBe(stamped.doc);
  });
  it("prefers role company/period and lines belonging to that parent", () => {
    const duplicateRole = {
      ...role,
      id: "elsewhere",
      data: { ...role.data, company: "Other Co" },
    };
    const duplicateDuty = {
      ...duty,
      id: "elsewhere-duty",
      parentId: duplicateRole.id,
    };
    const item = {
      ...libraryItemToResumeItem(role),
      libraryId: undefined,
      description: "<ul><li>Built APIs &amp; tools</li></ul>",
    };
    const result = stampLibraryRefs(withEntry(document(), item), [
      duplicateRole,
      duplicateDuty,
      role,
      duty,
    ]);
    expect(result.doc.sections.experience.items[0].libraryId).toBe(role.id);
    expect(result.doc.sections.experience.items[0].bulletRefs).toEqual([
      duty.id,
    ]);
  });
  it("folds one-line legacy fields for matching without rewriting them", () => {
    const doc = document();
    doc.sections.education.items.push({
      ...libraryItemToResumeItem(education),
      libraryId: undefined,
      degree: "BSc",
      area: "CS",
      grade: "First",
      description: "",
    } as ResumeDoc["sections"]["education"]["items"][number]);
    doc.sections.awards.items.push({
      ...libraryItemToResumeItem(award),
      libraryId: undefined,
      title: "Prize",
      awarder: "Society",
      description: "",
    } as ResumeDoc["sections"]["awards"]["items"][number]);
    const result = stampLibraryRefs(doc, library);
    expect(result.linked).toBe(2);
    expect(result.doc.sections.education.items[0].degree).toBe("BSc");
    expect(result.doc.sections.awards.items[0].awarder).toBe("Society");
  });
  it("preserves existing links and missing matches; pads partially matched refs", () => {
    const item = {
      ...libraryItemToResumeItem(role),
      description:
        "<ul><li>Already linked</li><li>Unmatched</li><li>Built APIs &amp; tools</li></ul>",
      bulletRefs: ["existing"],
    };
    const result = stampLibraryRefs(withEntry(document(), item), library);
    expect(result.linked).toBe(1);
    expect(result.doc.sections.experience.items[0].bulletRefs).toEqual([
      "existing",
      null,
      duty.id,
    ]);
    const empty = document();
    expect(stampLibraryRefs(empty, library).doc).toBe(empty);
    const unmatched = withEntry(empty, {
      ...item,
      libraryId: undefined,
      position: "Unknown",
      bulletRefs: ["existing", null, "existing-2"],
    });
    expect(stampLibraryRefs(unmatched, []).doc).toBe(unmatched);
  });
  it("supports links in custom sections for stamp/update/reset/removal", () => {
    const doc = document();
    const item = {
      ...libraryItemToResumeItem(role),
      libraryId: undefined,
      description: "<ul><li>Built APIs &amp; tools</li></ul>",
    };
    doc.customSections.push({
      id: "custom",
      type: "experience",
      title: "More experience",
      columns: 1,
      hidden: false,
      items: [item as ResumeDoc["sections"]["experience"]["items"][number]],
    });
    const stamped = stampLibraryRefs(doc, library);
    expect(stamped.linked).toBe(2);
    expect(isOnResume(stamped.doc, duty.id)).toBe(true);
    const updated = applyLibraryUpdate(stamped.doc, duty, {
      ...duty,
      text: "Fixed",
    });
    expect(getItemLines(updated.customSections[0].items[0])[0].text).toBe(
      "Fixed",
    );
    const reset = resetLine(updated, String(item.id), 0, library);
    expect(getItemLines(reset.customSections[0].items[0])[0].text).toBe(
      duty.text,
    );
    expect(removeFromResume(reset, role.id).customSections[0].items).toEqual(
      [],
    );
  });
});
