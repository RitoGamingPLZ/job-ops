import { z } from "zod";
import { parseLibraryData } from "./candidate-library-schema";
import { CANDIDATE_ITEM_KINDS, type CandidateItemKind } from "./types/cowork";
import type { ResumeSuggestionV2 } from "./types/resume-suggestions";

const id = z.string().trim().min(1).max(200);
const text = z.string().max(10000);
const newText = z.string().trim().min(1).max(10000);
const index = z.number().int().nonnegative();
const sections = [
  "experience",
  "education",
  "projects",
  "skills",
  "awards",
  "certifications",
] as const;
const section = z.enum(sections);
const lineParent = {
  section: z.enum(["experience", "projects"]),
  itemId: id,
};
const lineTarget = { ...lineParent, bulletIndex: index, previousText: text };
const metadata = { id, reason: z.string().trim().min(1).max(2000) };
const keywords = z.array(z.string().max(200)).max(100);
const libraryCreate = z
  .object({
    kind: z.enum(
      CANDIDATE_ITEM_KINDS as [CandidateItemKind, ...CandidateItemKind[]],
    ),
    text: z.string().trim().min(1).max(10000),
    parentId: id.nullable().optional(),
    company: z.string().max(500).nullable().optional(),
    role: z.string().max(500).nullable().optional(),
    startDate: z.string().max(200).nullable().optional(),
    endDate: z.string().max(200).nullable().optional(),
    data: z.record(z.unknown()).nullable().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.kind === "contact") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message: "Suggestions cannot create contacts",
      });
    }
    const child = item.kind === "bullet" || item.kind === "project_point";
    if (child && !item.parentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentId"],
        message: "Child library items require a parent",
      });
    } else if (!child && item.parentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentId"],
        message: "This library kind cannot have a parent",
      });
    }
    try {
      parseLibraryData(item.kind, item.data);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: "Invalid library data for item kind",
      });
    }
  });
