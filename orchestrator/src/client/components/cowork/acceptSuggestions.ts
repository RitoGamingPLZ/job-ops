import {
  applyLibraryUpdate,
  getItemLines,
  KIND_SECTION,
} from "@shared/resume-links";
import type {
  ExperienceBullet,
  ExperienceBulletInput,
  ReactiveResumeV5Document,
  ResumeSuggestionV2,
  SaveTarget,
} from "@shared/types";
import { applySuggestions } from "./editor";

export interface AcceptResult {
  document: ReactiveResumeV5Document;
  applied: string[];
  rejected: { id: string; code: "STALE" | "INVALID_TARGET" | "FAILED" }[];
  library: ExperienceBullet[];
}
type AcceptApi = {
  createItem: (
    input: ExperienceBulletInput,
  ) => Promise<{ bullet: ExperienceBullet }>;
  updateItem: (
    id: string,
    input: Partial<ExperienceBulletInput>,
    skipJobId?: string,
  ) => Promise<{ bullet: ExperienceBullet }>;
};

/** The reviewed fields sent by an explicit Save to library action. */
export function librarySaveInput(
  document: ReactiveResumeV5Document,
  target: SaveTarget,
  library: ExperienceBullet[],
  checkPreviousText = true,
):
  | { input: Partial<ExperienceBulletInput>; before: ExperienceBullet }
  | { code: "STALE" | "INVALID_TARGET" } {
  const before = library.find((item) => item.id === target.libraryId);
  if (!before) {
    return { code: "INVALID_TARGET" };
  }
  let patch: Partial<ExperienceBulletInput>;
  if (target.kind === "line") {
    const t = target.target;
    const item = document.sections[t.section].items.find(
      (item) => item.id === t.itemId && !item.hidden,
    );
    const line = item
      ? getItemLines(item).find((line) => line.ref === target.libraryId)
      : undefined;
    if (
      !item ||
      document.sections[t.section].hidden ||
      !line ||
      line.ref !== before.id ||
      before.parentId !== item.libraryId ||
      before.kind !== (t.section === "experience" ? "bullet" : "project_point")
    ) {
      return { code: "INVALID_TARGET" };
    }
    if (checkPreviousText && line.text !== t.previousText) {
      return { code: "STALE" };
    }
    patch = { text: line.text };
  } else {
    const section = document.sections[target.section];
    const item = section.items.find(
      (item) => item.id === target.itemId && !item.hidden,
    );
    if (
      !item ||
      section.hidden ||
      item.libraryId !== before.id ||
      KIND_SECTION[before.kind] !== target.section
    ) {
      return { code: "INVALID_TARGET" };
    }
    const textField = {
      experience: "position",
      projects: "name",
      skills: "name",
      education: "degree",
      awards: "title",
      certifications: "title",
    }[target.section];
    const keys = {
      experience: ["company", "location", "period", "website"],
      projects: ["period", "website"],
      skills: ["keywords"],
      education: [
        "school",
        "location",
        "period",
        "area",
        "grade",
        "description",
        "website",
      ],
      awards: ["date", "awarder", "description", "website"],
      certifications: ["issuer", "date", "description", "website"],
    }[target.section];
    patch = {
      text: String(item[textField] ?? ""),
      data: Object.fromEntries(
        keys.map((key) => [
          key,
          (key === "company" || key === "school") &&
          item[key] === "—" &&
          !String(before.data?.[key] ?? "").trim()
            ? (before.data?.[key] ?? "")
            : item[key],
        ]),
      ),
    };
    if (["education", "awards", "certifications"].includes(target.section))
      patch.data = { ...patch.data, schemaVersion: 2 };
  }
  return { input: patch, before };
}

function rejectionCode(
  document: ReactiveResumeV5Document,
  s: ResumeSuggestionV2,
): "STALE" | "INVALID_TARGET" {
  if (s.op === "replace_headline" || s.op === "replace_summary") return "STALE";
  if (s.op === "replace_field") {
    const item = document.sections[s.field.section].items.find(
      (item) => item.id === s.field.itemId && !item.hidden,
    );
    return item && typeof item[s.field.name] === "string"
      ? "STALE"
      : "INVALID_TARGET";
  }
  if (s.op === "set_skill_keywords")
    return document.sections.skills.items.some((item) => item.id === s.itemId)
      ? "STALE"
      : "INVALID_TARGET";
  if ("section" in s && "itemId" in s && "previousText" in s)
    return document.sections[s.section].items.some(
      (item) => item.id === s.itemId && !item.hidden,
    )
      ? "STALE"
      : "INVALID_TARGET";
  if (s.op === "reorder_bullets") {
    const item = document.sections[s.section].items.find(
      (item) => item.id === s.itemId && !item.hidden,
    );
    return item &&
      JSON.stringify(getItemLines(item).map((line) => line.text)) !==
        JSON.stringify(s.previousTexts)
      ? "STALE"
      : "INVALID_TARGET";
  }
  return "INVALID_TARGET";
}

/** Library writes are explicit and serialized; the caller owns the revision-guarded resume save. */
export async function executeAcceptedSuggestions(
  state: {
    jobId: string;
    document: ReactiveResumeV5Document;
    baseRevision: number;
    library: ExperienceBullet[];
  },
  suggestions: ResumeSuggestionV2[],
  api: AcceptApi,
): Promise<AcceptResult> {
  let document = state.document;
  const library = [...state.library];
  const applied: string[] = [];
  const rejected: AcceptResult["rejected"] = [];
  const pure = suggestions.filter(
    (s) => s.op !== "create_library_item" && s.op !== "save_to_library",
  );
  const remember = (row: ExperienceBullet) => {
    const index = library.findIndex((item) => item.id === row.id);
    if (index < 0) library.push(row);
    else library[index] = row;
  };
  for (const s of suggestions) {
    if (s.op !== "create_library_item") continue;
    try {
      const { bullet } = await api.createItem({
        ...s.item,
        source: "job_resume",
      });
      // Dedupe may return an existing row with different fields. Always use that row.
      remember(bullet);
      if (s.includeOnResume)
        pure.push({
          id: s.id,
          reason: s.reason,
          op: "include_library_item",
          libraryId: bullet.id,
        });
      else applied.push(s.id);
    } catch {
      rejected.push({ id: s.id, code: "FAILED" });
    }
  }
  const result = applySuggestions(document, pure, library);
  document = result.document;
  applied.push(...result.applied);
  for (const s of pure) {
    if (result.applied.includes(s.id)) continue;
    rejected.push({ id: s.id, code: rejectionCode(document, s) });
  }
  for (const s of suggestions) {
    if (s.op !== "save_to_library") continue;
    // Validate the reviewed text against the starting snapshot, then save the
    // linked line/entry as it exists after the accepted document operations.
    const reviewed = librarySaveInput(state.document, s.target, library);
    if ("code" in reviewed) {
      rejected.push({ id: s.id, code: reviewed.code });
      continue;
    }
    const current = librarySaveInput(document, s.target, library, false);
    if ("code" in current) {
      rejected.push({ id: s.id, code: current.code });
      continue;
    }
    const { before, input: patch } = current;
    try {
      const { bullet: after } = await api.updateItem(
        before.id,
        patch,
        state.jobId,
      );
      document = applyLibraryUpdate(document, before, after);
      remember(after);
      applied.push(s.id);
    } catch {
      rejected.push({ id: s.id, code: "FAILED" });
    }
  }

  return { document, applied, rejected, library };
}
