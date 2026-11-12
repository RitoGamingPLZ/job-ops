import { describe, expect, it } from "vitest";
import {
  defaultV5ResumeData,
  parseV5ResumeData,
} from "../../orchestrator/src/server/services/rxresume/schema/v5";
import {
  addToResume,
  applyLibraryUpdate,
  foldResumeParts,
  getItemLines,
  isContactOnResume,
  isOnResume,
  KIND_SECTION,
  libraryItemToResumeItem,
  linkedFieldPatch,
  type ResumeDoc,
  type ResumeItem,
  removeFromResume,
  resetLine,
  sameLineText,
  setContactOnResume,
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
        degree: "Updated",
        title: "Updated",
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

describe("review regressions", () => {
  it("preserves untouched rich bullet HTML through updates, removal, addition and reset", () => {
    const rich = '<li class="kept"><strong>Grew</strong> revenue<br>20%</li>';
    const item = {
      ...libraryItemToResumeItem(role),
      description: `<p>Intro</p><ul>${rich}<li>Built APIs &amp; tools</li></ul><p>After</p>`,
      bulletRefs: [null, duty.id],
    };
    const doc = freeze(withEntry(document(), item));
    const updated = applyLibraryUpdate(doc, duty, {
      ...duty,
      text: "New text",
    });
    const removed = removeFromResume(doc, duty.id);
    const added = addToResume(doc, otherDuty.id, library);
    const reset = resetLine(updated, String(item.id), 1, library);
    for (const next of [updated, removed, added, reset]) {
      expect(entries(next, "role")[0].description).toContain(rich);
      expect(entries(next, "role")[0].description).toContain("<p>After</p>");
    }
  });
  it("renders new multiline bullet text with HTML breaks", () => {
    const item = setItemLines(libraryItemToResumeItem(role), [
      { text: "First\nSecond <&>", ref: null },
    ]);
    expect(item.description).toBe(
      "<ul><li>First<br>Second &lt;&amp;&gt;</li></ul>",
    );
    expect(getItemLines(item)[0].text).toBe("First\nSecond <&>");
  });
  it.each([
    role,
    education,
  ])("keeps $kind schema-valid when required data is missing or cleared", (original) => {
    const missing = { ...original, data: { period: "2024" } };
    const doc = addToResume(document(), missing.id, [missing]);
    expect(() => parseV5ResumeData(doc)).not.toThrow();
    const populated = addToResume(document(), original.id, library);
    const cleared = applyLibraryUpdate(populated, original, missing);
    expect(() => parseV5ResumeData(cleared)).not.toThrow();
  });
  it("preserves resume website labels on library field updates", () => {
    const item = {
      ...libraryItemToResumeItem(role),
      website: { url: "https://example.com", label: "Company site" },
    };
    const updated = applyLibraryUpdate(withEntry(document(), item), role, {
      ...role,
      data: { ...role.data, location: "New place" },
    });
    expect(entries(updated, "role")[0].website).toEqual(item.website);
  });
  it.each([
    role,
    project,
    certification,
  ])("builds and updates $kind websites from v5 objects, including label edits", (original) => {
    const website = { url: "https://example.com", label: "Site" };
    const before = { ...original, data: { ...original.data, website } };
    const doc = addToResume(document(), before.id, [before]);
    expect(entries(doc, before.kind)[0].website).toEqual(website);
    const updated = applyLibraryUpdate(doc, before, {
      ...before,
      text: "Edited another field",
    });
    expect(entries(updated, before.kind)[0].website).toEqual(website);
    const changed = applyLibraryUpdate(updated, before, {
      ...before,
      data: { ...before.data, website: { ...website, label: "New label" } },
    });
    expect(entries(changed, before.kind)[0].website).toEqual({
      ...website,
      label: "New label",
    });
  });
  it.each([
    role,
    project,
    certification,
  ])("retains existing $kind website fields absent from legacy data and permits explicit clearing", (original) => {
    const website = { url: "https://example.com", label: "Site" };
    const doc = addToResume(document(), original.id, [original]);
    entries(doc, original.kind)[0].website = website;
    const missing = { ...original, data: {} };
    expect(
      entries(applyLibraryUpdate(doc, original, missing), original.kind)[0]
        .website,
    ).toEqual(website);
    const legacy = { ...original, data: { website: "https://new.example" } };
    expect(
      entries(applyLibraryUpdate(doc, original, legacy), original.kind)[0]
        .website,
    ).toEqual({ url: "https://new.example", label: "Site" });
    const cleared = { ...original, data: { website: { url: "", label: "" } } };
    expect(
      entries(applyLibraryUpdate(doc, original, cleared), original.kind)[0]
        .website,
    ).toEqual({ url: "", label: "" });
  });
});

describe("round one lead decisions", () => {
  it.each([
    "role",
    "duty",
  ])("inserts a %s after the last normalized company match", (selection) => {
    const first = { ...role, id: "first" };
    const beta = {
      ...role,
      id: "beta",
      data: { ...role.data, company: "Beta" },
    };
    const last = {
      ...role,
      id: "last",
      data: { ...role.data, company: "  Acme\n " },
    };
    const gamma = {
      ...role,
      id: "gamma",
      data: { ...role.data, company: "Gamma" },
    };
    let doc = document();
    for (const item of [first, beta, last, gamma])
      doc = addToResume(doc, item.id, [item]);
    // The middle editor may have separated roles; insertion follows the last match.
    doc.sections.experience.items = [first, beta, last, gamma].map((item) =>
      entries(doc, "role").find((entry) => entry.libraryId === item.id),
    ) as ResumeDoc["sections"]["experience"]["items"];
    const next = addToResume(
      freeze(doc),
      selection === "role" ? role.id : duty.id,
      library,
    );
    expect(entries(next, "role").map((entry) => entry.libraryId)).toEqual([
      first.id,
      beta.id,
      last.id,
      role.id,
      gamma.id,
    ]);
    expect(
      getItemLines(entries(next, "role")[3]).map((line) => line.ref),
    ).toEqual(selection === "role" ? [duty.id, otherDuty.id] : [duty.id]);
  });

  it.each([
    [role, duty],
    [project, point],
  ])("never stamps another $0.kind's child", (parent, child) => {
    const doc = addToResume(document(), parent.id, [parent]);
    const entry = entries(doc, parent.kind)[0];
    entry.libraryId = undefined;
    entry.description = `<ul><li>${child.text.replace(/&/g, "&amp;")}</li></ul>`;
    const result = stampLibraryRefs(freeze(doc), [
      parent,
      { ...child, parentId: "elsewhere" },
    ]);
    expect(result.linked).toBe(1);
    const stamped = entries(result.doc, parent.kind)[0];
    expect(stamped.libraryId).toBe(parent.id);
    expect(getItemLines(stamped)).toEqual([{ text: child.text, ref: null }]);
    expect(stamped.description).toBe(entry.description);
  });

  it.each([
    [role, duty],
    [project, point],
  ])("does not link $0.kind lines without a matched parent", (parent, child) => {
    for (const libraryId of [undefined, "deleted-parent"]) {
      const doc = addToResume(document(), parent.id, [parent]);
      const entry = entries(doc, parent.kind)[0];
      entry.libraryId = libraryId;
      entry.description = `<ul><li>${child.text.replace(/&/g, "&amp;")}</li></ul>`;
      // Include an orphan child whose parent id equals the dangling ref.
      const result = stampLibraryRefs(freeze(doc), [
        { ...child, parentId: libraryId ?? parent.id },
      ]);
      expect(result).toEqual({ doc, linked: 0 });
      expect(result.doc).toBe(doc);
    }
  });

  it("leaves missing item and line refs untouched and resetting them is a no-op", () => {
    const entry = {
      ...libraryItemToResumeItem(role),
      libraryId: "deleted-parent",
      description: "<ul><li>Built APIs &amp; tools</li></ul>",
      bulletRefs: ["deleted-duty"],
    };
    const doc = freeze(withEntry(document(), entry));
    expect(stampLibraryRefs(doc, library)).toEqual({ doc, linked: 0 });
    expect(stampLibraryRefs(doc, library).doc).toBe(doc);
    expect(resetLine(doc, String(entry.id), 0, library)).toBe(doc);
  });
});

describe("contact selections", () => {
  it("replaces and clears single values without mutating the original", () => {
    const doc = document();
    doc.basics.email = "old@example.com";
    const email = row("email", "contact", "new@example.com", {
      data: { type: "email", value: "new@example.com" },
    });
    const next = addToResume(doc, email.id, [email]);
    expect(next.basics.email).toBe("new@example.com");
    expect(doc.basics.email).toBe("old@example.com");
    expect(isContactOnResume(next, email)).toBe(true);
    expect(setContactOnResume(next, email, false).basics.email).toBe("");
    expect(setContactOnResume(doc, email, false)).toBe(doc);
    expect(parseV5ResumeData(next)).toBeTruthy();
  });
  it("adds profiles once, derives ticks from unlinked values, and removes just that profile", () => {
    const doc = document();
    const profile = row("profile", "contact", "GitHub", {
      data: {
        type: "profile",
        value: "https://github.com/user",
        url: "https://github.com/user",
        network: "GitHub",
        username: "user",
        label: "Code",
      },
    });
    const next = setContactOnResume(doc, profile, true);
    expect(next.sections.profiles.items).toHaveLength(1);
    expect(next.sections.profiles.items[0]).toMatchObject({
      network: "GitHub",
      username: "user",
      website: { url: "https://github.com/user", label: "Code" },
    });
    expect(setContactOnResume(next, profile, true)).toBe(next);
    expect(
      applyLibraryUpdate(next, profile, { ...profile, tags: ["Code"] }),
    ).toBe(next);
    next.sections.profiles.items[0].icon = "github";
    const edited = applyLibraryUpdate(next, profile, {
      ...profile,
      data: { ...profile.data, network: "GitHub profile" },
    });
    expect(edited.sections.profiles.items[0]).toMatchObject({
      id: next.sections.profiles.items[0].id,
      icon: "github",
      network: "GitHub profile",
    });
    delete next.sections.profiles.items[0].libraryId;
    expect(isContactOnResume(next, profile)).toBe(true);
    expect(
      setContactOnResume(next, profile, false).sections.profiles.items,
    ).toEqual([]);
    expect(parseV5ResumeData(next)).toBeTruthy();
  });
});

it.each([
  "username",
  "value",
])("keeps profile ticks stable after editing %s", (field) => {
  const doc = document();
  doc.sections.profiles.items = [
    {
      id: "original-profile",
      hidden: false,
      icon: "github",
      network: "GitHub",
      username: "jdoe",
      website: { url: "", label: "" },
    },
  ];
  const before = row("library-profile", "contact", "jdoe", {
    data: { type: "profile", value: "jdoe", username: "jdoe", url: "" },
  });
  const after = { ...before, data: { ...before.data, [field]: "jdoe2" } };
  const edited = applyLibraryUpdate(doc, before, after);
  expect(edited.sections.profiles.items[0]).toMatchObject({
    id: "original-profile",
    libraryId: before.id,
    icon: "github",
  });
  expect(isContactOnResume(edited, after)).toBe(true);
  const once = setContactOnResume(edited, after, true);
  expect(setContactOnResume(once, after, true)).toBe(edited);
  expect(once.sections.profiles.items).toHaveLength(1);
  const cleared = setContactOnResume(edited, after, false);
  expect(cleared.sections.profiles.items).toEqual([]);
  const restored = setContactOnResume(cleared, after, true);
  expect(setContactOnResume(restored, after, true)).toBe(restored);
  expect(restored.sections.profiles.items).toHaveLength(1);
});

describe("structured library fields", () => {
  it.each([
    [
      education,
      {
        degree: "BSc",
        area: "CS",
        grade: "First",
        description: "<p>Thesis</p>",
      },
    ],
    [award, { title: "Prize", awarder: "Society", description: "<p>Work</p>" }],
    [certification, { title: "Certified", description: "<p>Exam</p>" }],
  ] as const)("preserves structured $0.kind through metadata edits and supports explicit clearing", (legacy, structured) => {
    const current = {
      ...legacy,
      text: foldResumeParts(...Object.values(structured)),
      data: { ...legacy.data, ...structured },
    };
    const doc = addToResume(document(), current.id, [current]);
    expect(entries(doc, current.kind)[0]).toMatchObject(structured);
    expect(
      applyLibraryUpdate(doc, current, { ...current, tags: ["tag"] }),
    ).toBe(doc);
    // Older folded rows keep the source values instead of attempting to split text.
    expect(applyLibraryUpdate(doc, legacy, { ...legacy, tags: ["tag"] })).toBe(
      doc,
    );
    const cleared = Object.fromEntries(
      Object.keys(structured).map((key) => [key, ""]),
    );
    const next = applyLibraryUpdate(doc, current, {
      ...current,
      text: "",
      data: { ...current.data, ...cleared },
    });
    expect(entries(next, current.kind)[0]).toMatchObject(cleared);
  });
});

describe("edited structured library text", () => {
  it.each([
    [
      education,
      {
        degree: "BSc",
        area: "CS",
        grade: "First",
        description: "<p>Thesis</p>",
      },
      "degree",
    ],
    [
      award,
      { title: "Prize", awarder: "Society", description: "<p>Work</p>" },
      "title",
    ],
    [
      certification,
      { title: "Certified", description: "<p>Exam</p>" },
      "title",
    ],
  ] as const)("propagates $0.kind text edits while retaining constituents", (legacy, data, primary) => {
    const before = {
      ...legacy,
      text: foldResumeParts(...Object.values(data)),
      data: { ...legacy.data, ...data },
    };
    const doc = addToResume(document(), before.id, [before]);
    const after = { ...before, text: "Library edit" };
    expect(
      entries(applyLibraryUpdate(doc, before, after), before.kind)[0],
    ).toMatchObject({ ...data, [primary]: after.text });
    expect(libraryItemToResumeItem(after)).toMatchObject({
      ...data,
      [primary]: after.text,
    });
    for (const field of Object.keys(data).filter(
      (key) => key !== "description",
    )) {
      const patch = linkedFieldPatch(
        after,
        KIND_SECTION[after.kind] ?? "",
        field,
        "Linked edit",
      );
      expect(patch?.text).toBe(
        foldResumeParts(...Object.keys(data).map((key) => patch?.data?.[key])),
      );
      const changed = applyLibraryUpdate(doc, before, after);
      expect(
        entries(
          applyLibraryUpdate(changed, after, { ...after, ...patch }),
          after.kind,
        )[0],
      ).toEqual({ ...entries(changed, after.kind)[0], [field]: "Linked edit" });
    }
  });
  it.each([
    [
      education,
      {
        degree: "BSc",
        area: "CS",
        grade: "First",
        description: "<p>Thesis</p>",
      },
      "degree",
    ],
    [
      award,
      { title: "Prize", awarder: "Society", description: "<p>Work</p>" },
      "title",
    ],
    [
      certification,
      { title: "Certified", description: "<p>Exam</p>" },
      "title",
    ],
  ] as const)("propagates $0.kind text edits without structured primary data", (item, original, primary) => {
    for (const text of [
      "degree" in original ? original.degree : original.title,
      foldResumeParts(...Object.values(original)),
    ]) {
      const before = { ...item, text };
      const doc = addToResume(document(), before.id, [before]);
      Object.assign(entries(doc, item.kind)[0], original);
      const resumeItem = { ...entries(doc, item.kind)[0] };
      expect(
        applyLibraryUpdate(doc, before, { ...before, tags: ["tag"] }),
      ).toBe(doc);
      expect(
        applyLibraryUpdate(doc, before, { ...before, updatedAt: "later" }),
      ).toBe(doc);
      const next = applyLibraryUpdate(doc, before, {
        ...before,
        text: "Library edit",
      });
      expect(entries(next, item.kind)[0]).toEqual({
        ...resumeItem,
        [primary]: "Library edit",
      });
    }
  });
  it("uses the importer fold for whitespace and HTML", () => {
    expect(
      foldResumeParts(" BSc ", " CS\n  Science ", "", "<p>A &amp; B</p>"),
    ).toBe("BSc · CS Science · A & B");
  });
});

describe("linkedFieldPatch", () => {
  const supported = [
    [role, "experience", ["position", "company", "location", "period"]],
    [project, "projects", ["name", "period"]],
    [skill, "skills", ["name"]],
    [
      education,
      "education",
      ["degree", "area", "grade", "school", "location", "period"],
    ],
    [award, "awards", ["title", "awarder", "date"]],
    [certification, "certifications", ["title", "issuer", "date"]],
  ] as const;
  it.each(
    supported.flatMap(([item, section, fields]) =>
      fields.map((field) => ({ item, section, field })),
    ),
  )("round-trips $section.$field without changing sibling fields", ({
    item,
    section,
    field,
  }) => {
    const before = freeze({
      ...item,
      data: { ...item.data, extra: "retained" },
    });
    const doc = freeze(addToResume(document(), before.id, [before]));
    const original = entries(doc, before.kind)[0];
    const patch = linkedFieldPatch(before, section, field, "New value");
    expect(patch).not.toBeNull();
    if (patch?.data) expect(patch.data.extra).toBe("retained");
    const next = applyLibraryUpdate(doc, before, { ...before, ...patch });
    expect(entries(next, before.kind)[0]).toEqual({
      ...original,
      [field]: "New value",
    });
  });
  it.each([
    [
      education,
      "education",
      { degree: "BSc", area: "CS", grade: "First" },
      "area",
    ],
    [award, "awards", { title: "Prize", awarder: "Society" }, "awarder"],
  ] as const)("round-trips legacy $1 constituents without changing clean resume fields", (item, section, original, field) => {
    const doc = addToResume(document(), item.id, [item]);
    Object.assign(entries(doc, item.kind)[0], original);
    const resumeItem = { ...entries(doc, item.kind)[0] };
    const patch = linkedFieldPatch(item, section, field, "Linked edit");
    expect(patch).not.toBeNull();
    const next = applyLibraryUpdate(doc, item, { ...item, ...patch });
    expect(entries(next, item.kind)[0]).toEqual({
      ...resumeItem,
      [field]: "Linked edit",
    });
  });
  it("refuses a folded edit whose resulting text would be empty", () => {
    const item = {
      ...certification,
      text: "X",
      data: { title: "X", description: "" },
    };
    expect(linkedFieldPatch(item, "certifications", "title", "")).toBeNull();
    expect(linkedFieldPatch(item, "certifications", "title", "  ")).toBeNull();
  });
  it("leaves existing sibling values unchanged even when they differ from library data", () => {
    const doc = addToResume(document(), role.id, [role]);
    const original = entries(doc, role.kind)[0];
    Object.assign(original, {
      location: "My location",
      period: "My dates",
      company: "My company",
    });
    const patch = linkedFieldPatch(role, "experience", "position", "Lead");
    const next = applyLibraryUpdate(doc, role, { ...role, ...patch });
    expect(entries(next, role.kind)[0]).toEqual({
      ...original,
      position: "Lead",
    });
  });
  it("refuses prose, mismatched sections and unsupported fields", () => {
    for (const item of parents) {
      expect(
        linkedFieldPatch(
          item,
          KIND_SECTION[item.kind] ?? "",
          "description",
          "Text",
        ),
      ).toBeNull();
      expect(linkedFieldPatch(item, "wrong", "title", "Text")).toBeNull();
      expect(
        linkedFieldPatch(
          item,
          KIND_SECTION[item.kind] ?? "",
          "website",
          "Text",
        ),
      ).toBeNull();
    }
    expect(linkedFieldPatch(duty, "experience", "text", "Text")).toBeNull();
  });
});
