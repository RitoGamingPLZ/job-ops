import { describe, expect, it } from "vitest";
import {
  decodeProviderSuggestion,
  decodeStoredSuggestion,
  resumeSuggestionV2Schema,
  suggestionProviderJsonSchema,
} from "./resume-suggestion-schema";
import type { ResumeSuggestionV2 } from "./types/resume-suggestions";

const metadata = { id: "suggestion", reason: "Fits the role" };
const parent = { section: "projects", itemId: "project" } as const;
const line = { ...parent, bulletIndex: 0, previousText: "Before" };
const suggestions: ResumeSuggestionV2[] = [
  { ...metadata, op: "include_library_item", libraryId: "library" },
  { ...metadata, op: "exclude_library_item", libraryId: "library" },
  {
    ...metadata,
    op: "create_library_item",
    item: { kind: "education", text: "Degree", data: { area: "Computing" } },
    includeOnResume: true,
  },
  {
    ...metadata,
    op: "save_to_library",
    target: { kind: "line", target: line, libraryId: "library" },
  },
  {
    ...metadata,
    op: "save_to_library",
    target: { kind: "entry", ...parent, libraryId: "library" },
  },
  {
    ...metadata,
    op: "add_entry",
    section: "education",
    index: 0,
    item: { school: "School", degree: "Degree" },
  },
  { ...metadata, op: "remove_entry", ...parent },
  {
    ...metadata,
    op: "reorder_entries",
    section: "projects",
    itemIds: ["project"],
  },
  { ...metadata, op: "replace_bullet", ...line, text: "After" },
  { ...metadata, op: "delete_bullet", ...line },
  {
    ...metadata,
    op: "insert_bullet",
    ...parent,
    bulletIndex: 1,
    text: "New",
    libraryId: "library",
    sourceBulletIds: ["library"],
  },
  {
    ...metadata,
    op: "reorder_bullets",
    ...parent,
    previousTexts: ["First", "Second"],
    order: [1, 0],
  },
  {
    ...metadata,
    op: "replace_intro",
    ...parent,
    previousText: "Before",
    text: "After",
  },
  {
    ...metadata,
    op: "replace_headline",
    previousText: "Before",
    text: "After",
  },
  { ...metadata, op: "replace_summary", previousText: "Before", text: "After" },
  {
    ...metadata,
    op: "replace_field",
    field: { ...parent, name: "name" },
    previousText: "Before",
    text: "After",
  },
  {
    ...metadata,
    op: "set_skill_keywords",
    itemId: "skill",
    previousKeywords: ["TS"],
    keywords: ["TS", "SQL"],
  },
];