const saveTarget = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("line"),
      target: z.object(lineTarget).strict(),
      libraryId: id,
    })
    .strict(),
  z
    .object({ kind: z.literal("entry"), section, itemId: id, libraryId: id })
    .strict(),
]);
// Arbitrary entry records still have a bounded, identity-free JSON payload.
const maxEntrySize = 100000; // serialized JSON characters
const entryItem = z.record(z.unknown()).superRefine((item, ctx) => {
  const pending: { value: unknown; depth: number }[] = [
    { value: item, depth: 0 },
  ];
  const seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    const { value, depth } = next;
    if (++nodes > 2000 || depth > 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Entry exceeds size or depth limits",
      });
      return;
    }
    if (typeof value === "string") {
      if (value.length > 10000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Entry strings must not exceed 10000 characters",
        });
        return;
      }
    } else if (value !== null && typeof value === "object") {
      if (seen.has(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Entry must be acyclic JSON",
        });
        return;
      }
      seen.add(value);
      const entries = Object.entries(value);
      if (entries.length > 200) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Entry collections must not exceed 200 values",
        });
        return;
      }
      for (const [key, child] of entries) {
        if (["id", "libraryId", "bulletRefs"].includes(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Entry must not supply ${key} at any depth`,
          });
          return;
        }
        pending.push({ value: child, depth: depth + 1 });
      }
    } else if (
      value !== null &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Entry must contain JSON values",
      });
      return;
    }
  }
  if (JSON.stringify(item).length > maxEntrySize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Entry JSON must not exceed 100000 characters",
    });
  }
});

/** Domain contract. Provider envelopes must be normalized before validation. */
export const resumeSuggestionV2Schema = z.discriminatedUnion("op", [
  z
    .object({
      ...metadata,
      op: z.literal("include_library_item"),
      libraryId: id,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("exclude_library_item"),
      libraryId: id,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("create_library_item"),
      item: libraryCreate,
      includeOnResume: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("save_to_library"),
      target: saveTarget,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("add_entry"),
      section,
      index,
      item: entryItem,
    })
    .strict(),
  z
    .object({ ...metadata, op: z.literal("remove_entry"), section, itemId: id })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("reorder_entries"),
      section,
      itemIds: z.array(id).max(200),
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("replace_bullet"),
      ...lineTarget,
      text: newText,
    })
    .strict(),
  z
    .object({ ...metadata, op: z.literal("delete_bullet"), ...lineTarget })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("insert_bullet"),
      ...lineParent,
      bulletIndex: index,
      text: newText,
      libraryId: id.optional(),
      sourceBulletIds: z.array(id).max(80).optional(),
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("reorder_bullets"),
      ...lineParent,
      order: z.array(index).max(200),
      previousTexts: z.array(text).max(200),
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("replace_intro"),
      ...lineParent,
      previousText: text,
      text,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("replace_headline"),
      previousText: text,
      text: newText,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("replace_summary"),
      previousText: text,
      text: newText,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("replace_field"),
      field: z
        .object({ section, itemId: id, name: z.string().trim().min(1).max(50) })
        .strict(),
      previousText: text,
      text,
    })
    .strict(),
  z
    .object({
      ...metadata,
      op: z.literal("set_skill_keywords"),
      itemId: id,
      previousKeywords: keywords,
      keywords,
    })
    .strict(),
]);

/** Read historical messages without guessing missing stale-target guards. */
export function decodeStoredSuggestion(
  raw: unknown,
): ResumeSuggestionV2 | null {
  try {
    const current = resumeSuggestionV2Schema.safeParse(raw);
    if (current.success) return current.data;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const legacy = raw as Record<string, unknown>;
    const base = { id: legacy.id, reason: legacy.reason, op: legacy.op };
    let candidate: unknown;
    switch (legacy.op) {
      case "replace_bullet":
      case "delete_bullet":
      case "insert_bullet":
        // A malformed V2 target must not be reinterpreted as legacy experience.
        if ("section" in legacy || "itemId" in legacy) return null;
        candidate = {
          ...base,
          section: "experience",
          itemId: legacy.experienceId,
          bulletIndex: legacy.bulletIndex,
          ...(legacy.op !== "insert_bullet"
            ? { previousText: legacy.previousText }
            : {}),
          ...(legacy.op !== "delete_bullet" ? { text: legacy.text } : {}),
          ...(legacy.op === "insert_bullet" && legacy.sourceBulletIds != null
            ? { sourceBulletIds: legacy.sourceBulletIds }
            : {}),
        };
        break;
      case "replace_headline":
      case "replace_summary":
        candidate = {
          ...base,
          previousText: legacy.previousText,
          text: legacy.text,
        };
        break;
      case "replace_field":
        candidate = {
          ...base,
          field: legacy.field,
          previousText: legacy.previousText,
          text: legacy.text,
        };
        break;
      default:
        return null; // Includes lossy legacy set_skills.
    }
    const result = resumeSuggestionV2Schema.safeParse(candidate);
    return result.success ? result.data : null;
  } catch {
    // Stored JSON is normally plain data; tolerate even hostile accessors/proxies.
    return null;
  }
}

/** Pick the chosen operation's keys, ignoring unused provider envelope fields. */
function pickProviderKeys(raw: unknown, keys: string[]): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => keys.includes(key) && value !== null,
    ),
  );
}

/** Lower the provider-only envelope without changing nulls inside item data. */
export function decodeProviderSuggestion(
  raw: unknown,
  suggestionId: string,
): ResumeSuggestionV2 | null {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const envelope = raw as Record<string, unknown>;
    const member = resumeSuggestionV2Schema.options.find(
      (option) => option.shape.op.value === envelope.op,
    );
    if (!member) return null;
    const candidate = pickProviderKeys(
      envelope,
      Object.keys(member.shape),
    ) as Record<string, unknown>;
    if (envelope.op === "create_library_item" || envelope.op === "add_entry") {
      if (typeof envelope.itemJson !== "string") return null;
      if (
        envelope.op === "add_entry" &&
        envelope.itemJson.length > maxEntrySize
      )
        return null;
      candidate.item = JSON.parse(envelope.itemJson);
    }
    if (
      candidate.op === "save_to_library" &&
      candidate.target &&
      typeof candidate.target === "object" &&
      !Array.isArray(candidate.target)
    ) {
      const target = candidate.target as Record<string, unknown>;
      const targetMember = saveTarget.options.find(
        (option) => option.shape.kind.value === target.kind,
      );
      if (!targetMember) return null;
      candidate.target = pickProviderKeys(
        target,
        Object.keys(targetMember.shape),
      );
    }
    const result = resumeSuggestionV2Schema.safeParse({
      ...candidate,
      id: suggestionId,
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
function object(properties: Record<string, unknown>, nullable = false) {
  return {
    type: nullable ? ["object", "null"] : "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
const array = (items: Record<string, unknown>) => ({
  type: ["array", "null"],
  items,
});
/**
 * Strict provider envelope, embedded as suggestions.items in the chat response.
 * Every key is required; unused keys are null. The server assigns id, ignores unused
 * envelope keys, JSON.parse's itemJson into item (for create_library_item and
 * add_entry), then validates with resumeSuggestionV2Schema. JSON encoding keeps
 * arbitrary entry/data records out of strict providers' closed object schemas.
 * save_to_library uses target.kind to choose and remove its unused keys.
 */
export const suggestionProviderJsonSchema = object({
  op: {
    type: "string",
    enum: resumeSuggestionV2Schema.options.map(
      (option) => option.shape.op.value,
    ),
  },
  reason: string,
  libraryId: nullableString,
  section: {
    ...nullableString,
    description:
      "Entry section: experience, education, projects, skills, awards, certifications; null when unused.",
  },
  itemId: nullableString,
  bulletIndex: { type: ["integer", "null"] },
  previousText: nullableString,
  text: nullableString,
  itemJson: {
    ...nullableString,
    description:
      "JSON-encoded item object for add_entry or create_library_item; null for other operations. Never include id, libraryId or bulletRefs in an add_entry item.",
  },
  includeOnResume: { type: ["boolean", "null"] },
  index: { type: ["integer", "null"] },
  itemIds: array(string),
  sourceBulletIds: array(string),
  order: array({ type: "integer" }),
  previousTexts: array(string),
  previousKeywords: array(string),
  keywords: array(string),
  field: object(
    {
      section: { type: "string", enum: [...sections] },
      itemId: string,
      name: string,
    },
    true,
  ),
  target: object(
    {
      kind: { type: "string", enum: ["line", "entry"] },
      libraryId: string,
      section: {
        ...nullableString,
        description:
          "Entry section: experience, education, projects, skills, awards, certifications; null when unused.",
      },
      itemId: nullableString,
      target: object(
        {
          section: { type: "string", enum: ["experience", "projects"] },
          itemId: string,
          bulletIndex: { type: "integer" },
          previousText: string,
        },
        true,
      ),
    },
    true,
  ),
});
