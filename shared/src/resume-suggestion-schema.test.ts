import { describe, expect, it } from "vitest";
import {
  decodeProviderSuggestion,
  decodeStoredSuggestion,
  resumeSuggestionV2Schema,
  suggestionProviderJsonSchema,
} from "./resume-suggestion-schema";
import { CANDIDATE_ITEM_KINDS } from "./types/cowork";
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
  { ...metadata, op: "replace_bullet", ...line, text: "After", sourceBulletIds: ["evidence"] },
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
    sourceBulletIds: ["evidence"],
    ...parent,
    previousText: "Before",
    text: "After",
  },
  {
    ...metadata,
    op: "replace_headline",
    sourceBulletIds: ["evidence"],
    previousText: "Before",
    text: "After",
  },
  {
    ...metadata,
    op: "replace_summary",
    previousText: "Before",
    text: "After",
    sourceBulletIds: ["evidence"],
  },
  {
    ...metadata,
    op: "replace_field",
    sourceBulletIds: ["evidence"],
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

  it.each(["id", "libraryId", "bulletRefs"])("rejects add_entry forging %s", (key) => {
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
    expect(resumeSuggestionV2Schema.safeParse({ ...metadata, ...body }).success).toBe(false);
  });
});

describe("historical messages", () => {
  it.each(["replace_bullet", "insert_bullet", "delete_bullet"])(
    "converts legacy %s to an experience target",
    (op) => {
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
    },
  );

  it.each(["replace_headline", "replace_summary", "replace_field"])(
    "converts legacy %s with unused optional fields",
    (op) => {
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
    },
  );

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
    Object.keys(suggestionProviderJsonSchema.properties).map((key) => [key, null]),
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
    expect(decodeProviderSuggestion(providerEnvelope(suggestion), metadata.id)).toEqual(suggestion);
  });

  it("preserves nulls in JSON-encoded library data", () => {
    const suggestion = {
      ...metadata,
      op: "create_library_item",
      includeOnResume: false,
      item: { kind: "role", text: "Fact", parentId: null, data: null },
    } as const;
    expect(decodeProviderSuggestion(providerEnvelope(suggestion), "server-id")).toEqual({
      ...suggestion,
      id: "server-id",
    });
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
    { op: "unknown", itemJson: "{}" },
    { op: "set_skills", skills: [] },
  ])("rejects malformed JSON or wrong operation: $op", (body) => {
    expect(decodeProviderSuggestion({ reason: metadata.reason, ...body }, metadata.id)).toBeNull();
  });

  it("uses required nullable fields and closed objects at every schema level", () => {
    const visit = (schema: Record<string, unknown>) => {
      expect(schema).not.toHaveProperty("anyOf");
      expect(schema).not.toHaveProperty("oneOf");
      if ("enum" in schema) expect(schema.enum).not.toContain(null);
      if ("properties" in schema) {
        const properties = schema.properties as Record<string, Record<string, unknown>>;
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

describe("review regressions", () => {
  const requireText = suggestions.filter((suggestion) =>
    ["replace_bullet", "insert_bullet", "replace_headline", "replace_summary"].includes(
      suggestion.op,
    ),
  );
  it.each(requireText)("rejects blank new text for $op and trims valid text", (suggestion) => {
    for (const text of ["", "  ", "\n\t"]) {
      const empty = { ...suggestion, text };
      expect(resumeSuggestionV2Schema.safeParse(empty).success).toBe(false);
      expect(decodeProviderSuggestion(providerEnvelope(empty), metadata.id)).toBeNull();
    }
    expect(resumeSuggestionV2Schema.parse({ ...suggestion, text: "  New text  " })).toMatchObject({
      text: "New text",
    });
  });

  it("allows clearing an intro or a field and allows an empty previous value", () => {
    for (const op of ["replace_intro", "replace_field"] as const) {
      const suggestion = suggestions.find((suggestion) => suggestion.op === op);
      expect(
        resumeSuggestionV2Schema.safeParse({
          ...suggestion,
          previousText: "",
          text: "",
        }).success,
      ).toBe(true);
    }
    expect(
      resumeSuggestionV2Schema.safeParse({
        ...metadata,
        op: "replace_summary",
        previousText: "",
        text: "New summary",
      }).success,
    ).toBe(true);
  });

  it.each(suggestions)(
    "ignores unused non-null provider fields for $op while keeping domain validation strict",
    (suggestion) => {
      const envelope = providerEnvelope(suggestion);
      // These are valid envelope properties, but are unused by every tested op.
      for (const key of Object.keys(envelope)) {
        if (envelope[key] === null) envelope[key] = "stray";
      }
      expect(decodeProviderSuggestion(envelope, metadata.id)).toEqual(suggestion);
      expect(resumeSuggestionV2Schema.safeParse({ ...suggestion, stray: "value" }).success).toBe(
        false,
      );
    },
  );

  it.each(["line", "entry"])("ignores unused save-to-library %s target fields", (kind) => {
    const suggestion = suggestions.find(
      (suggestion) => suggestion.op === "save_to_library" && suggestion.target.kind === kind,
    );
    if (!suggestion) throw new Error("Missing fixture");
    const envelope = providerEnvelope(suggestion);
    const target = envelope.target as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (target[key] === null) target[key] = "stray";
    }
    expect(decodeProviderSuggestion(envelope, metadata.id)).toEqual(suggestion);
  });

  it.each(["id", "libraryId", "bulletRefs"])(
    "rejects nested role %s through both entry validators",
    (key) => {
      const suggestion = {
        ...metadata,
        op: "add_entry",
        section: "experience",
        index: 0,
        item: {
          company: "Company",
          roles: [{ position: "Engineer", [key]: "forged" }],
        },
      } as const;
      expect(resumeSuggestionV2Schema.safeParse(suggestion).success).toBe(false);
      expect(decodeProviderSuggestion(providerEnvelope(suggestion), metadata.id)).toBeNull();
    },
  );

  const nested: Record<string, unknown> = {};
  let current = nested;
  for (let i = 0; i < 10; i++) {
    current.child = {};
    current = current.child as Record<string, unknown>;
  }
  it.each([
    { description: "x".repeat(10001) },
    { roles: [{ description: "x".repeat(10001) }] },
    { description: "x".repeat(1000001) },
    Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`field${i}`, "x".repeat(10000)])),
    nested,
    { keywords: Array.from({ length: 201 }, () => "keyword") },
    Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`field${i}`, "value"])),
    {
      roles: Array.from({ length: 200 }, () => Array.from({ length: 20 }, () => "value")),
    },
  ])("bounds added entry payloads through both validators (%#)", (item) => {
    const suggestion = {
      ...metadata,
      op: "add_entry",
      section: "experience",
      index: 0,
      item,
    } as const;
    expect(resumeSuggestionV2Schema.safeParse(suggestion).success).toBe(false);
    expect(decodeProviderSuggestion(providerEnvelope(suggestion), metadata.id)).toBeNull();
  });

  it("accepts a bounded nested role without identities", () => {
    const suggestion = {
      ...metadata,
      op: "add_entry",
      section: "experience",
      index: 0,
      item: {
        company: "Company",
        roles: [
          {
            position: "Engineer",
            description: "x".repeat(10000),
            period: "2020",
          },
        ],
      },
    } as const;
    expect(resumeSuggestionV2Schema.parse(suggestion)).toEqual(suggestion);
    expect(decodeProviderSuggestion(providerEnvelope(suggestion), metadata.id)).toEqual(suggestion);
  });

  it("rejects cyclic entry data without throwing in the decoders", () => {
    const item: Record<string, unknown> = {};
    item.child = item;
    const suggestion = {
      ...metadata,
      op: "add_entry",
      section: "experience",
      index: 0,
      item,
    };
    expect(resumeSuggestionV2Schema.safeParse(suggestion).success).toBe(false);
    expect(decodeStoredSuggestion(suggestion)).toBeNull();
  });

  it.each(CANDIDATE_ITEM_KINDS)("validates create-library kind and parent rules for %s", (kind) => {
    const makeSuggestion = (parentId?: string | null): ResumeSuggestionV2 => ({
      ...metadata,
      op: "create_library_item",
      includeOnResume: true,
      item: { kind, text: "Fact", parentId },
    });
    const child = kind === "bullet" || kind === "project_point";
    for (const parentId of [undefined, null, "", "parent"]) {
      const suggestion = makeSuggestion(parentId);
      const valid =
        kind !== "contact" &&
        (child ? parentId === "parent" : parentId === undefined || parentId === null);
      expect(resumeSuggestionV2Schema.safeParse(suggestion).success).toBe(valid);
      expect(decodeProviderSuggestion(providerEnvelope(suggestion), metadata.id) !== null).toBe(
        valid,
      );
    }
  });
});