describe("V2 domain contract", () => {
  it.each(suggestions)("parses and decodes $op", (suggestion) => {
    expect(resumeSuggestionV2Schema.parse(suggestion)).toEqual(suggestion);
    expect(decodeStoredSuggestion(suggestion)).toEqual(suggestion);
  });

  it.each([
    "id",
    "libraryId",
    "bulletRefs",
  ])("rejects add_entry forging %s", (key) => {
    expect(
      resumeSuggestionV2Schema.safeParse({
        ...metadata,
        op: "add_entry",
        section: "projects",
        index: 0,
        item: { name: "Project", [key]: undefined },
      }).success,
    ).toBe(false);
  });

  it("validates structured library data per kind without changing the payload", () => {
    const item = {
      kind: "certification",
      text: "Certificate",
      data: {
        issuer: "Issuer",
        description: "<p>Details</p>",
        website: { url: "https://example.com", label: "Link" },
      },
    };
    expect(
      resumeSuggestionV2Schema.parse({
        ...metadata,
        op: "create_library_item",
        includeOnResume: false,
        item,
      }),
    ).toMatchObject({ item });
    for (const kind of ["education", "award", "certification"]) {
      expect(
        resumeSuggestionV2Schema.safeParse({
          ...metadata,
          op: "create_library_item",
          includeOnResume: true,
          item: {
            kind,
            text: "Title",
            data: { description: "x".repeat(10001) },
          },
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    { op: "replace_bullet", ...parent, bulletIndex: 0, text: "New" },
    { op: "replace_bullet", ...line, section: "education", text: "New" },
    { op: "delete_bullet", ...line, bulletIndex: -1 },
    { op: "insert_bullet", ...parent, bulletIndex: 0.5, text: "New" },
    { op: "replace_summary", text: "New" },
    { op: "set_skills", skills: [] },
    { op: "remove_entry", ...parent, libraryId: "forged" },
    {
      op: "create_library_item",
      includeOnResume: true,
      item: { kind: "role", text: "Role", source: "manual" },
    },
    { op: "save_to_library", target: { kind: "entry", ...parent } },
  ])("rejects invalid targets and fields: $op", (body) => {
    expect(
      resumeSuggestionV2Schema.safeParse({ ...metadata, ...body }).success,
    ).toBe(false);
  });
});

describe("historical messages", () => {
  it.each([
    "replace_bullet",
    "insert_bullet",
    "delete_bullet",
  ])("converts legacy %s to an experience target", (op) => {
    const result = decodeStoredSuggestion({
      ...metadata,
      op,
      experienceId: "role",
      bulletIndex: 2,
      previousText: "Before",
      text: "After",
      sourceBulletIds: ["source"],
    });
    expect(result).toEqual({
      ...metadata,
      op,
      section: "experience",
      itemId: "role",
      bulletIndex: 2,
      ...(op !== "insert_bullet" ? { previousText: "Before" } : {}),
      ...(op !== "delete_bullet" ? { text: "After" } : {}),
      ...(op === "insert_bullet" ? { sourceBulletIds: ["source"] } : {}),
    });
  });

  it.each([
    "replace_headline",
    "replace_summary",
    "replace_field",
  ])("converts legacy %s with unused optional fields", (op) => {
    const body = {
      ...metadata,
      op,
      previousText: "Before",
      text: "After",
      ...(op === "replace_field"
        ? {
            field: {
              section: "education",
              itemId: "education",
              name: "school",
            },
          }
        : {}),
    };
    expect(
      decodeStoredSuggestion({
        ...body,
        experienceId: null,
        bulletIndex: null,
        skills: null,
        sourceBulletIds: [],
      }),
    ).toEqual(body);
  });

  it("does not execute legacy set_skills or guess missing guards", () => {
    expect(
      decodeStoredSuggestion({
        ...metadata,
        op: "set_skills",
        skills: [{ name: "Languages", keywords: ["TS"] }],
      }),
    ).toBeNull();
    expect(
      decodeStoredSuggestion({
        ...metadata,
        op: "replace_bullet",
        experienceId: "role",
        bulletIndex: 0,
        text: "After",
      }),
    ).toBeNull();
    expect(
      decodeStoredSuggestion({
        ...metadata,
        op: "replace_bullet",
        experienceId: "role",
        section: "bad",
        bulletIndex: 0,
        previousText: "Before",
        text: "After",
      }),
    ).toBeNull();
  });
});

function providerEnvelope(suggestion: ResumeSuggestionV2) {
  const envelope: Record<string, unknown> = Object.fromEntries(
    Object.keys(suggestionProviderJsonSchema.properties).map((key) => [
      key,
      null,
    ]),
  );
  const { id: _id, ...body } = suggestion;
  Object.assign(envelope, body);
  if ("item" in suggestion) {
    envelope.itemJson = JSON.stringify(suggestion.item);
    delete envelope.item;
  }
  if (suggestion.op === "save_to_library") {
    envelope.target = {
      section: null,
      itemId: null,
      target: null,
      ...suggestion.target,
    };
  }
  return envelope;
}

describe("strict provider envelope", () => {
  it.each(suggestions)("lowers $op to the domain contract", (suggestion) => {
    expect(
      decodeProviderSuggestion(providerEnvelope(suggestion), metadata.id),
    ).toEqual(suggestion);
  });

  it("preserves nulls in JSON-encoded library data", () => {
    const suggestion = {
      ...metadata,
      op: "create_library_item",
      includeOnResume: false,
      item: { kind: "bullet", text: "Fact", parentId: null, data: null },
    } as const;
    expect(
      decodeProviderSuggestion(providerEnvelope(suggestion), "server-id"),
    ).toEqual({ ...suggestion, id: "server-id" });
  });

  it.each([
    { op: "add_entry", section: "projects", index: 0, itemJson: "{bad" },
    { op: "add_entry", section: "projects", index: 0, itemJson: "null" },
    {
      op: "add_entry",
      section: "projects",
      index: 0,
      itemJson: '{"id":"forged"}',
    },
    {
      op: "create_library_item",
      includeOnResume: true,
      itemJson: '{"kind":"education","text":"Degree","data":{"school":5}}',
    },
    {
      op: "replace_summary",
      previousText: "Before",
      text: "After",
      itemJson: "{}",
    },
    { op: "unknown", itemJson: "{}" },
    { op: "set_skills", skills: [] },
  ])("rejects malformed JSON or wrong operation: $op", (body) => {
    expect(
      decodeProviderSuggestion(
        { reason: metadata.reason, ...body },
        metadata.id,
      ),
    ).toBeNull();
  });

  it("uses required nullable fields and closed objects at every schema level", () => {
    const visit = (schema: Record<string, unknown>) => {
      expect(schema).not.toHaveProperty("anyOf");
      expect(schema).not.toHaveProperty("oneOf");
      if ("properties" in schema) {
        const properties = schema.properties as Record<
          string,
          Record<string, unknown>
        >;
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(Object.keys(properties));
        for (const child of Object.values(properties)) visit(child);
      }
      if ("items" in schema) visit(schema.items as Record<string, unknown>);
    };
    visit(suggestionProviderJsonSchema);
    expect(suggestionProviderJsonSchema.properties.op.enum).toEqual([
      ...new Set(suggestions.map((suggestion) => suggestion.op)),
    ]);
  });
});

it.each([
  null,
  undefined,
  true,
  42,
  "bad",
  [],
  {},
  { op: "unknown" },
  new Proxy(
    {},
    {
      get() {
        throw new Error("Accessor");
      },
      ownKeys() {
        throw new Error("Accessor");
      },
    },
  ),
])("decoders never throw on garbage (%#)", (raw) => {
  expect(decodeStoredSuggestion(raw)).toBeNull();
  expect(decodeProviderSuggestion(raw, metadata.id)).toBeNull();
});
