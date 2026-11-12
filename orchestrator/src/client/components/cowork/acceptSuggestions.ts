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
  for (const s of suggestions) {
    if (s.op !== "save_to_library") continue;
    const target = s.target;
    const before = library.find((item) => item.id === target.libraryId);
    if (!before) {
      rejected.push({ id: s.id, code: "INVALID_TARGET" });
      continue;
    }
    let patch: Partial<ExperienceBulletInput>;
    if (target.kind === "line") {
      const t = target.target;
      const item = document.sections[t.section].items.find(
        (item) => item.id === t.itemId && !item.hidden,
      );
      const line = item ? getItemLines(item)[t.bulletIndex] : undefined;
      if (
        !item ||
        document.sections[t.section].hidden ||
        !line ||
        line.ref !== before.id ||
        before.parentId !== item.libraryId ||
        before.kind !==
          (t.section === "experience" ? "bullet" : "project_point")
      ) {
        rejected.push({ id: s.id, code: "INVALID_TARGET" });
        continue;
      }
      if (line.text !== t.previousText) {
        rejected.push({ id: s.id, code: "STALE" });
        continue;
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
        rejected.push({ id: s.id, code: "INVALID_TARGET" });
        continue;
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
        data: Object.fromEntries(keys.map((key) => [key, item[key]])),
      };
      if (["education", "awards", "certifications"].includes(target.section))
        patch.data = { ...patch.data, schemaVersion: 2 };
    }
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
  const result = applySuggestions(document, pure, library);
  applied.push(...result.applied);
  for (const s of pure)
    if (!result.applied.includes(s.id))
      rejected.push({ id: s.id, code: "STALE" });
  return { document: result.document, applied, rejected, library };
}
